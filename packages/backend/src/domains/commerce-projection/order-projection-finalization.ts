import { randomUUID } from "node:crypto";
import {
	assertValidClassEntitlementInput,
	assertValidEntitlementGrantSnapshotInput,
	type ClassEntitlement,
	type CreateClassEntitlementInput,
	type CreateEntitlementGrantSnapshotInput,
} from "@festival/common";
import {
	CLASS_ENTITLEMENT_COLUMNS,
	classEntitlementFromRow,
} from "./class-entitlement-repository.js";
import { insertClassEntitlementsTx } from "./order-projection-class-tx.js";
import {
	insertMembershipGrantTx,
	prepareMembershipGrantTx,
	resolveDecisionManuallyTx,
	type SqlRunner,
	upsertOrderProjectionTx,
} from "./order-projection-membership-tx.js";
import {
	assertMatchingClassEntitlementReplay,
	decisionFromRow,
	type FinalizeDecisionInput,
	type FinalizeDecisionResult,
} from "./order-projection-types.js";

export { resolveDecisionManuallyTx, upsertOrderProjectionTx };

interface CheckoutExecutionRow {
	intent_id: string;
	state: string;
	checkpoint: string;
	generation: number;
	result_code: string | null;
}

const DECISION_SELECT = `id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at::text, updated_at::text`;

export function normalizeFinalizeInput(
	input: FinalizeDecisionInput,
): CreateClassEntitlementInput[] {
	if (input.classEntitlement && input.classEntitlements !== undefined) {
		throw new Error(
			"Approved decision cannot specify both a class entitlement and class entitlements.",
		);
	}
	const classEntitlementInputs =
		input.classEntitlements ??
		(input.classEntitlement ? [input.classEntitlement] : []);
	if (input.decision.status === "approved") {
		validateApprovedFinalizeInput(input, classEntitlementInputs);
	} else if (input.grant || classEntitlementInputs.length > 0) {
		throw new Error(
			"Non-approved decision cannot create a grant or class entitlement.",
		);
	}
	if (
		input.projection &&
		(input.projection.organizationId !== input.decision.organizationId ||
			input.projection.shopifyOrderGid !== input.decision.shopifyOrderGid)
	) {
		throw new Error("Order projection does not match its validation decision.");
	}
	return classEntitlementInputs;
}

function validateApprovedFinalizeInput(
	input: FinalizeDecisionInput,
	classEntitlementInputs: CreateClassEntitlementInput[],
): void {
	if (input.grant && classEntitlementInputs.length > 0) {
		throw new Error(
			"Approved decision cannot specify both a membership grant and class entitlement.",
		);
	}
	if (!input.grant && classEntitlementInputs.length === 0) {
		throw new Error("Approved decision requires a grant or class entitlement.");
	}
	if (input.grant) {
		assertValidEntitlementGrantSnapshotInput(input.grant);
		if (
			input.grant.organizationId !== input.decision.organizationId ||
			input.grant.customerId !== input.decision.customerId ||
			input.grant.checkoutIntentId !== input.decision.checkoutIntentId ||
			input.grant.shopifyOrderGid !== input.decision.shopifyOrderGid ||
			input.grant.shopifyOrderLineGid !== input.decision.shopifyOrderLineGid
		) {
			throw new Error("Approved decision and grant do not match.");
		}
	}
	for (const item of classEntitlementInputs) {
		assertValidClassEntitlementInput(item);
		if (
			item.organizationId !== input.decision.organizationId ||
			item.parentCustomerId !== input.decision.customerId ||
			item.checkoutIntentId !== input.decision.checkoutIntentId ||
			item.shopifyOrderGid !== input.decision.shopifyOrderGid ||
			(input.classEntitlement &&
				item.shopifyOrderLineGid !== input.decision.shopifyOrderLineGid)
		) {
			throw new Error("Approved decision and class entitlement do not match.");
		}
	}
}

async function acquireFinalizationLocks(
	tx: SqlRunner,
	schema: string,
	decisionInput: FinalizeDecisionInput["decision"],
	hasClassEntitlements: boolean,
): Promise<void> {
	if (hasClassEntitlements) {
		await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
			`${schema}:class-capacity-cutoff`,
		]);
	}
	if (decisionInput.customerId) {
		await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
			`${decisionInput.organizationId}:${decisionInput.customerId}`,
		]);
	}
	if (decisionInput.checkoutIntentId) {
		await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
			`${decisionInput.organizationId}:checkout:${decisionInput.checkoutIntentId}`,
		]);
	}
	await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`${decisionInput.organizationId}:${decisionInput.shopifyOrderGid}`,
	]);
}

