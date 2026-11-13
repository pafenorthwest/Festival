import { rowToExecution } from "./checkout-execution-helpers.js";
import {
	advisoryLockExecutionTx,
	appendExecutionEventTx,
	dbClockNowIso,
	selectExecutionRow,
} from "./checkout-execution-queries.js";
import type { ClassCheckoutExecution } from "./checkout-execution-types.js";
import type { SqlRunner } from "./registration-metadata-queries.js";

export async function listRecoveryExecutionsQuery(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	customerId?: string,
): Promise<ClassCheckoutExecution[]> {
	const rows = (await runner.unsafe(
		`SELECT e.*, e.lease_expires_at::text, e.recovery_recorded_at::text,
			e.created_at::text, e.updated_at::text
		FROM ${schema}.class_checkout_executions e
		WHERE e.organization_id = $1
			AND ($2::text IS NULL OR e.customer_id = $2)
			AND e.state = 'recovery_required'
		ORDER BY COALESCE(e.recovery_recorded_at, e.updated_at) DESC`,
		[organizationId, customerId ?? null],
	)) as Record<string, unknown>[];
	return rows.map(rowToExecution);
}

export async function selectExpiredExecutionCandidatesQuery(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	intentId?: string,
): Promise<Array<{ intent_id: string }>> {
	return (await runner.unsafe(
		`SELECT intent_id FROM ${schema}.class_checkout_executions
		WHERE organization_id = $1
			AND ($2::text IS NULL OR intent_id = $2)
			AND state = 'running'
			AND lease_expires_at <= clock_timestamp()`,
		[organizationId, intentId ?? null],
	)) as Array<{ intent_id: string }>;
}

export async function reapOneExpiredExecutionTx(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	intentId: string,
): Promise<number> {
	await advisoryLockExecutionTx(tx, organizationId, intentId);
	const row = await selectExecutionRow(
		tx,
		schema,
		organizationId,
		intentId,
		true,
	);
	if (!row) return 0;
	const current = rowToExecution(row);
	const nowIso = await dbClockNowIso(tx);
	if (
		current.state !== "running" ||
		!current.leaseExpiresAtIso ||
		current.leaseExpiresAtIso > nowIso
	) {
		return 0;
	}
	const nextState =
		current.checkpoint === "create_dispatched"
			? "recovery_required"
			: "retryable";
	const resultCode =
		nextState === "recovery_required" ? "checkout_creation_unknown" : null;
	await tx.unsafe(
		`UPDATE ${schema}.class_checkout_executions
		SET state = $3,
			lease_owner = NULL,
			lease_expires_at = NULL,
			result_code = $4,
			recovery_recorded_at = CASE
				WHEN $3 = 'recovery_required'
				THEN COALESCE(recovery_recorded_at, clock_timestamp())
				ELSE recovery_recorded_at
			END,
			updated_at = clock_timestamp()
		WHERE organization_id = $1 AND intent_id = $2`,
		[organizationId, intentId, nextState, resultCode],
	);
	await appendExecutionEventTx(tx, schema, {
		organizationId,
		intentId,
		generation: current.generation,
		eventType: "lease_expired",
		evidence: { stage: current.checkpoint },
	});
	return 1;
}

export async function observeExecutionPaymentTx(
	tx: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		intentId: string;
		shopifyOrderGid: string;
		approved: boolean;
	},
): Promise<void> {
	await advisoryLockExecutionTx(tx, input.organizationId, input.intentId);
	const row = await selectExecutionRow(
		tx,
		schema,
		input.organizationId,
		input.intentId,
		true,
	);
	if (!row) return;
	const exec = rowToExecution(row);
	const nextGen = exec.generation + 1;
	const nextState = input.approved
		? "completed"
		: exec.state !== "rejected"
			? "recovery_required"
			: exec.state;
	const nextResult =
		!input.approved && exec.state !== "rejected"
			? "paid_order_requires_review"
			: exec.resultCode;
	await tx.unsafe(
		`UPDATE ${schema}.class_checkout_executions
		SET state = $3,
			generation = $4,
			lease_owner = NULL,
			lease_expires_at = NULL,
			result_code = $5,
			recovery_recorded_at = CASE
				WHEN $3 = 'recovery_required'
				THEN COALESCE(recovery_recorded_at, clock_timestamp())
				ELSE recovery_recorded_at
			END,
			updated_at = clock_timestamp()
		WHERE organization_id = $1 AND intent_id = $2`,
		[input.organizationId, input.intentId, nextState, nextGen, nextResult],
	);
	await appendExecutionEventTx(tx, schema, {
		organizationId: input.organizationId,
		intentId: input.intentId,
		generation: nextGen,
		eventType: "paid_order_observed",
		evidence: { shopifyOrderGid: input.shopifyOrderGid },
	});
}

export async function recordApplicationExpiryTx(
	tx: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		intentId: string;
		expectedGeneration: number;
	},
): Promise<ClassCheckoutExecution | null> {
	await advisoryLockExecutionTx(tx, input.organizationId, input.intentId);
	const expired = (await tx.unsafe(
		`SELECT 1 FROM ${schema}.checkout_intents
		WHERE organization_id = $1 AND id = $2
			AND expires_at <= clock_timestamp()
			AND status NOT IN ('approved', 'rejected', 'needs_review', 'superseded')`,
		[input.organizationId, input.intentId],
	)) as unknown[];
	if (expired.length === 0) return null;
	const row = await selectExecutionRow(
		tx,
		schema,
		input.organizationId,
		input.intentId,
		true,
	);
	if (!row) return null;
	const exec = rowToExecution(row);
	if (exec.generation !== input.expectedGeneration) return null;
	if (exec.state === "recovery_required") return exec;
	if (
		!["ready", "retryable", "completed"].includes(exec.state) ||
		!["attached", "remote_cart_known"].includes(exec.checkpoint)
	) {
		return null;
	}
	const nextGen = exec.generation + 1;
	const rows = (await tx.unsafe(
		`UPDATE ${schema}.class_checkout_executions
		SET state = 'recovery_required',
			generation = $3,
			lease_owner = NULL,
			lease_expires_at = NULL,
			result_code = 'checkout_expired',
			recovery_recorded_at = COALESCE(recovery_recorded_at, clock_timestamp()),
			updated_at = clock_timestamp()
		WHERE organization_id = $1 AND intent_id = $2
		RETURNING *, lease_expires_at::text, recovery_recorded_at::text,
			created_at::text, updated_at::text`,
		[input.organizationId, input.intentId, nextGen],
	)) as Record<string, unknown>[];
	await appendExecutionEventTx(tx, schema, {
		organizationId: input.organizationId,
		intentId: input.intentId,
		generation: nextGen,
		eventType: "application_checkout_expired",
		evidence: { stage: exec.checkpoint, code: "checkout_expired" },
	});
	return rows[0] ? rowToExecution(rows[0]) : null;
}
