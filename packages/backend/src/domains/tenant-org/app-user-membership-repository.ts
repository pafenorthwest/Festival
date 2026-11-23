import { randomUUID } from "node:crypto";
import {
	type AuthenticatedUser,
	deriveDisplayName,
	type OrganizationAdminUserEntry,
	type OrganizationInviteRecord,
	type OrganizationMembershipRecord,
	type OrganizationUserRecord,
} from "@festival/common";
import { sql } from "bun";
import {
	defaultPostgresSchemaName,
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s09-infra.js";
import {
	type AdminUserRow,
	type CreateInviteRecordInput,
	type CreateMembershipInput,
	type InviteJoinRow,
	type InviteWithOrganization,
	type MembershipJoinRow,
	type MembershipRow,
	type MembershipWithOrganization,
	mapInviteWithOrganization,
	mapMembership,
	mapMembershipWithOrganization,
	mapOrganizationUser,
	toOptionalIso,
	type UserRow,
} from "./tenant-mappers.js";

export interface AppUserMembershipRepository {
	ensureReady(): Promise<void>;
	upsertUser(user: AuthenticatedUser): Promise<OrganizationUserRecord>;
	findMembershipByUserId(
		userId: string,
	): Promise<MembershipWithOrganization | null>;
	listMembershipsByUserId(
		userId: string,
	): Promise<MembershipWithOrganization[]>;
	findMembershipByUserAndSlug(
		userId: string,
		slug: string,
	): Promise<MembershipWithOrganization | null>;
	createMembership(
		input: CreateMembershipInput,
	): Promise<OrganizationMembershipRecord>;
	dismissWelcome(
		userId: string,
		organizationId: string,
	): Promise<OrganizationMembershipRecord>;
	createInvite(
		input: CreateInviteRecordInput,
	): Promise<OrganizationInviteRecord>;
	findInviteByToken(token: string): Promise<InviteWithOrganization | null>;
	markInviteAccepted(token: string): Promise<void>;
	listAdminUsers(
		organizationId: string,
		currentUserId: string,
	): Promise<OrganizationAdminUserEntry[]>;
	deleteMembership(input: {
		organizationId: string;
		membershipId: string;
		currentUserId: string;
	}): Promise<void>;
	cancelInvite(input: {
		organizationId: string;
		inviteId: string;
	}): Promise<void>;
}

async function upsertOrgUserSql(
	schema: string,
	user: AuthenticatedUser,
): Promise<OrganizationUserRecord> {
	const displayName = user.displayName ?? deriveDisplayName(user);
	const normalizedEmail = user.email.toLowerCase();
	const existing = (await sql.unsafe(
		`SELECT id, firebase_uid, email, display_name, disassociated, created_at
		 FROM ${schema}.users
		 WHERE firebase_uid = $1
		 LIMIT 1`,
		[user.uid],
	)) as UserRow[];
	if (existing[0]) {
		const updated = (await sql.unsafe(
			`UPDATE ${schema}.users
			 SET email = $2, display_name = $3, disassociated = FALSE
			 WHERE id = $1
			 RETURNING id, firebase_uid, email, display_name, disassociated, created_at`,
			[existing[0].id, normalizedEmail, displayName],
		)) as UserRow[];
		if (!updated[0]) throw new Error("Failed to update user.");
		return mapOrganizationUser(updated[0]);
	}
	const inserted = (await sql.unsafe(
		`INSERT INTO ${schema}.users (id, firebase_uid, email, display_name)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, firebase_uid, email, display_name, disassociated, created_at`,
		[randomUUID(), user.uid, normalizedEmail, displayName],
	)) as UserRow[];
	if (!inserted[0]) throw new Error("Failed to insert user.");
	return mapOrganizationUser(inserted[0]);
}

async function deleteMembershipTx(
	schema: string,
	input: {
		organizationId: string;
		membershipId: string;
		currentUserId: string;
	},
): Promise<void> {
	await sql.begin(async (tx) => {
		const rows = (await tx.unsafe(
			`SELECT id, user_id FROM ${schema}.memberships
			 WHERE id = $1 AND organization_id = $2
			 LIMIT 1`,
			[input.membershipId, input.organizationId],
		)) as Array<{ id: string; user_id: string }>;
		const target = rows[0];
		if (!target) throw new Error("Membership not found.");
		if (target.user_id === input.currentUserId) {
			throw new Error("Admins cannot delete their own membership.");
		}
		await tx.unsafe(
			`DELETE FROM ${schema}.memberships WHERE id = $1 AND organization_id = $2`,
			[target.id, input.organizationId],
		);
		const remaining = (await tx.unsafe(
			`SELECT COUNT(*)::int AS count FROM ${schema}.memberships WHERE user_id = $1`,
			[target.user_id],
		)) as Array<{ count: number }>;
		if (Number(remaining[0]?.count ?? 0) === 0) {
			await tx.unsafe(
				`UPDATE ${schema}.users SET disassociated = TRUE WHERE id = $1`,
				[target.user_id],
			);
		}
	});
}

/** PostgreSQL implementation of organization users, memberships, and staff invites. */
export class PostgresAppUserMembershipRepository
	implements AppUserMembershipRepository
{
	private readonly schema: string;

	constructor(
		schemaName = defaultPostgresSchemaName(),
		private readonly ensureReadyOverride?: () => Promise<void>,
	) {
		this.schema = postgresSchemaName(schemaName);
	}

	async ensureReady(): Promise<void> {
		if (this.ensureReadyOverride) return this.ensureReadyOverride();
		await initializePostgresSchema(this.schema);
	}

	async upsertUser(user: AuthenticatedUser): Promise<OrganizationUserRecord> {
		await this.ensureReady();
		return upsertOrgUserSql(this.schema, user);
	}

	async findMembershipByUserId(
		userId: string,
	): Promise<MembershipWithOrganization | null> {
		const memberships = await this.listMembershipsByUserId(userId);
		return memberships[0] ?? null;
	}

	async listMembershipsByUserId(
		userId: string,
	): Promise<MembershipWithOrganization[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT
				m.id, m.organization_id, m.user_id, m.role, m.origin, m.joined_at, m.welcome_dismissed_at,
				o.name AS organization_name, o.slug AS organization_slug,
				o.created_at AS organization_created_at, o.timezone AS organization_timezone,
				o.default_currency_code AS organization_default_currency_code
			 FROM ${this.schema}.memberships m
			 JOIN ${this.schema}.organizations o ON o.id = m.organization_id
			 WHERE m.user_id = $1
			 ORDER BY m.joined_at ASC, m.id ASC`,
			[userId],
		)) as MembershipJoinRow[];
		return rows.map(mapMembershipWithOrganization);
	}

	async findMembershipByUserAndSlug(
		userId: string,
		slug: string,
	): Promise<MembershipWithOrganization | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT
				m.id, m.organization_id, m.user_id, m.role, m.origin, m.joined_at, m.welcome_dismissed_at,
				o.name AS organization_name, o.slug AS organization_slug,
				o.created_at AS organization_created_at, o.timezone AS organization_timezone,
				o.default_currency_code AS organization_default_currency_code
			 FROM ${this.schema}.memberships m
			 JOIN ${this.schema}.organizations o ON o.id = m.organization_id
			 WHERE m.user_id = $1 AND o.slug = $2
			 LIMIT 1`,
			[userId, slug.toLowerCase()],
		)) as MembershipJoinRow[];
		return rows[0] ? mapMembershipWithOrganization(rows[0]) : null;
	}

	async createMembership(
		input: CreateMembershipInput,
	): Promise<OrganizationMembershipRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.memberships (id, organization_id, user_id, role, origin)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
			 RETURNING id, organization_id, user_id, role, origin, joined_at, welcome_dismissed_at`,
			[
				randomUUID(),
				input.organizationId,
				input.userId,
				input.role,
				input.origin,
			],
		)) as MembershipRow[];
		if (!rows[0]) throw new Error("Failed to create membership.");
		return mapMembership(rows[0]);
	}

	async dismissWelcome(
		userId: string,
		organizationId: string,
	): Promise<OrganizationMembershipRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.memberships
			 SET welcome_dismissed_at = COALESCE(welcome_dismissed_at, NOW())
			 WHERE user_id = $1 AND organization_id = $2
			 RETURNING id, organization_id, user_id, role, origin, joined_at, welcome_dismissed_at`,
			[userId, organizationId],
		)) as MembershipRow[];
		if (!rows[0]) throw new Error("Organization membership not found.");
		return mapMembership(rows[0]);
	}

	async createInvite(
		input: CreateInviteRecordInput,
	): Promise<OrganizationInviteRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.invites
			   (id, token, organization_id, email, role, invited_by_user_id)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING id, token, organization_id, email, role, invited_by_user_id, created_at, accepted_at`,
			[
				randomUUID(),
				randomUUID(),
				input.organizationId,
				input.email.toLowerCase(),
				input.role,
				input.invitedByUserId,
			],
		)) as Array<{
			id: string;
			token: string;
			organization_id: string;
			email: string;
			role: OrganizationInviteRecord["role"];
			invited_by_user_id: string;
			created_at: Date | string;
			accepted_at: Date | string | null;
		}>;
		const row = rows[0];
		if (!row) throw new Error("Failed to create invite.");
		return {
			id: row.id,
			token: row.token,
			organizationId: row.organization_id,
			email: row.email,
			role: row.role,
			invitedByUserId: row.invited_by_user_id,
			createdAtIso:
				row.created_at instanceof Date
					? row.created_at.toISOString()
					: row.created_at,
			acceptedAtIso: toOptionalIso(row.accepted_at),
		};
	}

	async findInviteByToken(
		token: string,
	): Promise<InviteWithOrganization | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT
				i.id, i.token, i.organization_id, i.email, i.role, i.invited_by_user_id,
				i.created_at, i.accepted_at,
				o.name AS organization_name, o.slug AS organization_slug,
				o.created_at AS organization_created_at, o.timezone AS organization_timezone,
				o.default_currency_code AS organization_default_currency_code
			 FROM ${this.schema}.invites i
			 JOIN ${this.schema}.organizations o ON o.id = i.organization_id
			 WHERE i.token = $1
			 LIMIT 1`,
			[token],
		)) as InviteJoinRow[];
		return rows[0] ? mapInviteWithOrganization(rows[0]) : null;
	}

	async markInviteAccepted(token: string): Promise<void> {
		await this.ensureReady();
		await sql.unsafe(
			`UPDATE ${this.schema}.invites
			 SET accepted_at = COALESCE(accepted_at, NOW())
			 WHERE token = $1`,
			[token],
		);
	}

	async listAdminUsers(
		organizationId: string,
		currentUserId: string,
	): Promise<OrganizationAdminUserEntry[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, email, role, status, user_id
			 FROM (
				SELECT m.id, u.email, m.role, 'accepted'::text AS status, m.user_id, m.joined_at AS sort_at
				FROM ${this.schema}.memberships m
				JOIN ${this.schema}.users u ON u.id = m.user_id
				WHERE m.organization_id = $1
				UNION ALL
				SELECT i.id, i.email, i.role, 'pending'::text AS status, NULL::text AS user_id, i.created_at AS sort_at
				FROM ${this.schema}.invites i
				WHERE i.organization_id = $1 AND i.accepted_at IS NULL
			 ) admin_entries
			 ORDER BY LOWER(email) ASC, sort_at ASC`,
			[organizationId],
		)) as AdminUserRow[];
		return rows.map((row) => ({
			id: row.id,
			email: row.email,
			role: row.role,
			status: row.status,
			isSelf: row.status === "accepted" && row.user_id === currentUserId,
		}));
	}

	async deleteMembership(input: {
		organizationId: string;
		membershipId: string;
		currentUserId: string;
	}): Promise<void> {
		await this.ensureReady();
		await deleteMembershipTx(this.schema, input);
	}

	async cancelInvite(input: {
		organizationId: string;
		inviteId: string;
	}): Promise<void> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`DELETE FROM ${this.schema}.invites
			 WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL
			 RETURNING id`,
			[input.inviteId, input.organizationId],
		)) as Array<{ id: string }>;
		if (!rows[0]) throw new Error("Invite not found.");
	}
}
