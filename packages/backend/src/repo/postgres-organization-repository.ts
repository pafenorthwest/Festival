import { randomUUID } from "node:crypto";
import { sql } from "bun";
import type {
	AuthenticatedUser,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationRole,
	OrganizationUserRecord,
} from "@festival/common";
import type {
	CreateInviteRecordInput,
	CreateMembershipInput,
	InviteWithOrganization,
	MembershipWithOrganization,
	OrganizationRepository,
} from "./organization-repository.js";

interface MembershipRow {
	id: string;
	organization_id: string;
	user_id: string;
	role: OrganizationRole;
	joined_at: string;
	origin: "creator" | "invite";
	welcome_dismissed_at: string | null;
	organization_name: string;
	organization_slug: string;
	organization_created_at: string;
}

interface InviteRow {
	id: string;
	token: string;
	organization_id: string;
	email: string;
	role: OrganizationRole;
	invited_by_user_id: string;
	created_at: string;
	accepted_at: string | null;
	organization_name: string;
	organization_slug: string;
	organization_created_at: string;
}

function sanitizeSchemaName(schema: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
		throw new Error(
			`Invalid DB_SCHEMA "${schema}". Only letters, digits, and underscores are allowed, and the name must not start with a digit.`,
		);
	}

	return schema;
}

function mapOrganization(row: {
	id: string;
	name: string;
	slug: string;
	created_at: string;
}): OrganizationRecord {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		createdAtIso: row.created_at,
	};
}

function mapUser(row: {
	id: string;
	firebase_uid: string;
	email: string;
	display_name: string;
	created_at: string;
}): OrganizationUserRecord {
	return {
		id: row.id,
		firebaseUid: row.firebase_uid,
		email: row.email,
		displayName: row.display_name,
		createdAtIso: row.created_at,
	};
}

function mapMembership(row: MembershipRow): MembershipWithOrganization {
	return {
		membership: {
			id: row.id,
			organizationId: row.organization_id,
			userId: row.user_id,
			role: row.role,
			joinedAtIso: row.joined_at,
			origin: row.origin,
			welcomeDismissedAtIso: row.welcome_dismissed_at ?? undefined,
		},
		organization: {
			id: row.organization_id,
			name: row.organization_name,
			slug: row.organization_slug,
			createdAtIso: row.organization_created_at,
		},
	};
}

function mapInvite(row: InviteRow): InviteWithOrganization {
	return {
		invite: {
			id: row.id,
			token: row.token,
			organizationId: row.organization_id,
			email: row.email,
			role: row.role,
			invitedByUserId: row.invited_by_user_id,
			createdAtIso: row.created_at,
			acceptedAtIso: row.accepted_at ?? undefined,
		},
		organization: {
			id: row.organization_id,
			name: row.organization_name,
			slug: row.organization_slug,
			createdAtIso: row.organization_created_at,
		},
	};
}

export class PostgresOrganizationRepository implements OrganizationRepository {
	private readonly schema: string;
	private readyPromise?: Promise<void>;

	constructor(schema: string) {
		this.schema = sanitizeSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		this.readyPromise ??= this.runMigrations();
		await this.readyPromise;
	}

