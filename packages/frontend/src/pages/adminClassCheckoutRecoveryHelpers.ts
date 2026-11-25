import type {
	AdminClassCheckoutRecoveryAction,
	AdminClassCheckoutRecoveryCheckpoint,
	AdminClassCheckoutRecoveryDto,
	AdminClassCheckoutRecoveryEventDto,
	AdminResolveClassCheckoutRecoveryInput,
} from "@festival/common";
import { ApiError } from "../lib/api/client.js";

export const RECOVERY_REASON_MAX_LENGTH = 500;

type RecoveryStatus = AdminClassCheckoutRecoveryDto["status"];

const STATUS_LABELS: Record<RecoveryStatus, string> = {
	recovery_required: "Needs recovery",
	processing: "Processing",
	ready: "Ready",
	resolved: "Resolved",
};

const CHECKPOINT_LABELS: Record<AdminClassCheckoutRecoveryCheckpoint, string> =
	{
		prepared: "Prepared, nothing sent to Shopify",
		create_dispatched: "Cart request sent to Shopify, result unknown",
		remote_cart_known: "Shopify cart known, not yet attached",
		attached: "Cart attached to the checkout",
	};

const REASON_LABELS: Record<string, string> = {
	checkout_creation_unknown: "Shopify cart creation result unknown",
	checkout_expired: "Checkout expired",
	checkout_pre_dispatch_rejected: "Rejected before reaching Shopify",
	checkout_abandoned: "Abandoned by an operator",
	abandoned_unknown: "Abandoned after an unknown result",
	checkout_in_progress: "Checkout in progress",
};

const ERROR_MESSAGES: Record<string, string> = {
	checkout_recovery_conflict:
		"This checkout changed while you were reviewing it. Refresh the list and check its new state before trying again.",
	checkout_recovery_acknowledgement_required:
		"Confirm that you understand the customer may already have paid or still hold a Shopify cart.",
	checkout_recovery_evidence_invalid:
		"Shopify cart evidence could not be verified for this checkout. Check the cart and try again.",
};

export function formatRecoveryStatus(status: RecoveryStatus): string {
	return STATUS_LABELS[status];
}

export function recoveryStatusBadgeClass(status: RecoveryStatus): string {
	switch (status) {
		case "recovery_required":
			return "badge badge-warning";
		case "processing":
			return "badge badge-processing";
		case "ready":
			return "badge badge-active";
		default:
			return "badge badge-neutral";
	}
}

export function formatRecoveryCheckpoint(
	checkpoint: AdminClassCheckoutRecoveryCheckpoint,
): string {
	return CHECKPOINT_LABELS[checkpoint] ?? checkpoint;
}

/** Known codes get a plain label; any other code is made readable instead of hidden. */
export function formatRecoveryReason(reasonCode: string): string {
	const known = REASON_LABELS[reasonCode];
	if (known) return known;
	const words = reasonCode.replace(/_/g, " ").trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

export function formatRecoveryTime(iso: string | undefined): string {
	if (!iso) return "Unknown";
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

export function shortRecoveryReference(reference: string): string {
	return reference.length > 12 ? `${reference.slice(0, 8)}…` : reference;
}

export function canResolveRecovery(
	recovery: Pick<AdminClassCheckoutRecoveryDto, "status">,
): boolean {
	return recovery.status === "recovery_required";
}

export interface ResolveActionOption {
	action: AdminClassCheckoutRecoveryAction;
	label: string;
	description: string;
}

/** Only actions that are safe for how far the checkout got are offered. */
export function availableResolveActions(
	recovery: Pick<AdminClassCheckoutRecoveryDto, "checkpoint">,
): ResolveActionOption[] {
	const options: ResolveActionOption[] = [];
	if (recovery.checkpoint === "prepared") {
		options.push({
			action: "retry_pre_dispatch",
			label: "Let the customer try again",
			description:
				"Nothing reached Shopify, so a new attempt cannot create a duplicate cart.",
		});
	}
	if (
		recovery.checkpoint === "create_dispatched" ||
		recovery.checkpoint === "remote_cart_known"
	) {
		options.push({
			action: "adopt_cart",
			label: "Use the existing Shopify cart",
			description:
				"Attach a cart that already exists in Shopify. It is checked against this checkout before it is used.",
		});
	}
	options.push({
		action: "abandon_unknown",
		label: "Abandon this checkout",
		description:
			"Close this attempt so the customer can start a new one. The customer may already have a cart or payment in Shopify.",
	});
	return options;
}

export function requiresAbandonAcknowledgement(
	recovery: Pick<AdminClassCheckoutRecoveryDto, "checkpoint">,
): boolean {
	return recovery.checkpoint !== "prepared";
}

export function cartEvidenceEvents(
	recovery: Pick<AdminClassCheckoutRecoveryDto, "events">,
): AdminClassCheckoutRecoveryEventDto[] {
	return recovery.events.filter((event) => event.hasCartEvidence);
}

export interface ResolveFormValues {
	action: AdminClassCheckoutRecoveryAction | "";
	reason: string;
	shopifyCartId: string;
	evidenceEventId: string;
	acknowledged: boolean;
}

export type ResolveInputResult =
	| { ok: true; input: AdminResolveClassCheckoutRecoveryInput }
	| { ok: false; error: string };

export function buildResolveInput(
	recovery: Pick<
		AdminClassCheckoutRecoveryDto,
		"generation" | "checkpoint" | "events"
	>,
	values: ResolveFormValues,
): ResolveInputResult {
	const allowed = availableResolveActions(recovery).map((o) => o.action);
	if (!values.action || !allowed.includes(values.action)) {
		return { ok: false, error: "Choose what to do with this checkout." };
	}
	const reason = values.reason.trim();
	if (!reason) {
		return {
			ok: false,
			error: "Enter a reason. It is kept in the audit trail.",
		};
	}
	if (reason.length > RECOVERY_REASON_MAX_LENGTH) {
		return {
			ok: false,
			error: `The reason must be ${RECOVERY_REASON_MAX_LENGTH} characters or fewer.`,
		};
	}
	const input: AdminResolveClassCheckoutRecoveryInput = {
		expectedGeneration: recovery.generation,
		reason,
		action: values.action,
	};
	if (values.action === "abandon_unknown") {
		if (requiresAbandonAcknowledgement(recovery)) {
			if (!values.acknowledged) {
				return {
					ok: false,
					error: ERROR_MESSAGES.checkout_recovery_acknowledgement_required,
				};
			}
			input.acknowledgeUnknown = true;
		}
		return { ok: true, input };
	}
	if (values.action === "adopt_cart") {
		const cartId = values.shopifyCartId.trim();
		const evidenceId = values.evidenceEventId.trim();
		if (!cartId && !evidenceId && recovery.checkpoint !== "remote_cart_known") {
			return {
				ok: false,
				error:
					"Enter the Shopify cart id or choose the event that recorded it.",
			};
		}
		if (cartId) input.shopifyCartId = cartId;
		else if (evidenceId) input.evidenceEventId = evidenceId;
	}
	return { ok: true, input };
}

export function recoveryErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		const mapped = error.code ? ERROR_MESSAGES[error.code] : undefined;
		if (mapped) return mapped;
		if (error.status === 403) {
			return "This action was blocked. Reload the page and try again.";
		}
		return error.message || "The checkout could not be updated.";
	}
	return error instanceof Error && error.message
		? error.message
		: "The checkout could not be updated.";
}