async function checkExistingOrderDecisionReplay(
	tx: SqlRunner,
	schema: string,
	input: FinalizeDecisionInput,
	existingRow: Record<string, unknown> | undefined,
	classEntitlementInputs: CreateClassEntitlementInput[],
): Promise<FinalizeDecisionResult | undefined> {
	if (!existingRow || existingRow.status === "pending_validation") {
		return undefined;
	}
	const existingClasses = await Promise.all(
		classEntitlementInputs.map(async (item) => {
			const rows = (await tx.unsafe(
				`SELECT ${CLASS_ENTITLEMENT_COLUMNS} FROM ${schema}.class_entitlements WHERE organization_id = $1 AND shopify_order_line_gid = $2 FOR UPDATE`,
				[input.decision.organizationId, item.shopifyOrderLineGid],
			)) as Array<Record<string, unknown>>;
			if (!rows[0]) return null;
			const existingClass = classEntitlementFromRow(rows[0]);
			assertMatchingClassEntitlementReplay(existingClass, item);
			return existingClass;
		}),
	);
	if (classEntitlementInputs.length === 0 || existingClasses.every(Boolean)) {
		await tx.unsafe(
			`UPDATE ${schema}.shopify_webhook_deliveries SET status = 'processed', failure_category = NULL, failure_stage = NULL, failure_code = NULL, shopify_request_id = NULL, failed_at = NULL, processed_at = NOW() WHERE id = $1`,
			[input.deliveryId],
		);
		return {
			decision: decisionFromRow(existingRow),
			classEntitlement: existingClasses[0] ?? undefined,
			classEntitlements: existingClasses.filter(
				(item): item is ClassEntitlement => Boolean(item),
			),
			existing: true,
		};
	}
	return undefined;
}

async function checkCorrelatedOrderReplay(
	tx: SqlRunner,
	schema: string,
	input: FinalizeDecisionInput,
	findClassByLine: (
		organizationId: string,
		lineGid: string,
	) => Promise<ClassEntitlement | null>,
): Promise<FinalizeDecisionResult | undefined> {
	if (!input.decision.checkoutIntentId) return undefined;
	const correlatedRows = (await tx.unsafe(
		`SELECT ${DECISION_SELECT} FROM ${schema}.membership_validation_decisions WHERE organization_id = $1 AND checkout_intent_id = $2 FOR UPDATE`,
		[input.decision.organizationId, input.decision.checkoutIntentId],
	)) as Array<Record<string, unknown>>;
	if (
		!correlatedRows[0] ||
		correlatedRows[0].shopify_order_gid === input.decision.shopifyOrderGid
	) {
		return undefined;
	}
	await tx.unsafe(
		`UPDATE ${schema}.shopify_webhook_deliveries SET status = 'processed', failure_category = NULL, failure_stage = NULL, failure_code = NULL, shopify_request_id = NULL, failed_at = NULL, processing_started_at = NULL, processed_at = NOW() WHERE id = $1`,
		[input.deliveryId],
	);
	const existingClass = input.decision.shopifyOrderLineGid
		? await findClassByLine(
				input.decision.organizationId,
				input.decision.shopifyOrderLineGid,
			)
		: null;
	return {
		decision: decisionFromRow(correlatedRows[0]),
		classEntitlement: existingClass ?? undefined,
		existing: true,
	};
}