	private async runMigrations(): Promise<void> {
		const schema = this.schema;

		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS ${schema}.organizations (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				slug TEXT NOT NULL UNIQUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE TABLE IF NOT EXISTS ${schema}.users (
				id TEXT PRIMARY KEY,
				firebase_uid TEXT NOT NULL UNIQUE,
				email TEXT NOT NULL UNIQUE,
				display_name TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE TABLE IF NOT EXISTS ${schema}.memberships (
				id TEXT PRIMARY KEY,
				organization_id TEXT NOT NULL REFERENCES ${schema}.organizations (id) ON DELETE CASCADE,
				user_id TEXT NOT NULL UNIQUE REFERENCES ${schema}.users (id) ON DELETE CASCADE,
				role TEXT NOT NULL,
				origin TEXT NOT NULL,
				joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				welcome_dismissed_at TIMESTAMPTZ NULL
			);

			CREATE TABLE IF NOT EXISTS ${schema}.invites (
				id TEXT PRIMARY KEY,
				token TEXT NOT NULL UNIQUE,
				organization_id TEXT NOT NULL REFERENCES ${schema}.organizations (id) ON DELETE CASCADE,
				email TEXT NOT NULL,
				role TEXT NOT NULL,
				invited_by_user_id TEXT NOT NULL REFERENCES ${schema}.users (id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				accepted_at TIMESTAMPTZ NULL
			);
		`);
	}

	async upsertUser(user: AuthenticatedUser): Promise<OrganizationUserRecord> {
		await this.ensureReady();

		const existingRows = (await sql.unsafe(
			`SELECT id, firebase_uid, email, display_name, created_at
			 FROM ${this.schema}.users
			 WHERE firebase_uid = $1
			 LIMIT 1`,
			[user.uid],
		)) as Array<{
			id: string;
			firebase_uid: string;
			email: string;
			display_name: string;
			created_at: string;
		}>;

		if (existingRows.length > 0) {
			const [updatedRow] = (await sql.unsafe(
				`UPDATE ${this.schema}.users
				 SET email = $2, display_name = $3
				 WHERE firebase_uid = $1
				 RETURNING id, firebase_uid, email, display_name, created_at`,
				[user.uid, user.email.toLowerCase(), user.displayName],
			)) as Array<{
				id: string;
				firebase_uid: string;
				email: string;
				display_name: string;
				created_at: string;
			}>;

			return mapUser(updatedRow);
		}

		const [insertedRow] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.users (
				id, firebase_uid, email, display_name
			) VALUES ($1, $2, $3, $4)
			RETURNING id, firebase_uid, email, display_name, created_at`,
			[randomUUID(), user.uid, user.email.toLowerCase(), user.displayName],
		)) as Array<{
			id: string;
			firebase_uid: string;
			email: string;
			display_name: string;
			created_at: string;
		}>;

		return mapUser(insertedRow);
	}

	async findMembershipByUserId(
		userId: string,
	): Promise<MembershipWithOrganization | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				m.id,
				m.organization_id,
				m.user_id,
				m.role,
				m.joined_at,
				m.origin,
				m.welcome_dismissed_at,
				o.name AS organization_name,
				o.slug AS organization_slug,
				o.created_at AS organization_created_at
			 FROM ${this.schema}.memberships m
			 JOIN ${this.schema}.organizations o
			   ON o.id = m.organization_id
			 WHERE m.user_id = $1
			 LIMIT 1`,
			[userId],
		)) as MembershipRow[];

		return rows[0] ? mapMembership(rows[0]) : null;
	}

	async findMembershipByUserAndSlug(
		userId: string,
		slug: string,
	): Promise<MembershipWithOrganization | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				m.id,
				m.organization_id,
				m.user_id,
				m.role,
				m.joined_at,
				m.origin,
				m.welcome_dismissed_at,
				o.name AS organization_name,
				o.slug AS organization_slug,
				o.created_at AS organization_created_at
			 FROM ${this.schema}.memberships m
			 JOIN ${this.schema}.organizations o
			   ON o.id = m.organization_id
			 WHERE m.user_id = $1
			   AND o.slug = $2
			 LIMIT 1`,
			[userId, slug],
		)) as MembershipRow[];

		return rows[0] ? mapMembership(rows[0]) : null;
	}

	async findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT id, name, slug, created_at
			 FROM ${this.schema}.organizations
			 WHERE slug = $1
			 LIMIT 1`,
			[slug],
		)) as Array<{
			id: string;
			name: string;
			slug: string;
			created_at: string;
		}>;

		return rows[0] ? mapOrganization(rows[0]) : null;
	}

	async createOrganization(input: {
		name: string;
		slug: string;
	}): Promise<OrganizationRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.organizations (id, name, slug)
			 VALUES ($1, $2, $3)
			 RETURNING id, name, slug, created_at`,
			[randomUUID(), input.name, input.slug],
		)) as Array<{
			id: string;
			name: string;
			slug: string;
			created_at: string;
		}>;

		return mapOrganization(row);
	}

	async createMembership(
		input: CreateMembershipInput,
	): Promise<OrganizationMembershipRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.memberships (
				id,
				organization_id,
				user_id,
				role,
				origin
			) VALUES ($1, $2, $3, $4, $5)
			RETURNING
				id,
				organization_id,
				user_id,
				role,
				origin,
				joined_at,
				welcome_dismissed_at`,
			[
				randomUUID(),
				input.organizationId,
				input.userId,
				input.role,
				input.origin,
			],
		)) as Array<{
			id: string;
			organization_id: string;
			user_id: string;
			role: OrganizationRole;
			origin: "creator" | "invite";
			joined_at: string;
			welcome_dismissed_at: string | null;
		}>;

		return {
			id: row.id,
			organizationId: row.organization_id,
			userId: row.user_id,
			role: row.role,
			origin: row.origin,
			joinedAtIso: row.joined_at,
			welcomeDismissedAtIso: row.welcome_dismissed_at ?? undefined,
		};
	}

	async createInvite(
		input: CreateInviteRecordInput,
	): Promise<OrganizationInviteRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.invites (
				id,
				token,
				organization_id,
				email,
				role,
				invited_by_user_id
			) VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING
				id,
				token,
				organization_id,
				email,
				role,
				invited_by_user_id,
				created_at,
				accepted_at`,
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
			role: OrganizationRole;
			invited_by_user_id: string;
			created_at: string;
			accepted_at: string | null;
		}>;

		return {
			id: row.id,
			token: row.token,
			organizationId: row.organization_id,
			email: row.email,
			role: row.role,
			invitedByUserId: row.invited_by_user_id,
			createdAtIso: row.created_at,
			acceptedAtIso: row.accepted_at ?? undefined,
		};
	}

	async findInviteByToken(token: string): Promise<InviteWithOrganization | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				i.id,
				i.token,
				i.organization_id,
				i.email,
				i.role,
				i.invited_by_user_id,
				i.created_at,
				i.accepted_at,
				o.name AS organization_name,
				o.slug AS organization_slug,
				o.created_at AS organization_created_at
			 FROM ${this.schema}.invites i
			 JOIN ${this.schema}.organizations o
			   ON o.id = i.organization_id
			 WHERE i.token = $1
			 LIMIT 1`,
			[token],
		)) as InviteRow[];

		return rows[0] ? mapInvite(rows[0]) : null;
	}

	async markInviteAccepted(token: string): Promise<void> {
		await this.ensureReady();

		await sql.unsafe(
			`UPDATE ${this.schema}.invites
			 SET accepted_at = NOW()
			 WHERE token = $1`,
			[token],
		);
	}

	async dismissWelcome(
		userId: string,
		organizationId: string,
	): Promise<OrganizationMembershipRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`UPDATE ${this.schema}.memberships
			 SET welcome_dismissed_at = COALESCE(welcome_dismissed_at, NOW())
			 WHERE user_id = $1
			   AND organization_id = $2
			 RETURNING
			 	id,
			 	organization_id,
			 	user_id,
			 	role,
			 	origin,
			 	joined_at,
			 	welcome_dismissed_at`,
			[userId, organizationId],
		)) as Array<{
			id: string;
			organization_id: string;
			user_id: string;
			role: OrganizationRole;
			origin: "creator" | "invite";
			joined_at: string;
			welcome_dismissed_at: string | null;
		}>;

		return {
			id: row.id,
			organizationId: row.organization_id,
			userId: row.user_id,
			role: row.role,
			origin: row.origin,
			joinedAtIso: row.joined_at,
			welcomeDismissedAtIso: row.welcome_dismissed_at ?? undefined,
		};
	}
}
