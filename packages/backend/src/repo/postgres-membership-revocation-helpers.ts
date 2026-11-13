import { randomUUID } from "node:crypto";
import { AppError } from "@festival/common";
import type { EntitlementRevocationRecord } from "./organization-repository-types.js";
import type { SqlRunner } from "./postgres-membership-grant-helpers.js";

async function lockEntitlementForRevocation(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	entitlementId: string,
): Promise<{
	customerId: string;
	entitlementClass: string;
	isExpired: boolean;
}> {
	const initial = (await tx.unsafe(
		`SELECT customer_id FROM ${schema}.membership_entitlements WHERE id=$1 AND organization_id=$2`,
		[entitlementId, organizationId],
	)) as Array<{ customer_id: string }>;
	if (!initial[0]) throw new AppError("Entitlement was not found.", 404);
	await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`${organizationId}:${initial[0].customer_id}`,
	]);
	const rows = (await tx.unsafe(
		`SELECT e.customer_id, e.entitlement_class,
				(e.ends_on <= (NOW() AT TIME ZONE o.timezone)::date) AS is_expired
		 FROM ${schema}.membership_entitlements e
		 JOIN ${schema}.organizations o ON o.id = e.organization_id
		 WHERE e.id=$1 AND e.organization_id=$2 FOR UPDATE OF e`,
		[entitlementId, organizationId],
	)) as Array<{
		customer_id: string;
		entitlement_class: string;
		is_expired: boolean;
	}>;
	if (!rows[0]) throw new AppError("Entitlement was not found.", 404);
	return {
		customerId: rows[0].customer_id,
		entitlementClass: rows[0].entitlement_class,
		isExpired: rows[0].is_expired,
	};
}

async function updateEntitlementRevocationRowsTx(
	tx: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	},
): Promise<string> {
	await tx.unsafe(
		`UPDATE ${schema}.membership_entitlements SET revoked_at=$3::timestamptz, revoked_reason=$4 WHERE id=$1 AND organization_id=$2`,
		[
			input.entitlementId,
			input.organizationId,
			input.revokedAtIso,
			input.reason,
		],
	);
	const id = randomUUID();
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_revocations (id,entitlement_id,organization_id,actor_user_id,reason,revoked_at)
		 VALUES ($1,$2,$3,$4,$5,$6::timestamptz)`,
		[
			id,
			input.entitlementId,
			input.organizationId,
			input.actorUserId,
			input.reason,
			input.revokedAtIso,
		],
	);
	return id;
}

async function applyRevocationWritesTx(
	tx: SqlRunner,
	schema: string,
	entitlement: { customerId: string; entitlementClass: string },
	input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	},
): Promise<EntitlementRevocationRecord> {
	const id = await updateEntitlementRevocationRowsTx(tx, schema, input);
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_cohorts (organization_id,customer_id,entitlement_class)
		 VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
		[
			input.organizationId,
			entitlement.customerId,
			entitlement.entitlementClass,
		],
	);
	await tx.unsafe(
		`UPDATE ${schema}.membership_entitlement_cohorts SET version=version+1
		 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class=$3`,
		[
			input.organizationId,
			entitlement.customerId,
			entitlement.entitlementClass,
		],
	);
	return {
		id,
		entitlementId: input.entitlementId,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		reason: input.reason,
		revokedAtIso: input.revokedAtIso,
	};
}

/** Revokes an active non-expired membership entitlement inside a transaction. */
export async function revokeEntitlementTx(
	tx: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	},
): Promise<{ revocation: EntitlementRevocationRecord; existing: boolean }> {
	const entitlement = await lockEntitlementForRevocation(
		tx,
		schema,
		input.organizationId,
		input.entitlementId,
	);
	const existing = (await tx.unsafe(
		`SELECT id, entitlement_id, organization_id, actor_user_id, reason, revoked_at::text
		 FROM ${schema}.membership_entitlement_revocations WHERE entitlement_id=$1 AND organization_id=$2`,
		[input.entitlementId, input.organizationId],
	)) as Array<{
		id: string;
		entitlement_id: string;
		organization_id: string;
		actor_user_id: string;
		reason: string;
		revoked_at: string;
	}>;
	if (existing[0]) {
		return {
			revocation: {
				id: existing[0].id,
				entitlementId: existing[0].entitlement_id,
				organizationId: existing[0].organization_id,
				actorUserId: existing[0].actor_user_id,
				reason: existing[0].reason,
				revokedAtIso: existing[0].revoked_at,
			},
			existing: true,
		};
	}
	if (entitlement.isExpired) {
		throw new AppError("Expired entitlements cannot be revoked.", 409);
	}
	return {
		revocation: await applyRevocationWritesTx(tx, schema, entitlement, input),
		existing: false,
	};
}