async function updateExecutionAndIntentTx(
	tx: SqlRunner,
	schema: string,
	finalDecision: FinalizeDecisionInput["decision"],
	execution: CheckoutExecutionRow | undefined,
): Promise<void> {
	if (!finalDecision.checkoutIntentId) return;
	if (execution) {
		const nextState =
			execution.state === "rejected"
				? "rejected"
				: finalDecision.status === "approved"
					? "completed"
					: "recovery_required";
		await tx.unsafe(
			`UPDATE ${schema}.class_checkout_executions SET state=$3, generation=generation+1, lease_owner=NULL, lease_expires_at=NULL, result_code=CASE WHEN state='rejected' THEN result_code ELSE $4 END, recovery_recorded_at=CASE WHEN $3='recovery_required' THEN COALESCE(recovery_recorded_at,clock_timestamp()) ELSE recovery_recorded_at END, updated_at=clock_timestamp() WHERE organization_id=$1 AND intent_id=$2`,
			[
				finalDecision.organizationId,
				finalDecision.checkoutIntentId,
				nextState,
				finalDecision.status === "approved"
					? "checkout_completed"
					: "paid_order_requires_review",
			],
		);
		await tx.unsafe(
			`INSERT INTO ${schema}.class_checkout_execution_events (id,organization_id,intent_id,generation,event_type,evidence) VALUES ($1,$2,$3,$4,'paid_order_observed',$5::jsonb)`,
			[
				randomUUID(),
				finalDecision.organizationId,
				finalDecision.checkoutIntentId,
				Number(execution.generation) + 1,
				JSON.stringify({
					code: finalDecision.status,
					shopifyOrderGid: finalDecision.shopifyOrderGid,
				}),
			],
		);
	}
	const resolved = (await tx.unsafe(
		`UPDATE ${schema}.checkout_intents SET status = $1 WHERE id = $2 AND organization_id = $3 RETURNING id`,
		[
			finalDecision.status,
			finalDecision.checkoutIntentId,
			finalDecision.organizationId,
		],
	)) as Array<Record<string, unknown>>;
	if (!resolved[0]) throw new Error("Checkout intent was not found.");
}

async function persistDecisionAndDeliveryTx(
	tx: SqlRunner,
	schema: string,
	existingDecisionId: unknown,
	finalDecision: FinalizeDecisionInput["decision"],
	execution: CheckoutExecutionRow | undefined,
	deliveryId: string,
): Promise<Record<string, unknown>> {
	const decisionRows = existingDecisionId
		? ((await tx.unsafe(
				`UPDATE ${schema}.membership_validation_decisions SET customer_id = $2, checkout_intent_id = $3, shopify_order_line_gid = $4, status = $5, reason_code = $6, updated_at = $7::timestamptz WHERE id = $1 RETURNING ${DECISION_SELECT}`,
				[
					existingDecisionId,
					finalDecision.customerId ?? null,
					finalDecision.checkoutIntentId ?? null,
					finalDecision.shopifyOrderLineGid ?? null,
					finalDecision.status,
					finalDecision.reasonCode ?? null,
					finalDecision.updatedAtIso,
				],
			)) as Array<Record<string, unknown>>)
		: ((await tx.unsafe(
				`INSERT INTO ${schema}.membership_validation_decisions (id, organization_id, customer_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, status, reason_code, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$9::timestamptz) RETURNING ${DECISION_SELECT}`,
				[
					randomUUID(),
					finalDecision.organizationId,
					finalDecision.customerId ?? null,
					finalDecision.checkoutIntentId ?? null,
					finalDecision.shopifyOrderGid,
					finalDecision.shopifyOrderLineGid ?? null,
					finalDecision.status,
					finalDecision.reasonCode ?? null,
					finalDecision.updatedAtIso,
				],
			)) as Array<Record<string, unknown>>);
	await updateExecutionAndIntentTx(tx, schema, finalDecision, execution);
	await tx.unsafe(
		`UPDATE ${schema}.shopify_webhook_deliveries SET status = 'processed', failure_category = NULL, failure_stage = NULL, failure_code = NULL, shopify_request_id = NULL, failed_at = NULL, processing_started_at = NULL, processed_at = NOW() WHERE id = $1`,
		[deliveryId],
	);
	return decisionRows[0];
}

