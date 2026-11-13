import { randomUUID } from "node:crypto";
import {
	AppError,
	addCalendarDays,
	assertValidEntitlementGrantSnapshotInput,
	type CreateEntitlementGrantSnapshotInput,
	type EntitlementGrantSnapshot,
} from "@festival/common";
import type { sql } from "bun";
import {
	decisionFromRow,
	type FinalizeDecisionInput,
	type MembershipDecisionAuditRecord,
	type ResolveDecisionManuallyInput,
	type ResolveDecisionManuallyResult,
	type ShopifyOrderProjectionInput,
} from "./order-projection-types.js";

export type SqlRunner = Pick<typeof sql, "unsafe">;

const DECISION_SELECT = `id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text`;

export async function upsertOrderProjectionTx(
	tx: SqlRunner,
	schema: string,
	projection: ShopifyOrderProjectionInput,
): Promise<void> {
	await tx.unsafe(
		`INSERT INTO ${schema}.shopify_order_projections (organization_id, shopify_order_gid, shopify_customer_gid, correlation_id, fully_paid_at, currency_code, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7::timestamptz,$7::timestamptz) ON CONFLICT (organization_id, shopify_order_gid) DO UPDATE SET shopify_customer_gid = EXCLUDED.shopify_customer_gid, correlation_id = EXCLUDED.correlation_id, fully_paid_at = EXCLUDED.fully_paid_at, currency_code = EXCLUDED.currency_code, updated_at = EXCLUDED.updated_at`,
		[
			projection.organizationId,
			projection.shopifyOrderGid,
			projection.shopifyCustomerGid ?? null,
			projection.correlationId ?? null,
			projection.fullyPaidAtIso ?? null,
			projection.currencyCode ?? null,
			projection.updatedAtIso,
		],
	);
}

export async function advanceMembershipCohortVersion(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	customerId: string,
	grantInput: CreateEntitlementGrantSnapshotInput,
): Promise<boolean> {
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_cohorts (organization_id,customer_id,entitlement_class) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
		[organizationId, customerId, grantInput.entitlementClass],
	);
	for (let attempt = 0; attempt < 2; attempt++) {
		const cohort = (await tx.unsafe(
			`SELECT version FROM ${schema}.membership_entitlement_cohorts WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class=$3 FOR UPDATE`,
			[organizationId, customerId, grantInput.entitlementClass],
		)) as Array<{ version: number }>;
		const updated =
			cohort[0] &&
			(await tx.unsafe(
				`UPDATE ${schema}.membership_entitlement_cohorts SET version=version+1 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class=$3 AND version=$4 RETURNING version`,
				[
					organizationId,
					customerId,
					grantInput.entitlementClass,
					cohort[0].version,
				],
			));
		if (updated && updated.count === 1) return true;
	}
	const refreshedEntitlements = (await tx.unsafe(
		`SELECT 1 FROM ${schema}.membership_entitlements e WHERE e.organization_id=$1 AND e.customer_id=$2 AND e.entitlement_class=$3 AND e.revoked_at IS NULL AND e.superseded_on IS NULL AND (e.starts_on > $4::date OR e.ends_on > ($4::date + INTERVAL '30 days')::date) LIMIT 1 FOR UPDATE`,
		[
			organizationId,
			customerId,
			grantInput.entitlementClass,
			grantInput.startsOn,
		],
	)) as Array<Record<string, unknown>>;
	if (!refreshedEntitlements[0]) {
		throw new Error("Entitlement cohort compare-and-swap retry failed.");
	}
	return false;
}

async function claimIdentityEmailTx(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	email: string,
	customerId: string | undefined,
): Promise<boolean> {
	const rows = (await tx.unsafe(
		`INSERT INTO ${schema}.membership_identity_emails (organization_id, normalized_email, customer_id) VALUES ($1,$2,$3) ON CONFLICT (organization_id, normalized_email) DO UPDATE SET customer_id = EXCLUDED.customer_id WHERE ${schema}.membership_identity_emails.customer_id = EXCLUDED.customer_id RETURNING customer_id`,
		[organizationId, email, customerId],
	)) as Array<Record<string, unknown>>;
	return Boolean(rows[0]);
}

