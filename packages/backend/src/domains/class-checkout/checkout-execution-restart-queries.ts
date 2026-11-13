import { createHash } from "node:crypto";
import {
	resolvedExecution,
	rowToExecution,
	rowToExecutionEvent,
	unissuedInvalidCartRestartDecision,
} from "./checkout-execution-helpers.js";
import {
	advisoryLockExecutionTx,
	appendExecutionEventTx,
	selectExecutionRow,
} from "./checkout-execution-queries.js";
import type {
	ClassCheckoutExecution,
	FindUnissuedInvalidCartRestartInput,
	ResolveClassCheckoutExecution,
	RestartUnissuedInvalidCartInput,
	UnissuedCartReplacementInput,
} from "./checkout-execution-types.js";
import type { SqlRunner } from "./registration-metadata-queries.js";

export async function resolveExecutionTx(
	tx: SqlRunner,
	schema: string,
	input: ResolveClassCheckoutExecution,
): Promise<ClassCheckoutExecution | null> {
	await advisoryLockExecutionTx(tx, input.organizationId, input.intentId);
	const paid = (await tx.unsafe(
		`SELECT 1 FROM ${schema}.checkout_intents
		WHERE id = $1 AND organization_id = $2
			AND status IN ('approved', 'rejected', 'needs_review')`,
		[input.intentId, input.organizationId],
	)) as unknown[];
	if (paid.length > 0) return null;
	const row = await selectExecutionRow(
		tx,
		schema,
		input.organizationId,
		input.intentId,
		true,
	);
	if (!row) return null;
	const updated = resolvedExecution(rowToExecution(row), input);
	if (!updated) return null;
	const rows = (await tx.unsafe(
		`UPDATE ${schema}.class_checkout_executions
		SET state = $3,
			checkpoint = $4,
			generation = $5,
			lease_owner = NULL,
			lease_expires_at = NULL,
			shopify_cart_id = $6,
			storefront_binding = $7::jsonb,
			result_code = $8,
			updated_at = clock_timestamp()
		WHERE organization_id = $1 AND intent_id = $2
		RETURNING *, lease_expires_at::text, recovery_recorded_at::text,
			created_at::text, updated_at::text`,
		[
			input.organizationId,
			input.intentId,
			updated.state,
			updated.checkpoint,
			updated.generation,
			updated.shopifyCartId,
			updated.storefrontBinding ?? null,
			updated.resultCode,
		],
	)) as Record<string, unknown>[];
	if (input.action === "abandon") {
		await tx.unsafe(
			`UPDATE ${schema}.checkout_intents
			SET status = 'superseded'
			WHERE organization_id = $1 AND id = $2
				AND status NOT IN ('approved', 'superseded')`,
			[input.organizationId, input.intentId],
		);
	}
	await appendExecutionEventTx(tx, schema, {
		organizationId: input.organizationId,
		intentId: input.intentId,
		generation: updated.generation,
		eventType: "resolved",
		evidence: {
			actorId: input.actorId,
			message: input.reason,
			resolution: input.action,
			shopifyCartId: input.shopifyCartId ?? updated.shopifyCartId ?? undefined,
		},
	});
	return rows[0] ? rowToExecution(rows[0]) : updated;
}

async function evaluateRestartCandidateTx(
	runner: SqlRunner,
	schema: string,
	value: ClassCheckoutExecution,
	lock: boolean,
): Promise<{
	createdAt: string;
	decision: { replacementKey: string } | "restartable";
} | null> {
	const rows = (await runner.unsafe(
		`SELECT intent.status, intent.cart_reference, intent.created_at::text,
			EXISTS (
				SELECT 1 FROM ${schema}.membership_validation_decisions decision
				WHERE decision.organization_id = intent.organization_id
					AND decision.checkout_intent_id = intent.id
			)
			OR EXISTS (
				SELECT 1 FROM ${schema}.shopify_order_projections projection
				WHERE projection.organization_id = intent.organization_id
					AND projection.correlation_id = intent.correlation_id
			)
			OR EXISTS (
				SELECT 1 FROM ${schema}.class_entitlements entitlement
				WHERE entitlement.organization_id = intent.organization_id
					AND entitlement.checkout_intent_id = intent.id
			) AS payment_observed
		FROM ${schema}.checkout_intents intent
		WHERE intent.organization_id = $1
			AND intent.customer_id = $2
			AND intent.id = $3
			AND intent.intent_type = 'class_entry'${lock ? " FOR UPDATE" : ""}`,
		[value.organizationId, value.customerId, value.intentId],
	)) as Array<{
		status: string;
		cart_reference: string | null;
		created_at: string;
		payment_observed: boolean;
	}>;
	const intent = rows[0];
	if (!intent || intent.cart_reference || intent.payment_observed) {
		return null;
	}
	const eventRows = (await runner.unsafe(
		`SELECT ev.*, ev.created_at::text
		FROM ${schema}.class_checkout_execution_events ev
		WHERE ev.organization_id = $1 AND ev.intent_id = $2
		ORDER BY ev.created_at ASC, ev.id ASC`,
		[value.organizationId, value.intentId],
	)) as Record<string, unknown>[];
	const decision = unissuedInvalidCartRestartDecision(
		value,
		intent.status,
		eventRows.map(rowToExecutionEvent),
	);
	return decision ? { createdAt: intent.created_at, decision } : null;
}

