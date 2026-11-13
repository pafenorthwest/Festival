import { randomUUID } from "node:crypto";
import {
	findBlockingRowTx,
	prepareExecutionTx,
} from "./checkout-execution-queries.js";
import type { ClassCheckoutExecutionRepository } from "./checkout-execution-types.js";
import {
	buildReplayStateRow,
	type CheckoutCartRow,
	type CheckoutIntentLineRow,
	type CheckoutIntentRow,
	ensureIntentLines,
	mapCheckoutCartRow,
	mapCheckoutIntentLineRow,
	mapCheckoutIntentRow,
	resolveExistingOutcome,
} from "./checkout-intent-helpers.js";
import { buildIntentLineRecords } from "./checkout-line-helpers.js";
import {
	type CheckoutCartRecord,
	type CheckoutIntentLineItemRecord,
	type CheckoutIntentOutcome,
	type CheckoutIntentRecord,
	CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL,
	type ClassCheckoutReplayState,
	type CreateCheckoutIntentInput,
} from "./checkout-types.js";
import type { SqlRunner } from "./registration-metadata-queries.js";

export { attachCartTx } from "./checkout-cart-attach-queries.js";

const INTENT_COLUMNS = `id, correlation_id, organization_id, customer_id, session_id,
	idempotency_key, intent_type, offering_id, entitlement_class, duration_days,
	festival_class_id, child_id, shopify_product_gid, shopify_variant_gid,
	policy_version, division_id, division_name_snapshot, staff_access_consent,
	amount, currency_code, line_identity_protocol, cart_reference, status,
	expires_at::text, created_at::text`;

export async function loadIntentLines(
	runner: SqlRunner,
	schema: string,
	intentId: string,
): Promise<CheckoutIntentLineItemRecord[]> {
	const rows = (await runner.unsafe(
		`SELECT id, checkout_intent_id, line_index, line_type, festival_class_id,
			child_id, offering_id, shopify_product_gid, shopify_variant_gid,
			amount, currency_code, division_id, division_name_snapshot,
			created_at::text
		FROM ${schema}.checkout_intent_lines
		WHERE checkout_intent_id = $1
		ORDER BY line_index ASC`,
		[intentId],
	)) as CheckoutIntentLineRow[];
	return rows.map(mapCheckoutIntentLineRow);
}

export async function loadCartByReference(
	runner: SqlRunner,
	schema: string,
	cartReference: string | null,
	organizationId: string,
): Promise<CheckoutCartRecord | null> {
	if (!cartReference) return null;
	const rows = (await runner.unsafe(
		`SELECT reference, shopify_cart_id, organization_id, customer_id,
			session_id, integration_version, status, expires_at::text, created_at::text
		FROM ${schema}.checkout_carts
		WHERE reference = $1 AND organization_id = $2`,
		[cartReference, organizationId],
	)) as CheckoutCartRow[];
	return rows[0] ? mapCheckoutCartRow(rows[0]) : null;
}

export async function queryIntentByKey(
	runner: SqlRunner,
	schema: string,
	input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	},
	forUpdate: boolean,
): Promise<CheckoutIntentRecord | null> {
	const rows = (
		forUpdate
			? await runner.unsafe(
					`SELECT ${INTENT_COLUMNS}
					FROM ${schema}.checkout_intents
					WHERE organization_id = $1
						AND customer_id = $2
						AND session_id = $3
						AND idempotency_key = $4
					FOR UPDATE`,
					[
						input.organizationId,
						input.customerId,
						input.sessionId,
						input.idempotencyKey,
					],
				)
			: await runner.unsafe(
					`SELECT ${INTENT_COLUMNS}
					FROM ${schema}.checkout_intents
					WHERE organization_id = $1
						AND customer_id = $2
						AND session_id = $3
						AND idempotency_key = $4`,
					[
						input.organizationId,
						input.customerId,
						input.sessionId,
						input.idempotencyKey,
					],
				)
	) as CheckoutIntentRow[];
	if (!rows[0]) return null;
	const lines = await loadIntentLines(runner, schema, rows[0].id);
	return ensureIntentLines(mapCheckoutIntentRow(rows[0], lines));
}

