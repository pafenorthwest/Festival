import { randomUUID } from "node:crypto";
import {
	assertExecutionFingerprint,
	assertSafeExecutionSnapshot,
	computeRecoveryReference,
	executionClaimMatches,
	isBlockingExecution,
	rowToExecution,
} from "./checkout-execution-helpers.js";
import type {
	ClassCheckoutCheckpoint,
	ClassCheckoutClaim,
	ClassCheckoutEvidence,
	ClassCheckoutExecution,
	ClassCheckoutExecutionState,
	PrepareClassCheckoutExecution,
	TransitionClassCheckoutExecution,
} from "./checkout-execution-types.js";
import type { SqlRunner } from "./registration-metadata-queries.js";

export async function advisoryLockExecutionTx(
	tx: SqlRunner,
	organizationId: string,
	key: string,
): Promise<void> {
	await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`${organizationId}:checkout:${key}`,
	]);
}

export async function dbClockNowIso(runner: SqlRunner): Promise<string> {
	const rows = (await runner.unsafe(
		"SELECT clock_timestamp()::text AS now",
	)) as Array<{ now: string }>;
	return new Date(
		String(rows[0]?.now ?? new Date().toISOString()),
	).toISOString();
}

export async function selectExecutionRow(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	intentId: string,
	lock: boolean,
): Promise<Record<string, unknown> | null> {
	const rows = (
		lock
			? await runner.unsafe(
					`SELECT *, lease_expires_at::text, recovery_recorded_at::text,
						created_at::text, updated_at::text
					FROM ${schema}.class_checkout_executions
					WHERE organization_id = $1 AND intent_id = $2
					FOR UPDATE`,
					[organizationId, intentId],
				)
			: await runner.unsafe(
					`SELECT *, lease_expires_at::text, recovery_recorded_at::text,
						created_at::text, updated_at::text
					FROM ${schema}.class_checkout_executions
					WHERE organization_id = $1 AND intent_id = $2`,
					[organizationId, intentId],
				)
	) as Record<string, unknown>[];
	return rows[0] ?? null;
}

export async function appendExecutionEventTx(
	runner: SqlRunner,
	schema: string,
	input: {
		id?: string;
		organizationId: string;
		intentId: string;
		generation: number;
		eventType: string;
		evidence?: ClassCheckoutEvidence;
	},
): Promise<void> {
	await runner.unsafe(
		`INSERT INTO ${schema}.class_checkout_execution_events (
			id, organization_id, intent_id, generation, event_type, evidence
		) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
		ON CONFLICT (id) DO NOTHING`,
		[
			input.id ?? randomUUID(),
			input.organizationId,
			input.intentId,
			input.generation,
			input.eventType,
			input.evidence ?? {},
		],
	);
}

export async function prepareExecutionTx(
	tx: SqlRunner,
	schema: string,
	input: PrepareClassCheckoutExecution,
): Promise<ClassCheckoutExecution> {
	assertSafeExecutionSnapshot(input.requestSnapshot);
	await advisoryLockExecutionTx(tx, input.organizationId, input.intentId);
	const recoveryRef = computeRecoveryReference(
		input.organizationId,
		input.intentId,
	);
	const inserted = (await tx.unsafe(
		`INSERT INTO ${schema}.class_checkout_executions (
			intent_id, organization_id, customer_id, fingerprint,
			request_snapshot, recovery_reference
		)
		SELECT id, organization_id, customer_id, $4, $5::jsonb, $6
		FROM ${schema}.checkout_intents
		WHERE id = $1
			AND organization_id = $2
			AND customer_id = $3
			AND intent_type = 'class_entry'
		ON CONFLICT (intent_id) DO NOTHING
		RETURNING intent_id`,
		[
			input.intentId,
			input.organizationId,
			input.customerId,
			input.fingerprint,
			input.requestSnapshot,
			recoveryRef,
		],
	)) as unknown[];
	const row = await selectExecutionRow(
		tx,
		schema,
		input.organizationId,
		input.intentId,
		true,
	);
	if (!row) {
		throw new Error("Class checkout intent not found.");
	}
	const value = rowToExecution(row);
	assertExecutionFingerprint(value, input.fingerprint);
	if (inserted.length > 0) {
		await appendExecutionEventTx(tx, schema, {
			organizationId: input.organizationId,
			intentId: input.intentId,
			generation: value.generation,
			eventType: "prepared",
			evidence: {},
		});
	}
	return value;
}

