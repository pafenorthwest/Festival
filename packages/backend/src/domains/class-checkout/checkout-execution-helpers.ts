import { createHash } from "node:crypto";
import { AppError } from "@festival/common";
import type {
	ClassCheckoutCheckpoint,
	ClassCheckoutClaim,
	ClassCheckoutEvidence,
	ClassCheckoutExecution,
	ClassCheckoutExecutionEvent,
	ClassCheckoutExecutionState,
	ClassCheckoutStorefrontBinding,
	ResolveClassCheckoutExecution,
} from "./checkout-execution-types.js";

export function assertSafeExecutionSnapshot(value: unknown): void {
	if (Array.isArray(value)) {
		for (const item of value) assertSafeExecutionSnapshot(item);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, item] of Object.entries(value)) {
		if (/token|authorization|idempotency|secret|password/i.test(key)) {
			throw new Error(
				"Checkout execution snapshots cannot contain credentials or idempotency keys.",
			);
		}
		assertSafeExecutionSnapshot(item);
	}
}

export function executionClaimMatches(
	value: ClassCheckoutExecution,
	claim: ClassCheckoutClaim,
	nowIso: string,
): boolean {
	return (
		value.organizationId === claim.organizationId &&
		value.intentId === claim.intentId &&
		value.state === "running" &&
		value.generation === claim.generation &&
		value.leaseOwner === claim.owner &&
		Boolean(value.leaseExpiresAtIso && value.leaseExpiresAtIso > nowIso)
	);
}

export function assertExecutionFingerprint(
	value: ClassCheckoutExecution,
	fingerprint: string,
): void {
	if (value.fingerprint !== fingerprint) {
		throw new AppError(
			"Checkout identity belongs to different registration contents.",
			409,
			"checkout_payload_conflict",
		);
	}
}

export function isBlockingExecution(value: ClassCheckoutExecution): boolean {
	return (
		value.state === "recovery_required" ||
		value.state === "running" ||
		(["create_dispatched", "remote_cart_known"].includes(value.checkpoint) &&
			value.state !== "completed" &&
			value.state !== "rejected")
	);
}

export function copyStorefrontBinding({
	shopDomain,
	integrationVersion,
}: ClassCheckoutStorefrontBinding): ClassCheckoutStorefrontBinding {
	return { shopDomain, integrationVersion };
}

export function isLegacyInvalidCartObservation(
	event: ClassCheckoutExecutionEvent,
): boolean {
	return (
		event.eventType === "invalid_remote_cart_observed" &&
		!event.evidence.shopifyCartId &&
		!event.evidence.code
	);
}

function hasUnissuedInvalidCartEvidence(
	value: ClassCheckoutExecution,
	events: readonly ClassCheckoutExecutionEvent[],
): boolean {
	return (
		value.checkpoint === "remote_cart_known" &&
		Boolean(value.shopifyCartId) &&
		events.some(isLegacyInvalidCartObservation) &&
		!events.some(
			(event) =>
				["cart_attached", "checkout_ready", "paid_order_observed"].includes(
					event.eventType,
				) ||
				Boolean(event.evidence.shopifyOrderGid) ||
				event.evidence.resolution === "resume_known_cart",
		)
	);
}

export function unissuedInvalidCartRestartDecision(
	value: ClassCheckoutExecution,
	intentStatus: string,
	events: readonly ClassCheckoutExecutionEvent[],
): { replacementKey: string } | "restartable" | null {
	if (!hasUnissuedInvalidCartEvidence(value, events)) return null;
	if (
		intentStatus === "superseded" &&
		value.state === "rejected" &&
		value.resultCode === "checkout_restarted_unissued"
	) {
		const restart = events.find(
			(event) => event.eventType === "customer_restarted_unissued",
		);
		return restart ? { replacementKey: restart.id } : null;
	}
	return intentStatus === "creating" &&
		["running", "retryable", "recovery_required"].includes(value.state)
		? "restartable"
		: null;
}