async function insertIntentLinesTx(
	tx: SqlRunner,
	schema: string,
	lines: CheckoutIntentLineItemRecord[],
): Promise<void> {
	for (const line of lines) {
		await tx.unsafe(
			`INSERT INTO ${schema}.checkout_intent_lines (
				id, checkout_intent_id, line_index, line_type,
				festival_class_id, child_id, offering_id,
				shopify_product_gid, shopify_variant_gid,
				amount, currency_code, division_id, division_name_snapshot
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			[
				line.id,
				line.checkoutIntentId,
				line.lineIndex,
				line.lineType,
				line.festivalClassId,
				line.childId,
				line.offeringId,
				line.shopifyProductGid,
				line.shopifyVariantGid,
				line.amount,
				line.currencyCode,
				line.divisionId,
				line.divisionNameSnapshot,
			],
		);
	}
}

async function hasActiveMembershipGrantTx(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	customerId: string,
	entitlementClass: string,
): Promise<boolean> {
	const rows = (await tx.unsafe(
		`SELECT 1 FROM ${schema}.membership_entitlements grants
		JOIN ${schema}.organizations organization
			ON organization.id = grants.organization_id
		WHERE grants.organization_id = $1
			AND grants.customer_id = $2
			AND grants.entitlement_class = $3
			AND grants.revoked_at IS NULL
			AND grants.superseded_on IS NULL
			AND (
				grants.starts_on > (NOW() AT TIME ZONE organization.timezone)::date
				OR grants.ends_on > ((NOW() AT TIME ZONE organization.timezone)::date + INTERVAL '30 days')::date
			)
		LIMIT 1`,
		[organizationId, customerId, entitlementClass],
	)) as unknown[];
	return rows.length > 0;
}

export async function createIntentTx(
	tx: SqlRunner,
	schema: string,
	input: CreateCheckoutIntentInput,
	nowIso: string,
	classExecutions?: ClassCheckoutExecutionRepository,
): Promise<CheckoutIntentOutcome> {
	await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`${input.organizationId}:${input.customerId}`,
	]);
	if (
		input.entitlementClass &&
		(await hasActiveMembershipGrantTx(
			tx,
			schema,
			input.organizationId,
			input.customerId,
			input.entitlementClass,
		))
	) {
		return { kind: "active" };
	}
	const existing = await queryIntentByKey(tx, schema, input, true);
	if (existing) {
		const cart = await loadCartByReference(
			tx,
			schema,
			existing.cartReference,
			existing.organizationId,
		);
		return resolveExistingOutcome(existing, cart, nowIso, classExecutions);
	}
	const intentType = input.intentType ?? "membership";
	if (
		intentType === "class_entry" &&
		(await findBlockingRowTx(
			tx,
			schema,
			input.organizationId,
			input.customerId,
		))
	) {
		return { kind: "in_progress" };
	}
	const activeRows = (await tx.unsafe(
		`SELECT id FROM ${schema}.checkout_intents
		WHERE organization_id = $1
			AND customer_id = $2
			AND status IN ('creating', 'ready', 'checkout_started')
			AND expires_at > NOW()
		LIMIT 1 FOR UPDATE`,
		[input.organizationId, input.customerId],
	)) as Array<{ id: string }>;
	if (activeRows.length > 0) {
		return { kind: "in_progress" };
	}
	return insertIntentAndExecutionTx(tx, schema, input, intentType);
}

async function insertIntentAndExecutionTx(
	tx: SqlRunner,
	schema: string,
	input: CreateCheckoutIntentInput,
	intentType: string,
): Promise<CheckoutIntentOutcome> {
	const intentId = randomUUID();
	const correlationId = randomUUID();
	const lineProtocol =
		input.lineIdentityProtocol !== undefined
			? input.lineIdentityProtocol
			: intentType === "class_entry"
				? CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL
				: null;
	const inserted = (await tx.unsafe(
		`INSERT INTO ${schema}.checkout_intents (
			id, correlation_id, organization_id, customer_id, session_id,
			idempotency_key, intent_type, offering_id, entitlement_class,
			duration_days, festival_class_id, child_id, shopify_product_gid,
			shopify_variant_gid, policy_version, division_id,
			division_name_snapshot, staff_access_consent, amount,
			currency_code, line_identity_protocol, status, expires_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
			$13, $14, $15, $16, $17, $18, $19, $20, $21, 'creating', $22::timestamptz
		) RETURNING ${INTENT_COLUMNS}`,
		[
			intentId,
			correlationId,
			input.organizationId,
			input.customerId,
			input.sessionId,
			input.idempotencyKey,
			intentType,
			input.offeringId ?? null,
			input.entitlementClass ?? null,
			input.durationDays ?? null,
			input.festivalClassId ?? null,
			input.childId ?? null,
			input.shopifyProductGid,
			input.shopifyVariantGid,
			input.policyVersion ?? null,
			input.divisionId ?? null,
			input.divisionNameSnapshot ?? null,
			input.staffAccessConsent ?? false,
			input.amount,
			input.currencyCode,
			lineProtocol,
			input.expiresAtIso,
		],
	)) as CheckoutIntentRow[];
	const intent = mapCheckoutIntentRow(inserted[0]);
	const lines = buildIntentLineRecords(intent, input.lines);
	await insertIntentLinesTx(tx, schema, lines);
	if (input.classExecution) {
		await prepareExecutionTx(tx, schema, {
			organizationId: intent.organizationId,
			customerId: intent.customerId,
			intentId: intent.id,
			...input.classExecution,
		});
	}
	return { kind: "created", intent: { ...intent, lines } };
}

export async function queryReplayState(
	runner: SqlRunner,
	schema: string,
	organizationId: string,
	intentId: string,
): Promise<ClassCheckoutReplayState | null> {
	const rows = (await runner.unsafe(
		`SELECT i.status AS intent_status, e.state AS execution_state,
			e.generation, e.result_code
		FROM ${schema}.checkout_intents i
		LEFT JOIN ${schema}.class_checkout_executions e
			ON e.intent_id = i.id AND e.organization_id = i.organization_id
		WHERE i.organization_id = $1 AND i.id = $2`,
		[organizationId, intentId],
	)) as Array<{
		intent_status: string;
		execution_state: string | null;
		generation: number | string | null;
		result_code: string | null;
	}>;
	return rows[0] ? buildReplayStateRow(rows[0]) : null;
}

export { INTENT_COLUMNS };