async function isReplacementIntentClosedQuery(
	runner: SqlRunner,
	schema: string,
	value: ClassCheckoutExecution,
	replacementKey: string,
): Promise<boolean> {
	const rows = (await runner.unsafe(
		`SELECT 1 FROM ${schema}.checkout_intents intent
		WHERE intent.organization_id = $1
			AND intent.customer_id = $2
			AND intent.idempotency_key = $3
			AND intent.intent_type = 'class_entry'
			AND (
				intent.status NOT IN ('creating', 'ready', 'checkout_started')
				OR EXISTS (
					SELECT 1 FROM ${schema}.membership_validation_decisions decision
					WHERE decision.organization_id = intent.organization_id
						AND decision.checkout_intent_id = intent.id
				)
				OR EXISTS (
					SELECT 1 FROM ${schema}.shopify_order_projections projection
					WHERE projection.organization_id = intent.organization_id
						AND projection.correlation_id = intent.correlation_id
				)
				OR EXISTS (
					SELECT 1 FROM ${schema}.class_entitlements entitlement
					WHERE entitlement.organization_id = intent.organization_id
						AND entitlement.checkout_intent_id = intent.id
				)
			)
		LIMIT 1`,
		[value.organizationId, value.customerId, replacementKey],
	)) as unknown[];
	return rows.length > 0;
}

export async function restartUnissuedInvalidCartTx(
	tx: SqlRunner,
	schema: string,
	input: RestartUnissuedInvalidCartInput,
): Promise<{ replacementKey: string } | null> {
	await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`${input.organizationId}:${input.customerId}`,
	]);
	await advisoryLockExecutionTx(tx, input.organizationId, input.intentId);
	const execRow = await selectExecutionRow(
		tx,
		schema,
		input.organizationId,
		input.intentId,
		true,
	);
	if (!execRow) return null;
	const exec = rowToExecution(execRow);
	if (exec.customerId !== input.customerId) return null;
	const candidate = await evaluateRestartCandidateTx(tx, schema, exec, true);
	if (!candidate) return null;
	if (candidate.decision !== "restartable") {
		const closed = await isReplacementIntentClosedQuery(
			tx,
			schema,
			exec,
			candidate.decision.replacementKey,
		);
		return closed ? null : candidate.decision;
	}
	const replacementKey = `restart_${createHash("sha256")
		.update(`${input.organizationId}:${input.intentId}:${exec.generation}`)
		.digest("hex")
		.slice(0, 16)}`;
	const nextGen = exec.generation + 1;
	await tx.unsafe(
		`UPDATE ${schema}.class_checkout_executions
		SET state = 'rejected',
			generation = $3,
			lease_owner = NULL,
			lease_expires_at = NULL,
			result_code = 'checkout_restarted_unissued',
			updated_at = clock_timestamp()
		WHERE organization_id = $1 AND intent_id = $2`,
		[input.organizationId, input.intentId, nextGen],
	);
	await tx.unsafe(
		`UPDATE ${schema}.checkout_intents
		SET status = 'superseded'
		WHERE organization_id = $1 AND customer_id = $2 AND id = $3`,
		[input.organizationId, input.customerId, input.intentId],
	);
	await appendExecutionEventTx(tx, schema, {
		id: replacementKey,
		organizationId: input.organizationId,
		intentId: input.intentId,
		generation: nextGen,
		eventType: "customer_restarted_unissued",
		evidence: {
			actorId: input.customerId,
			resolution: "customer_restarted_unissued",
			...(exec.shopifyCartId ? { shopifyCartId: exec.shopifyCartId } : {}),
		},
	});
	return { replacementKey };
}