export async function claimExecutionTx(
	tx: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		intentId: string;
		owner: string;
		leaseMs?: number;
		allowCompleted?: boolean;
	},
): Promise<ClassCheckoutExecution | null> {
	const pre = await selectExecutionRow(
		tx,
		schema,
		input.organizationId,
		input.intentId,
		false,
	);
	if (!pre) return null;
	await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`${input.organizationId}:${String(pre.customer_id)}`,
	]);
	await advisoryLockExecutionTx(tx, input.organizationId, input.intentId);
	const row = await selectExecutionRow(
		tx,
		schema,
		input.organizationId,
		input.intentId,
		true,
	);
	if (!row) return null;
	const current = rowToExecution(row);
	const nowIso = await dbClockNowIso(tx);
	if (
		current.state === "rejected" ||
		current.state === "recovery_required" ||
		(current.state === "completed" &&
			!(input.allowCompleted && current.checkpoint === "attached")) ||
		(current.leaseExpiresAtIso && current.leaseExpiresAtIso > nowIso) ||
		(current.state === "running" && current.checkpoint === "create_dispatched")
	) {
		return null;
	}
	const blockingRow = await findBlockingRowTx(
		tx,
		schema,
		input.organizationId,
		current.customerId,
		current.intentId,
	);
	if (blockingRow) return null;
	const leaseMs = Math.max(1000, input.leaseMs ?? 30_000);
	const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
	const updated = (await tx.unsafe(
		`UPDATE ${schema}.class_checkout_executions
		SET state = 'running',
			generation = generation + 1,
			lease_owner = $3,
			lease_expires_at = $4::timestamptz,
			updated_at = clock_timestamp()
		WHERE organization_id = $1 AND intent_id = $2
		RETURNING *, lease_expires_at::text, recovery_recorded_at::text,
			created_at::text, updated_at::text`,
		[input.organizationId, input.intentId, input.owner, leaseExpiresAt],
	)) as Record<string, unknown>[];
	return updated[0] ? rowToExecution(updated[0]) : null;
}

export async function findBlockingRowTx(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	customerId: string,
	excludeIntentId?: string,
): Promise<Record<string, unknown> | null> {
	const rows = (
		excludeIntentId
			? await runner.unsafe(
					`SELECT e.*, e.lease_expires_at::text, e.recovery_recorded_at::text,
						e.created_at::text, e.updated_at::text
					FROM ${schema}.class_checkout_executions e
					JOIN ${schema}.checkout_intents i
						ON i.id = e.intent_id AND i.organization_id = e.organization_id
					WHERE e.organization_id = $1
						AND e.customer_id = $2
						AND e.intent_id <> $3
						AND i.status NOT IN ('approved', 'rejected', 'needs_review', 'superseded')
						AND (
							e.state = 'recovery_required'
							OR (e.state = 'running' AND e.lease_expires_at > clock_timestamp())
							OR (
								e.checkpoint IN ('create_dispatched', 'remote_cart_known')
								AND e.state NOT IN ('completed', 'rejected')
							)
							OR (
								e.checkpoint = 'attached'
								AND e.state IN ('ready', 'retryable', 'completed')
								AND i.expires_at <= clock_timestamp()
							)
						)
					ORDER BY e.created_at DESC
					LIMIT 1`,
					[organizationId, customerId, excludeIntentId],
				)
			: await runner.unsafe(
					`SELECT e.*, e.lease_expires_at::text, e.recovery_recorded_at::text,
						e.created_at::text, e.updated_at::text
					FROM ${schema}.class_checkout_executions e
					JOIN ${schema}.checkout_intents i
						ON i.id = e.intent_id AND i.organization_id = e.organization_id
					WHERE e.organization_id = $1
						AND e.customer_id = $2
						AND i.status NOT IN ('approved', 'rejected', 'needs_review', 'superseded')
						AND (
							e.state = 'recovery_required'
							OR (e.state = 'running' AND e.lease_expires_at > clock_timestamp())
							OR (
								e.checkpoint IN ('create_dispatched', 'remote_cart_known')
								AND e.state NOT IN ('completed', 'rejected')
							)
							OR (
								e.checkpoint = 'attached'
								AND e.state IN ('ready', 'retryable', 'completed')
								AND i.expires_at <= clock_timestamp()
							)
						)
					ORDER BY e.created_at DESC
					LIMIT 1`,
					[organizationId, customerId],
				)
	) as Record<string, unknown>[];
	return rows[0] ?? null;
}

export async function findBlockingExecutionQuery(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	customerId: string,
): Promise<ClassCheckoutExecution | null> {
	const row = await findBlockingRowTx(
		runner,
		schema,
		organizationId,
		customerId,
	);
	return row ? rowToExecution(row) : null;
}

