import { randomUUID } from "node:crypto";
import { AppError } from "@festival/common";
import { sql } from "bun";
import {
	advisoryLockExecutionTx,
	appendExecutionEventTx,
} from "./checkout-execution-queries.js";
import type { ClassCheckoutClaim } from "./checkout-execution-types.js";
import {
	type CheckoutCartRow,
	mapCheckoutCartRow,
} from "./checkout-intent-helpers.js";
import type { CheckoutCartRecord } from "./checkout-types.js";
import type { SqlRunner } from "./registration-metadata-queries.js";

async function verifyClassEntryCapacityTx(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	intentId: string,
	fallback: { festival_class_id: string | null; child_id: string | null },
): Promise<AppError | null> {
	const lineRows = (await tx.unsafe(
		`SELECT festival_class_id, child_id
		FROM ${schema}.checkout_intent_lines
		WHERE checkout_intent_id = $1 AND line_type = 'class_entry'
		ORDER BY line_index ASC`,
		[intentId],
	)) as Array<{ festival_class_id: string | null; child_id: string | null }>;
	const lines = (lineRows.length > 0 ? lineRows : [fallback]).map((r) => ({
		festivalClassId: String(r.festival_class_id ?? ""),
		childId: String(r.child_id ?? ""),
	}));
	const classIds = [...new Set(lines.map((l) => l.festivalClassId))];
	const configs = (await tx.unsafe(
		`SELECT id, organization_id, festival_id, capacity, is_active
		FROM ${schema}.festival_class_configurations
		WHERE organization_id = $1 AND id = ANY($2::text[])`,
		[organizationId, sql.array(classIds, "text")],
	)) as Array<Record<string, unknown>>;
	const countRows = (await tx.unsafe(
		`SELECT festival_class_id, COUNT(*)::int AS count
		FROM ${schema}.class_entitlements
		WHERE organization_id = $1 AND festival_class_id = ANY($2::text[]) AND status = 'confirmed'
		GROUP BY festival_class_id`,
		[organizationId, sql.array(classIds, "text")],
	)) as Array<{ festival_class_id: string; count: number | string }>;
	return buildClassCapacityError(lines, classIds, configs, countRows);
}

function buildClassCapacityError(
	lines: Array<{ festivalClassId: string; childId: string }>,
	classIds: string[],
	configs: Array<Record<string, unknown>>,
	countRows: Array<{ festival_class_id: string; count: number | string }>,
): AppError | null {
	const byId = new Map(configs.map((c) => [String(c.id), c]));
	const counts = new Map(
		countRows.map((c) => [String(c.festival_class_id), Number(c.count)]),
	);
	const festivalId = configs[0] ? String(configs[0].festival_id) : "";
	const failures: Record<string, unknown>[] = [];
	for (const classId of classIds) {
		const cls = byId.get(classId);
		const cap = cls ? Number(cls.capacity) : 0;
		const placed = counts.get(classId) ?? 0;
		if (
			!cls?.is_active ||
			String(cls.festival_id) !== festivalId ||
			cap <= 0 ||
			placed >= cap
		) {
			const msg = !cls?.is_active
				? "Class is no longer available and is in waitlist state."
				: "Class has reached capacity and is now on the waitlist.";
			for (const l of lines.filter(
				(item) => item.festivalClassId === classId,
			)) {
				failures.push({
					childId: l.childId,
					festivalClassId: classId,
					reasonCode: "SOLD_OUT",
					availability: "waitlist",
					reason: msg,
					message: msg,
					capacity: cap,
					placedCount: placed,
				});
			}
		}
	}
	if (failures.length === 0) return null;
	return new AppError(String(failures[0].message), 400, "sold_out", {
		failures,
		waitlistedClassIds: [
			...new Set(failures.map((f) => String(f.festivalClassId))),
		],
	});
}

async function verifyExecutionClaimForAttachTx(
	tx: SqlRunner,
	schema: string,
	claim: ClassCheckoutClaim,
): Promise<void> {
	const claimRows = (await tx.unsafe(
		`SELECT 1 FROM ${schema}.class_checkout_executions
		WHERE intent_id = $1 AND organization_id = $2
			AND generation = $3 AND lease_owner = $4
			AND lease_expires_at > clock_timestamp() AND state = 'running'
		FOR UPDATE`,
		[claim.intentId, claim.organizationId, claim.generation, claim.owner],
	)) as Record<string, unknown>[];
	if (claimRows.length === 0) {
		throw new Error("Checkout execution claim is stale.");
	}
}