export function resolvedExecution(
	value: ClassCheckoutExecution,
	input: ResolveClassCheckoutExecution,
): ClassCheckoutExecution | null {
	if (
		value.state !== "recovery_required" ||
		value.generation !== input.expectedGeneration
	) {
		return null;
	}
	if (
		input.action === "resume_known_cart" &&
		!(input.shopifyCartId || value.shopifyCartId)
	) {
		throw new AppError(
			"A verified Shopify cart is required.",
			409,
			"checkout_recovery_evidence_required",
		);
	}
	if (
		input.action === "retry_pre_dispatch" &&
		value.checkpoint !== "prepared"
	) {
		throw new AppError(
			"An uncertain Shopify creation cannot be retried.",
			409,
			"checkout_recovery_evidence_required",
		);
	}
	if (
		input.action === "resume_known_cart" &&
		value.checkpoint === "attached" &&
		input.shopifyCartId &&
		input.shopifyCartId !== value.shopifyCartId
	) {
		throw new AppError(
			"An admitted checkout cannot adopt another Shopify cart.",
			409,
			"checkout_recovery_evidence_required",
		);
	}
	const nowIso = new Date().toISOString();
	const cartId =
		input.action === "resume_known_cart"
			? (input.shopifyCartId ?? value.shopifyCartId)
			: value.shopifyCartId;
	const checkpoint: ClassCheckoutCheckpoint =
		input.action === "resume_known_cart" && value.checkpoint !== "attached"
			? "remote_cart_known"
			: value.checkpoint;
	const state: ClassCheckoutExecutionState =
		input.action === "abandon" ? "rejected" : "retryable";
	const binding = input.storefrontBinding
		? copyStorefrontBinding(input.storefrontBinding)
		: value.storefrontBinding;
	return {
		...value,
		state,
		checkpoint,
		generation: value.generation + 1,
		leaseOwner: null,
		leaseExpiresAtIso: null,
		shopifyCartId: cartId ?? null,
		storefrontBinding: binding,
		resultCode:
			input.action === "abandon"
				? value.checkpoint === "create_dispatched"
					? "abandoned_unknown"
					: "checkout_abandoned"
				: null,
		updatedAtIso: nowIso,
	};
}

export function lateEvidenceId(input: {
	organizationId: string;
	intentId: string;
	generation: number;
	eventType: string;
	evidence?: ClassCheckoutEvidence;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				input.organizationId,
				input.intentId,
				input.generation,
				input.eventType,
				Object.entries(input.evidence ?? {}).sort(([a], [b]) =>
					a.localeCompare(b),
				),
			]),
		)
		.digest("hex");
}

export function computeRecoveryReference(
	organizationId: string,
	intentId: string,
): string {
	const digest = createHash("sha256")
		.update(`${organizationId}:${intentId}`)
		.digest("hex")
		.slice(0, 12)
		.toUpperCase();
	return `CCR-${digest}`;
}

export function validateExecutionSchemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
		throw new Error("Database schema is invalid.");
	}
	return value;
}

export function executionIso(value: unknown): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(String(value)).toISOString();
}

export function parseStorefrontBinding(
	value: unknown,
): ClassCheckoutStorefrontBinding | null {
	const parsed = typeof value === "string" ? JSON.parse(value) : value;
	if (!parsed || typeof parsed !== "object") return null;
	const row = parsed as Record<string, unknown>;
	if (
		typeof row.shopDomain === "string" &&
		typeof row.integrationVersion === "number"
	) {
		return {
			shopDomain: row.shopDomain,
			integrationVersion: row.integrationVersion,
		};
	}
	return null;
}

export function parseExecutionEvidence(value: unknown): ClassCheckoutEvidence {
	const parsed = typeof value === "string" ? JSON.parse(value) : value;
	if (!parsed || typeof parsed !== "object") return {};
	return parsed as ClassCheckoutEvidence;
}

export function rowToExecution(
	row: Record<string, unknown>,
): ClassCheckoutExecution {
	return {
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		intentId: String(row.intent_id),
		fingerprint: String(row.fingerprint),
		requestSnapshot:
			typeof row.request_snapshot === "string"
				? JSON.parse(row.request_snapshot)
				: row.request_snapshot,
		storefrontBinding: parseStorefrontBinding(row.storefront_binding),
		state: row.state as ClassCheckoutExecutionState,
		checkpoint: row.checkpoint as ClassCheckoutCheckpoint,
		generation: Number(row.generation),
		leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
		leaseExpiresAtIso: row.lease_expires_at
			? executionIso(row.lease_expires_at)
			: null,
		shopifyCartId: row.shopify_cart_id ? String(row.shopify_cart_id) : null,
		resultCode: row.result_code ? String(row.result_code) : null,
		recoveryReference: String(row.recovery_reference),
		recoveryRecordedAtIso: row.recovery_recorded_at
			? executionIso(row.recovery_recorded_at)
			: null,
		createdAtIso: executionIso(row.created_at),
		updatedAtIso: executionIso(row.updated_at),
	};
}

export function rowToExecutionEvent(
	row: Record<string, unknown>,
): ClassCheckoutExecutionEvent {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		intentId: String(row.intent_id),
		generation: Number(row.generation),
		eventType: String(row.event_type),
		evidence: parseExecutionEvidence(row.evidence),
		createdAtIso: executionIso(row.created_at),
	};
}