export async function transitionExecutionTx(
	tx: SqlRunner,
	schema: string,
	input: TransitionClassCheckoutExecution,
): Promise<boolean> {
	await advisoryLockExecutionTx(
		tx,
		input.claim.organizationId,
		input.claim.intentId,
	);
	const row = await selectExecutionRow(
		tx,
		schema,
		input.claim.organizationId,
		input.claim.intentId,
		true,
	);
	if (!row) return false;
	const current = rowToExecution(row);
	const nowIso = await dbClockNowIso(tx);
	if (!executionClaimMatches(current, input.claim, nowIso)) {
		return false;
	}
	if (input.state === "rejected" && current.checkpoint !== "prepared") {
		throw new Error(
			"An externally dispatched checkout requires audited recovery.",
		);
	}
	const nextCheckpoint: ClassCheckoutCheckpoint =
		input.checkpoint ?? current.checkpoint;
	const nextState: ClassCheckoutExecutionState = input.state ?? current.state;
	const releaseLease = input.releaseLease || nextState !== "running";
	const nextLeaseOwner = releaseLease ? null : current.leaseOwner;
	const nextLeaseExpiresAt = releaseLease ? null : current.leaseExpiresAtIso;
	const nextCartId =
		input.shopifyCartId !== undefined
			? input.shopifyCartId
			: current.shopifyCartId;
	const nextBinding =
		input.storefrontBinding !== undefined
			? input.storefrontBinding
			: current.storefrontBinding;
	const nextResultCode =
		input.resultCode !== undefined ? input.resultCode : current.resultCode;

	await tx.unsafe(
		`UPDATE ${schema}.class_checkout_executions
		SET checkpoint = $3,
			state = $4,
			lease_owner = $5,
			lease_expires_at = $6::timestamptz,
			shopify_cart_id = $7,
			storefront_binding = $8::jsonb,
			result_code = $9,
			recovery_recorded_at = CASE
				WHEN $4 = 'recovery_required'
				THEN COALESCE(recovery_recorded_at, clock_timestamp())
				ELSE recovery_recorded_at
			END,
			updated_at = clock_timestamp()
		WHERE organization_id = $1 AND intent_id = $2`,
		[
			input.claim.organizationId,
			input.claim.intentId,
			nextCheckpoint,
			nextState,
			nextLeaseOwner,
			nextLeaseExpiresAt,
			nextCartId,
			nextBinding ?? null,
			nextResultCode,
		],
	);
	if (nextState === "rejected") {
		await tx.unsafe(
			`UPDATE ${schema}.checkout_intents
			SET status = 'superseded'
			WHERE organization_id = $1 AND id = $2`,
			[input.claim.organizationId, input.claim.intentId],
		);
	}
	if (input.eventType) {
		await appendExecutionEventTx(tx, schema, {
			organizationId: input.claim.organizationId,
			intentId: input.claim.intentId,
			generation: input.claim.generation,
			eventType: input.eventType,
			evidence: input.evidence,
		});
	}
	return true;
}

export async function recordRecoveryRequiredTx(
	tx: SqlRunner,
	schema: string,
	input: {
		claim: ClassCheckoutClaim;
		reason: string;
		evidence?: ClassCheckoutEvidence;
	},
): Promise<boolean> {
	await advisoryLockExecutionTx(
		tx,
		input.claim.organizationId,
		input.claim.intentId,
	);
	const row = await selectExecutionRow(
		tx,
		schema,
		input.claim.organizationId,
		input.claim.intentId,
		true,
	);
	if (!row) return false;
	const current = rowToExecution(row);
	const nowIso = await dbClockNowIso(tx);
	if (!executionClaimMatches(current, input.claim, nowIso)) {
		return false;
	}
	await tx.unsafe(
		`UPDATE ${schema}.class_checkout_executions
		SET state = 'recovery_required',
			lease_owner = NULL,
			lease_expires_at = NULL,
			result_code = $3,
			recovery_recorded_at = COALESCE(recovery_recorded_at, clock_timestamp()),
			updated_at = clock_timestamp()
		WHERE organization_id = $1 AND intent_id = $2`,
		[input.claim.organizationId, input.claim.intentId, input.reason],
	);
	await appendExecutionEventTx(tx, schema, {
		organizationId: input.claim.organizationId,
		intentId: input.claim.intentId,
		generation: input.claim.generation,
		eventType: "recovery_required",
		evidence: { code: input.reason, ...input.evidence },
	});
	return true;
}

export {
	findUnissuedInvalidCartRestartQuery,
	isUnissuedCartReplacementBlockedQuery,
	resolveExecutionTx,
	restartUnissuedInvalidCartTx,
} from "./checkout-execution-restart-queries.js";
