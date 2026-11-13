import type {
	ClassCheckoutExecutionRepository,
	ClassCheckoutExecutionState,
} from "./checkout-execution-types.js";
import { buildIntentLineRecords } from "./checkout-line-helpers.js";
import type {
	CheckoutCartRecord,
	CheckoutCartStatus,
	CheckoutIntentLineItemRecord,
	CheckoutIntentOutcome,
	CheckoutIntentRecord,
	CheckoutIntentStatus,
	CheckoutIntentType,
	ClassCheckoutReplayState,
} from "./checkout-types.js";

export interface CheckoutIntentRow {
	id: string;
	correlation_id: string;
	organization_id: string;
	customer_id: string;
	session_id: string;
	idempotency_key: string;
	intent_type: string;
	offering_id: string | null;
	entitlement_class: string | null;
	duration_days: number | null;
	festival_class_id: string | null;
	child_id: string | null;
	shopify_product_gid: string;
	shopify_variant_gid: string;
	policy_version: string | null;
	division_id: string | null;
	division_name_snapshot: string | null;
	staff_access_consent: boolean;
	amount: string;
	currency_code: string;
	line_identity_protocol: string | null;
	cart_reference: string | null;
	status: string;
	expires_at: string | Date;
	created_at: string | Date;
}

export interface CheckoutIntentLineRow {
	id: string;
	checkout_intent_id: string;
	line_index: number;
	line_type: string;
	festival_class_id: string | null;
	child_id: string | null;
	offering_id: string | null;
	shopify_product_gid: string;
	shopify_variant_gid: string;
	amount: string;
	currency_code: string;
	division_id: string | null;
	division_name_snapshot: string | null;
	created_at: string | Date;
}

export interface CheckoutCartRow {
	reference: string;
	shopify_cart_id: string;
	organization_id: string;
	customer_id: string;
	session_id: string;
	integration_version: number | string;
	status: string;
	expires_at: string | Date;
	created_at: string | Date;
}

export function validateCheckoutSchemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
		throw new Error("Database schema is invalid.");
	}
	return value;
}

export function toIsoString(value: string | Date): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

export function mapCheckoutCartRow(row: CheckoutCartRow): CheckoutCartRecord {
	return {
		reference: row.reference,
		shopifyCartId: row.shopify_cart_id,
		organizationId: row.organization_id,
		customerId: row.customer_id,
		sessionId: row.session_id,
		integrationVersion: Number(row.integration_version),
		status: row.status as CheckoutCartStatus,
		expiresAtIso: toIsoString(row.expires_at),
		createdAtIso: toIsoString(row.created_at),
	};
}

export function mapCheckoutIntentLineRow(
	row: CheckoutIntentLineRow,
): CheckoutIntentLineItemRecord {
	return {
		id: row.id,
		checkoutIntentId: row.checkout_intent_id,
		lineIndex: Number(row.line_index),
		lineType: row.line_type,
		festivalClassId: row.festival_class_id,
		childId: row.child_id,
		offeringId: row.offering_id,
		shopifyProductGid: row.shopify_product_gid,
		shopifyVariantGid: row.shopify_variant_gid,
		amount: row.amount,
		currencyCode: row.currency_code,
		divisionId: row.division_id,
		divisionNameSnapshot: row.division_name_snapshot,
		createdAtIso: toIsoString(row.created_at),
	};
}

export function mapCheckoutIntentRow(
	row: CheckoutIntentRow,
	lines?: CheckoutIntentLineItemRecord[],
): CheckoutIntentRecord {
	return {
		id: row.id,
		correlationId: row.correlation_id,
		organizationId: row.organization_id,
		customerId: row.customer_id,
		sessionId: row.session_id,
		idempotencyKey: row.idempotency_key,
		intentType: row.intent_type as CheckoutIntentType,
		offeringId: row.offering_id,
		entitlementClass:
			row.entitlement_class === "teacher_membership"
				? "teacher_membership"
				: null,
		durationDays: row.duration_days,
		festivalClassId: row.festival_class_id,
		childId: row.child_id,
		shopifyProductGid: row.shopify_product_gid,
		shopifyVariantGid: row.shopify_variant_gid,
		policyVersion: row.policy_version === "v1" ? "v1" : null,
		divisionId: row.division_id,
		divisionNameSnapshot: row.division_name_snapshot,
		staffAccessConsent: Boolean(row.staff_access_consent),
		amount: row.amount,
		currencyCode: row.currency_code,
		lineIdentityProtocol: row.line_identity_protocol,
		cartReference: row.cart_reference,
		status: row.status as CheckoutIntentStatus,
		expiresAtIso: toIsoString(row.expires_at),
		createdAtIso: toIsoString(row.created_at),
		...(lines ? { lines } : {}),
	};
}

export function ensureIntentLines(
	intent: CheckoutIntentRecord,
): CheckoutIntentRecord {
	if (intent.lines && intent.lines.length > 0) {
		return intent;
	}
	return {
		...intent,
		lines: buildIntentLineRecords(intent),
	};
}

export async function resolveExistingOutcome(
	intent: CheckoutIntentRecord,
	cart: CheckoutCartRecord | null,
	nowIso: string,
	classExecutions?: ClassCheckoutExecutionRepository,
): Promise<Exclude<CheckoutIntentOutcome, { kind: "created" }>> {
	if (intent.status === "creating") {
		if (intent.intentType === "class_entry" && classExecutions) {
			const exec = await classExecutions.get(intent.organizationId, intent.id);
			if (exec && (exec.state === "ready" || exec.state === "retryable")) {
				return { kind: "in_progress" };
			}
		}
		return Date.parse(intent.expiresAtIso) <= Date.parse(nowIso)
			? { kind: "expired" }
			: { kind: "in_progress" };
	}
	if (intent.status === "ready") {
		if (
			cart &&
			cart.status === "ready" &&
			Date.parse(cart.expiresAtIso) > Date.parse(nowIso)
		) {
			return { kind: "ready", intent, cart };
		}
		return { kind: "expired" };
	}
	if (
		intent.status === "checkout_started" ||
		intent.status === "approved" ||
		intent.status === "needs_review"
	) {
		return { kind: "active" };
	}
	if (intent.status === "expired" || intent.status === "superseded") {
		return { kind: "expired" };
	}
	return { kind: "failed" };
}

export function buildReplayStateRow(row: {
	intent_status: string;
	execution_state: string | null;
	generation: number | string | null;
	result_code: string | null;
}): ClassCheckoutReplayState | null {
	if (!row.execution_state) {
		return null;
	}
	return {
		state: row.execution_state as ClassCheckoutExecutionState,
		generation: Number(row.generation ?? 0),
		resultCode: row.result_code,
		intentStatus: row.intent_status as CheckoutIntentStatus,
	};
}