async function resolveSupersededEntitlementTx(
	tx: SqlRunner,
	schema: string,
	decisionInput: FinalizeDecisionInput["decision"],
	grantInput: CreateEntitlementGrantSnapshotInput,
): Promise<{
	conflict: boolean;
	supersededId?: string;
	nextGrant: CreateEntitlementGrantSnapshotInput;
}> {
	const rows = (await tx.unsafe(
		`SELECT e.id, e.starts_on::text, e.ends_on::text, (e.starts_on > $4::date) AS scheduled, (e.ends_on > ($4::date + INTERVAL '30 days')::date) AS outside_renewal_window FROM ${schema}.membership_entitlements e WHERE e.organization_id=$1 AND e.customer_id=$2 AND e.entitlement_class=$3 AND e.revoked_at IS NULL AND e.superseded_on IS NULL AND e.ends_on > $4::date ORDER BY e.starts_on FOR UPDATE`,
		[
			decisionInput.organizationId,
			decisionInput.customerId,
			grantInput.entitlementClass,
			grantInput.startsOn,
		],
	)) as Array<{
		id: string;
		starts_on: string;
		ends_on: string;
		scheduled: boolean;
		outside_renewal_window: boolean;
	}>;
	if (rows.some((row) => row.scheduled || row.outside_renewal_window)) {
		return { conflict: true, nextGrant: grantInput };
	}
	if (!rows[0]) return { conflict: false, nextGrant: grantInput };
	const effectiveStart =
		rows[0].ends_on > grantInput.startsOn
			? rows[0].ends_on
			: grantInput.startsOn;
	return {
		conflict: false,
		supersededId: rows[0].id,
		nextGrant: {
			...grantInput,
			endsOn: addCalendarDays(effectiveStart, grantInput.durationDays),
		},
	};
}

async function markSupersededGrantTx(
	tx: SqlRunner,
	schema: string,
	supersededId: string | undefined,
	nextGrant: CreateEntitlementGrantSnapshotInput,
	nextEntitlementId: string,
): Promise<void> {
	if (!supersededId) return;
	await tx.unsafe(
		`UPDATE ${schema}.membership_entitlements SET superseded_on = $3::date, superseded_at = NOW(), superseded_by_grant_id = $4 WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL AND superseded_on IS NULL`,
		[
			supersededId,
			nextGrant.organizationId,
			nextGrant.startsOn,
			nextEntitlementId,
		],
	);
}

function reviewDecisionResult(
	decisionInput: FinalizeDecisionInput["decision"],
	reasonCode: "upstream_invalid" | "duplicate_purchase",
) {
	return {
		decision: {
			...decisionInput,
			status: "needs_review" as const,
			reasonCode,
		},
	};
}

export async function prepareMembershipGrantTx(
	tx: SqlRunner,
	schema: string,
	decisionInput: FinalizeDecisionInput["decision"],
	grantInput: CreateEntitlementGrantSnapshotInput,
): Promise<{
	decision: FinalizeDecisionInput["decision"];
	grant?: CreateEntitlementGrantSnapshotInput;
	nextEntitlementId?: string;
}> {
	if (!grantInput.verifiedIdentityEmail) {
		return reviewDecisionResult(decisionInput, "upstream_invalid");
	}
	const claimed = await claimIdentityEmailTx(
		tx,
		schema,
		decisionInput.organizationId,
		grantInput.verifiedIdentityEmail,
		decisionInput.customerId,
	);
	if (!claimed) {
		return reviewDecisionResult(decisionInput, "upstream_invalid");
	}
	const resolved = await resolveSupersededEntitlementTx(
		tx,
		schema,
		decisionInput,
		grantInput,
	);
	if (resolved.conflict) {
		return reviewDecisionResult(decisionInput, "duplicate_purchase");
	}
	const cohortAdvanced = await advanceMembershipCohortVersion(
		tx,
		schema,
		decisionInput.organizationId,
		decisionInput.customerId as string,
		resolved.nextGrant,
	);
	if (!cohortAdvanced) {
		return reviewDecisionResult(decisionInput, "duplicate_purchase");
	}
	const nextEntitlementId = randomUUID();
	await markSupersededGrantTx(
		tx,
		schema,
		resolved.supersededId,
		resolved.nextGrant,
		nextEntitlementId,
	);
	return {
		decision: decisionInput,
		grant: resolved.nextGrant,
		nextEntitlementId,
	};
}

