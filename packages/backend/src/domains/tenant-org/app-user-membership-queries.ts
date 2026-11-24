import { randomUUID } from "node:crypto";
import {
	AppError,
	type AuthenticatedUser,
	deriveDisplayName,
	type OrganizationMembershipRecord,
	type OrganizationUserRecord,
} from "@festival/common";
import { sql } from "bun";
import {
	type InviteJoinRow,
	type MembershipRow,
	type MembershipWithOrganization,
	mapInviteWithOrganization,
	mapMembership,
	mapOrganizationUser,
	type UserRow,
} from "./tenant-mappers.js";

type SqlRunner = Pick<typeof sql, "unsafe">;

export function isPendingInviteDuplicateError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const pgErr = error as {
		code?: string;
		errno?: string;
		constraint?: string;
		message?: string;
	};
	const isUniqueViolation = pgErr.errno === "23505" || pgErr.code === "23505";
	return (
		isUniqueViolation &&
		(pgErr.constraint === "idx_invites_pending_org_email_lower" ||
			Boolean(pgErr.message?.includes("idx_invites_pending_org_email_lower")))
	);
}

export async function upsertOrgUserSql(
	schema: string,
	user: AuthenticatedUser,
	runner: SqlRunner = sql,
): Promise<OrganizationUserRecord> {
	const explicitDisplayName = user.displayName ?? null;
	const insertDisplayName = explicitDisplayName ?? deriveDisplayName(user);
	const normalizedEmail = user.email.trim().toLowerCase();
	const rows = (await runner.unsafe(
		`WITH _lock AS (
			SELECT pg_advisory_xact_lock(hashtext($2))
		 )
		 INSERT INTO ${schema}.users (id, firebase_uid, email, display_name, disassociated)
		 SELECT $1, $2, $3, $4, FALSE
		 FROM _lock
		 ON CONFLICT (firebase_uid) DO UPDATE SET
		   email = EXCLUDED.email,
		   display_name = COALESCE($5, ${schema}.users.display_name),
		   disassociated = FALSE
		 RETURNING id, firebase_uid, email, display_name, disassociated, created_at`,
		[
			randomUUID(),
			user.uid,
			normalizedEmail,
			insertDisplayName,
			explicitDisplayName,
		],
	)) as UserRow[];
	if (!rows[0]) throw new Error("Failed to upsert user.");
	return mapOrganizationUser(rows[0]);
}

async function upsertInviteMembershipSql(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	userId: string,
	role: OrganizationMembershipRecord["role"],
): Promise<OrganizationMembershipRecord> {
	const inserted = (await tx.unsafe(
		`INSERT INTO ${schema}.memberships (id, organization_id, user_id, role, origin)
		 VALUES ($1, $2, $3, $4, 'invite')
		 ON CONFLICT (organization_id, user_id) DO NOTHING
		 RETURNING id, organization_id, user_id, role, origin, joined_at, welcome_dismissed_at`,
		[randomUUID(), organizationId, userId, role],
	)) as MembershipRow[];
	if (inserted[0]) return mapMembership(inserted[0]);

	const existing = (await tx.unsafe(
		`SELECT id, organization_id, user_id, role, origin, joined_at, welcome_dismissed_at
		 FROM ${schema}.memberships
		 WHERE organization_id = $1 AND user_id = $2
		 LIMIT 1`,
		[organizationId, userId],
	)) as MembershipRow[];
	if (!existing[0]) throw new Error("Failed to resolve invite membership.");
	return mapMembership(existing[0]);
}

export async function acceptInviteTx(
	schema: string,
	input: { token: string; user: AuthenticatedUser },
): Promise<MembershipWithOrganization> {
	return sql.begin(async (tx) => {
		const lookupRows = (await tx.unsafe(
			`SELECT
				i.id, i.token, i.organization_id, i.email, i.role, i.invited_by_user_id,
				i.created_at, i.accepted_at,
				o.name AS organization_name, o.slug AS organization_slug,
				o.created_at AS organization_created_at, o.timezone AS organization_timezone,
				o.default_currency_code AS organization_default_currency_code
			 FROM ${schema}.invites i
			 JOIN ${schema}.organizations o ON o.id = i.organization_id
			 WHERE i.token = $1
			 LIMIT 1`,
			[input.token],
		)) as InviteJoinRow[];
		if (!lookupRows[0]) throw new AppError("Invite not found.", 404);

		const record = mapInviteWithOrganization(lookupRows[0]);
		const normalizedEmail = input.user.email.trim().toLowerCase();
		if (record.invite.email.trim().toLowerCase() !== normalizedEmail) {
			throw new AppError(
				"Invite email does not match the authenticated user.",
				403,
			);
		}
		if (record.invite.acceptedAtIso) {
			throw new AppError("Invite has already been accepted.", 409);
		}

		const user = await upsertOrgUserSql(
			schema,
			{ ...input.user, email: normalizedEmail },
			tx,
		);
		const claimed = (await tx.unsafe(
			`UPDATE ${schema}.invites
			 SET accepted_at = NOW()
			 WHERE token = $1 AND accepted_at IS NULL
			 RETURNING id`,
			[input.token],
		)) as Array<{ id: string }>;
		if (!claimed[0]) {
			const recheck = (await tx.unsafe(
				`SELECT accepted_at FROM ${schema}.invites WHERE token = $1 LIMIT 1`,
				[input.token],
			)) as Array<{ accepted_at: Date | string | null }>;
			if (!recheck[0]) throw new AppError("Invite not found.", 404);
			throw new AppError("Invite has already been accepted.", 409);
		}

		const membership = await upsertInviteMembershipSql(
			tx,
			schema,
			record.organization.id,
			user.id,
			record.invite.role,
		);
		return { membership, organization: record.organization };
	});
}

export async function deleteMembershipTx(
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