export async function findUnissuedInvalidCartRestartQuery(
	runner: SqlRunner,
	schema: string,
	input: FindUnissuedInvalidCartRestartInput,
): Promise<ClassCheckoutExecution | null> {
	const rows = (await runner.unsafe(
		`SELECT e.*, e.lease_expires_at::text, e.recovery_recorded_at::text,
			e.created_at::text, e.updated_at::text
		FROM ${schema}.class_checkout_executions e
		JOIN ${schema}.checkout_intents i
			ON i.id = e.intent_id AND i.organization_id = e.organization_id
		WHERE e.organization_id = $1
			AND e.customer_id = $2
			AND (
				lower((
					CASE jsonb_typeof(e.request_snapshot)
						WHEN 'string' THEN (e.request_snapshot #>> '{}')::jsonb
						ELSE e.request_snapshot
					END
				) ->> 'festivalShortName') = lower($3)
				OR EXISTS (
					SELECT 1 FROM ${schema}.registration_metadata metadata
					JOIN ${schema}.festivals festival
						ON festival.id = metadata.festival_id
						AND festival.organization_id = metadata.organization_id
					WHERE metadata.organization_id = i.organization_id
						AND metadata.checkout_intent_id = i.id
						AND lower(festival.short_name) = lower($3)
				)
			)
		ORDER BY (i.status = 'creating') DESC, i.created_at DESC, i.id`,
		[input.organizationId, input.customerId, input.festivalShortName],
	)) as Record<string, unknown>[];
	for (const row of rows) {
		const value = rowToExecution(row);
		const candidate = await evaluateRestartCandidateTx(
			runner,
			schema,
			value,
			false,
		);
		if (!candidate) continue;
		if (candidate.decision === "restartable") return value;
		if (
			await isReplacementIntentClosedQuery(
				runner,
				schema,
				value,
				candidate.decision.replacementKey,
			)
		) {
			continue;
		}
		const newer = (await runner.unsafe(
			`SELECT 1 FROM ${schema}.checkout_intents intent
			LEFT JOIN ${schema}.class_checkout_executions execution
				ON execution.intent_id = intent.id
				AND execution.organization_id = intent.organization_id
			LEFT JOIN ${schema}.festival_class_configurations cfg
				ON cfg.id = intent.festival_class_id
				AND cfg.organization_id = intent.organization_id
			LEFT JOIN ${schema}.festivals festival
				ON festival.id = cfg.festival_id
				AND festival.organization_id = cfg.organization_id
			WHERE intent.organization_id = $1
				AND intent.customer_id = $2
				AND intent.id <> $3
				AND intent.intent_type = 'class_entry'
				AND intent.idempotency_key <> $6
				AND intent.created_at > $4::timestamptz
				AND (
					lower((
						CASE jsonb_typeof(execution.request_snapshot)
							WHEN 'string' THEN (execution.request_snapshot #>> '{}')::jsonb
							ELSE execution.request_snapshot
						END
					) ->> 'festivalShortName') = lower($5)
					OR lower(festival.short_name) = lower($5)
				)
			LIMIT 1`,
			[
				input.organizationId,
				input.customerId,
				value.intentId,
				candidate.createdAt,
				input.festivalShortName,
				candidate.decision.replacementKey,
			],
		)) as unknown[];
		if (newer.length === 0) return value;
	}
	return null;
}

export async function isUnissuedCartReplacementBlockedQuery(
	runner: SqlRunner,
	schema: string,
	input: UnissuedCartReplacementInput,
): Promise<boolean> {
	const rows = (await runner.unsafe(
		`SELECT e.*, e.lease_expires_at::text, e.recovery_recorded_at::text,
			e.created_at::text, e.updated_at::text
		FROM ${schema}.class_checkout_execution_events ev
		JOIN ${schema}.class_checkout_executions e
			ON e.intent_id = ev.intent_id AND e.organization_id = ev.organization_id
		WHERE ev.id = $1
			AND ev.event_type = 'customer_restarted_unissued'
			AND e.organization_id = $2
			AND e.customer_id = $3`,
		[input.replacementKey, input.organizationId, input.customerId],
	)) as Record<string, unknown>[];
	if (!rows[0]) return false;
	const candidate = await evaluateRestartCandidateTx(
		runner,
		schema,
		rowToExecution(rows[0]),
		false,
	);
	return (
		!candidate ||
		candidate.decision === "restartable" ||
		candidate.decision.replacementKey !== input.replacementKey
	);
}