export async function insertMembershipGrantTx(
	tx: SqlRunner,
	schema: string,
	grantInput: CreateEntitlementGrantSnapshotInput,
	entitlementId: string,
	createdAtIso: string,
): Promise<EntitlementGrantSnapshot> {
	const entitlementRows = (await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlements (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on) SELECT $1,$2,$3,$4,'teacher_checkout',$5,$6::date,$7::date FROM ${schema}.products WHERE id=$5 AND organization_id=$2 AND entitlement_class=$4 RETURNING id`,
		[
			entitlementId,
			grantInput.organizationId,
			grantInput.customerId,
			grantInput.entitlementClass,
			grantInput.offeringId,
			grantInput.startsOn,
			grantInput.endsOn,
		],
	)) as Array<Record<string, unknown>>;
	if (!entitlementRows[0]) {
		throw new Error("Entitlement offering was not found.");
	}
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_divisions (entitlement_id,organization_id,division_id,division_name_snapshot) VALUES ($1,$2,$3,$4)`,
		[
			entitlementId,
			grantInput.organizationId,
			grantInput.divisionId,
			grantInput.divisionNameSnapshot,
		],
	);
	await tx.unsafe(
		`INSERT INTO ${schema}.teacher_membership_entitlement_details (entitlement_id,checkout_intent_id,shopify_order_gid,shopify_order_line_gid,paid_amount,paid_currency_code,duration_days) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		[
			entitlementId,
			grantInput.checkoutIntentId,
			grantInput.shopifyOrderGid,
			grantInput.shopifyOrderLineGid,
			grantInput.paidAmount,
			grantInput.paidCurrencyCode,
			grantInput.durationDays,
		],
	);
	return { ...grantInput, id: entitlementId, createdAtIso };
}

async function insertManualApprovalGrantTx(
	tx: SqlRunner,
	schema: string,
	input: ResolveDecisionManuallyInput,
): Promise<EntitlementGrantSnapshot> {
	if (!input.grant) {
		throw new AppError("Approved decision requires a grant.", 422);
	}
	assertValidEntitlementGrantSnapshotInput(input.grant);
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_identity_emails (organization_id, normalized_email, customer_id) VALUES ($1,$2,$3) ON CONFLICT (organization_id, normalized_email) DO UPDATE SET customer_id = EXCLUDED.customer_id WHERE ${schema}.membership_identity_emails.customer_id = EXCLUDED.customer_id`,
		[
			input.grant.organizationId,
			input.grant.verifiedIdentityEmail ?? "",
			input.grant.customerId,
		],
	);
	return insertMembershipGrantTx(
		tx,
		schema,
		input.grant,
		randomUUID(),
		input.resolvedAtIso,
	);
}

async function recordManualDecisionAuditTx(
	tx: SqlRunner,
	schema: string,
	decisionId: string,
	priorStatus: "pending_validation" | "needs_review",
	input: ResolveDecisionManuallyInput,
): Promise<MembershipDecisionAuditRecord> {
	const auditId = randomUUID();
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_validation_decision_audits (id, organization_id, decision_id, prior_status, final_status, actor_user_id, note, resolved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)`,
		[
			auditId,
			input.organizationId,
			decisionId,
			priorStatus,
			input.finalStatus,
			input.actorUserId,
			input.note,
			input.resolvedAtIso,
		],
	);
	return {
		id: auditId,
		organizationId: input.organizationId,
		decisionId,
		priorStatus,
		finalStatus: input.finalStatus,
		actorUserId: input.actorUserId,
		note: input.note,
		resolvedAtIso: input.resolvedAtIso,
	};
}

export async function resolveDecisionManuallyTx(
	tx: SqlRunner,
	schema: string,
	input: ResolveDecisionManuallyInput,
): Promise<ResolveDecisionManuallyResult> {
	const rows = (await tx.unsafe(
		`SELECT ${DECISION_SELECT} FROM ${schema}.membership_validation_decisions WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
		[input.organizationId, input.decisionId],
	)) as Array<Record<string, unknown>>;
	if (!rows[0]) throw new AppError("Validation decision was not found.", 404);
	const existing = decisionFromRow(rows[0]);
	if (
		existing.status !== "pending_validation" &&
		existing.status !== "needs_review"
	) {
		throw new AppError("Validation decision is already resolved.", 409);
	}
	const createdGrant =
		input.finalStatus === "approved"
			? await insertManualApprovalGrantTx(tx, schema, input)
			: undefined;
	if (input.projection) {
		await upsertOrderProjectionTx(tx, schema, input.projection);
	}
	const checkoutIntentId =
		input.checkoutIntentId ?? existing.checkoutIntentId ?? null;
	const updatedRows = (await tx.unsafe(
		`UPDATE ${schema}.membership_validation_decisions SET customer_id = $2, checkout_intent_id = $3, shopify_order_line_gid = $4, status = $5, reason_code = $6, updated_at = $7::timestamptz WHERE id = $1 RETURNING ${DECISION_SELECT}`,
		[
			existing.id,
			input.customerId ?? existing.customerId ?? null,
			checkoutIntentId,
			input.shopifyOrderLineGid ?? existing.shopifyOrderLineGid ?? null,
			input.finalStatus,
			input.finalStatus === "approved" ? null : (existing.reasonCode ?? null),
			input.resolvedAtIso,
		],
	)) as Array<Record<string, unknown>>;
	if (checkoutIntentId) {
		await tx.unsafe(
			`UPDATE ${schema}.checkout_intents SET status = $1 WHERE id = $2 AND organization_id = $3`,
			[input.finalStatus, checkoutIntentId, input.organizationId],
		);
	}
	const audit = await recordManualDecisionAuditTx(
		tx,
		schema,
		existing.id,
		existing.status,
		input,
	);
	return {
		decision: decisionFromRow(updatedRows[0]),
		grant: createdGrant,
		audit,
	};
}