async function loadExistingAttachedCartTx(
	tx: SqlRunner,
	schema: string,
	cartReference: string | null,
	shopifyCartId: string,
): Promise<CheckoutCartRecord | null> {
	if (!cartReference) return null;
	const existing = (await tx.unsafe(
		`SELECT reference, shopify_cart_id, organization_id, customer_id,
			session_id, integration_version, status, expires_at::text, created_at::text
		FROM ${schema}.checkout_carts
		WHERE reference = $1 AND shopify_cart_id = $2`,
		[cartReference, shopifyCartId],
	)) as CheckoutCartRow[];
	return existing[0] ? mapCheckoutCartRow(existing[0]) : null;
}

async function insertAndLinkCartTx(
	tx: SqlRunner,
	schema: string,
	input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
		intentId: string;
		executionClaim?: ClassCheckoutClaim;
	},
): Promise<CheckoutCartRecord> {
	const reference = randomUUID();
	const cartRows = (await tx.unsafe(
		`INSERT INTO ${schema}.checkout_carts (
			reference, shopify_cart_id, organization_id, customer_id,
			session_id, integration_version, status, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7::timestamptz)
		RETURNING reference, shopify_cart_id, organization_id, customer_id,
			session_id, integration_version, status, expires_at::text, created_at::text`,
		[
			reference,
			input.shopifyCartId,
			input.organizationId,
			input.customerId,
			input.sessionId,
			input.integrationVersion,
			input.expiresAtIso,
		],
	)) as CheckoutCartRow[];
	if (!cartRows[0]) throw new Error("Checkout cart persistence failed.");
	await tx.unsafe(
		`UPDATE ${schema}.checkout_intents
		SET status = 'ready', cart_reference = $1
		WHERE id = $2 AND organization_id = $3`,
		[reference, input.intentId, input.organizationId],
	);
	if (input.executionClaim) {
		await tx.unsafe(
			`UPDATE ${schema}.class_checkout_executions
			SET checkpoint = 'attached', updated_at = clock_timestamp()
			WHERE intent_id = $1 AND organization_id = $2`,
			[input.intentId, input.organizationId],
		);
		await appendExecutionEventTx(tx, schema, {
			organizationId: input.organizationId,
			intentId: input.intentId,
			generation: input.executionClaim.generation,
			eventType: "cart_attached",
			evidence: {},
		});
	}
	return mapCheckoutCartRow(cartRows[0]);
}

export async function attachCartTx(
	tx: SqlRunner,
	schema: string,
	input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
		intentId: string;
		capacityCheck?: () => Promise<AppError | null>;
		executionClaim?: ClassCheckoutClaim;
	},
): Promise<CheckoutCartRecord> {
	await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`${schema}:class-capacity-cutoff`,
	]);
	if (input.executionClaim) {
		await advisoryLockExecutionTx(tx, input.organizationId, input.intentId);
	}
	const intents = (await tx.unsafe(
		`SELECT id, intent_type, festival_class_id, child_id, cart_reference, status
		FROM ${schema}.checkout_intents
		WHERE id = $1 AND organization_id = $2
		FOR UPDATE`,
		[input.intentId, input.organizationId],
	)) as Array<{
		id: string;
		intent_type: string;
		festival_class_id: string | null;
		child_id: string | null;
		cart_reference: string | null;
		status: string;
	}>;
	if (!intents[0]) {
		throw new Error("Checkout intent cannot accept a cart.");
	}
	if (input.executionClaim) {
		await verifyExecutionClaimForAttachTx(tx, schema, input.executionClaim);
		const existing = await loadExistingAttachedCartTx(
			tx,
			schema,
			intents[0].cart_reference,
			input.shopifyCartId,
		);
		if (existing) return existing;
	}
	if (intents[0].status !== "creating") {
		throw new Error("Checkout intent cannot accept a cart.");
	}
	const capacityError = input.capacityCheck
		? await input.capacityCheck()
		: intents[0].intent_type === "class_entry"
			? await verifyClassEntryCapacityTx(
					tx,
					schema,
					input.organizationId,
					input.intentId,
					intents[0],
				)
			: null;
	if (capacityError) throw capacityError;
	return insertAndLinkCartTx(tx, schema, input);
}