async function applyClassExecutionGuardTx(
	tx: SqlRunner,
	schema: string,
	finalDecision: FinalizeDecisionInput["decision"],
	grantInput: CreateEntitlementGrantSnapshotInput | undefined,
	classInputs: CreateClassEntitlementInput[],
): Promise<{
	finalDecision: FinalizeDecisionInput["decision"];
	grantInput: CreateEntitlementGrantSnapshotInput | undefined;
	classInputs: CreateClassEntitlementInput[];
	execution: CheckoutExecutionRow | undefined;
}> {
	const executionRows =
		finalDecision.checkoutIntentId && !grantInput
			? ((await tx.unsafe(
					`SELECT intent_id, state, checkpoint, generation, result_code FROM ${schema}.class_checkout_executions WHERE organization_id=$1 AND intent_id=$2 FOR UPDATE`,
					[finalDecision.organizationId, finalDecision.checkoutIntentId],
				)) as CheckoutExecutionRow[])
			: [];
	const execution = executionRows[0];
	if (
		execution &&
		(execution.checkpoint !== "attached" || execution.state === "rejected")
	) {
		return {
			finalDecision: {
				...finalDecision,
				status: "needs_review",
				reasonCode: "upstream_invalid",
			},
			grantInput: undefined,
			classInputs: [],
			execution,
		};
	}
	return { finalDecision, grantInput, classInputs, execution };
}

async function prepareFinalizedStateTx(
	tx: SqlRunner,
	schema: string,
	input: FinalizeDecisionInput,
	initialClassInputs: CreateClassEntitlementInput[],
) {
	const guarded = await applyClassExecutionGuardTx(
		tx,
		schema,
		input.decision,
		input.grant,
		initialClassInputs,
	);
	const prepared: {
		decision: FinalizeDecisionInput["decision"];
		grant?: CreateEntitlementGrantSnapshotInput;
		nextEntitlementId?: string;
	} =
		guarded.grantInput && guarded.finalDecision.customerId
			? await prepareMembershipGrantTx(
					tx,
					schema,
					guarded.finalDecision,
					guarded.grantInput,
				)
			: { decision: guarded.finalDecision, grant: guarded.grantInput };
	return { guarded, prepared };
}

async function persistFinalizedEntitiesTx(
	tx: SqlRunner,
	schema: string,
	input: FinalizeDecisionInput,
	existingDecisionId: unknown,
	initialClassInputs: CreateClassEntitlementInput[],
): Promise<FinalizeDecisionResult> {
	const { guarded, prepared } = await prepareFinalizedStateTx(
		tx,
		schema,
		input,
		initialClassInputs,
	);
	if (input.projection)
		await upsertOrderProjectionTx(tx, schema, input.projection);
	const createdGrant = prepared.grant
		? await insertMembershipGrantTx(
				tx,
				schema,
				prepared.grant,
				prepared.nextEntitlementId ?? randomUUID(),
				new Date().toISOString(),
			)
		: undefined;
	const createdClassEntitlements = await insertClassEntitlementsTx(
		tx,
		schema,
		guarded.classInputs,
	);
	const decisionRow = await persistDecisionAndDeliveryTx(
		tx,
		schema,
		existingDecisionId,
		prepared.decision,
		guarded.execution,
		input.deliveryId,
	);
	return {
		decision: decisionFromRow(decisionRow),
		grant: createdGrant,
		classEntitlement: createdClassEntitlements[0],
		classEntitlements:
			createdClassEntitlements.length > 0
				? createdClassEntitlements
				: undefined,
		existing: false,
	};
}

export async function finalizeDecisionTx(
	tx: SqlRunner,
	schema: string,
	input: FinalizeDecisionInput,
	initialClassInputs: CreateClassEntitlementInput[],
	findClassByLine: (
		organizationId: string,
		lineGid: string,
	) => Promise<ClassEntitlement | null>,
): Promise<FinalizeDecisionResult> {
	await acquireFinalizationLocks(
		tx,
		schema,
		input.decision,
		initialClassInputs.length > 0,
	);
	const existingRows = (await tx.unsafe(
		`SELECT ${DECISION_SELECT} FROM ${schema}.membership_validation_decisions WHERE organization_id = $1 AND shopify_order_gid = $2 FOR UPDATE`,
		[input.decision.organizationId, input.decision.shopifyOrderGid],
	)) as Array<Record<string, unknown>>;
	const replay =
		(await checkExistingOrderDecisionReplay(
			tx,
			schema,
			input,
			existingRows[0],
			initialClassInputs,
		)) ??
		(await checkCorrelatedOrderReplay(tx, schema, input, findClassByLine));
	if (replay) return replay;
	return persistFinalizedEntitiesTx(
		tx,
		schema,
		input,
		existingRows[0]?.id,
		initialClassInputs,
	);
}
