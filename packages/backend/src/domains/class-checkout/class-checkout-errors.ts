import { createHash } from "node:crypto";
import {
	AppError,
	type ClassCheckoutLineItemInput,
	type RepertoirePiece,
} from "@festival/common";
import type { ClassCheckoutExecution } from "./checkout-execution-types.js";
import type { CheckoutIntentStatus } from "./checkout-types.js";

export interface StartClassCheckoutInput {
	organizationId: string;
	festivalId?: string;
	festivalShortName?: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
	festivalClassId?: string;
	childId?: string;
	divisionId?: string;
	buyerAccessToken: string;
	integrationVersion?: string | number;
	teacherId?: string;
	accompanistId?: string | null;
	instrumentId?: string;
	pieces?: RepertoirePiece[];
	lineItems?: ClassCheckoutLineItemInput[];
}

export interface ClassCheckoutRecoveryStatus {
	status: "recovery_required" | "processing" | "ready" | "resolved";
	recoveryReference: string;
	festivalShortName?: string;
	reasonCode: string;
	retryAllowed: boolean;
	restartAllowed?: boolean;
	recordedAtIso?: string;
	checkoutUrl?: string;
	correlationId?: string;
}

export class ClassCheckoutRecoveryRequiredError extends AppError {
	readonly recovery: ClassCheckoutRecoveryStatus;

	constructor(
		record: ClassCheckoutExecution,
		matchesSubmission = true,
		legacyInvalidCart?: { restartAllowed: boolean },
	) {
		super(
			"This checkout needs recovery before it can continue.",
			409,
			record.state === "recovery_required" || legacyInvalidCart
				? "checkout_recovery_required"
				: "checkout_previous_operation_pending",
		);
		this.name = "ClassCheckoutRecoveryRequiredError";
		this.recovery = {
			...recoveryStatusFor(record),
			...(matchesSubmission ? {} : { retryAllowed: false }),
			...(legacyInvalidCart
				? {
						status: "recovery_required",
						reasonCode: "checkout_legacy_invalid_cart",
						retryAllowed: false,
						restartAllowed: legacyInvalidCart.restartAllowed,
					}
				: {}),
		};
	}
}

export class ClassCheckoutPersistenceUnavailableError extends AppError {
	constructor(message = "Checkout state persistence is unavailable.") {
		super(message, 503, "checkout_persistence_unavailable");
		this.name = "ClassCheckoutPersistenceUnavailableError";
	}
}

export class ClassCheckoutReplayResolvedError extends AppError {
	readonly recovery: ClassCheckoutRecoveryStatus;

	constructor(recovery: ClassCheckoutRecoveryStatus) {
		super("This checkout has already been resolved.", 409, recovery.reasonCode);
		this.name = "ClassCheckoutReplayResolvedError";
		this.recovery = recovery;
	}
}

export function resolvedCheckoutStatus(
	intentStatus: CheckoutIntentStatus,
	record: ClassCheckoutExecution,
): ClassCheckoutRecoveryStatus | undefined {
	const status = recoveryStatusFor(record);
	if (intentStatus === "needs_review" && record.state === "recovery_required") {
		return { ...status, retryAllowed: false };
	}
	if (
		record.checkpoint === "prepared" &&
		record.state === "rejected" &&
		["rejected", "superseded", "failed"].includes(intentStatus)
	) {
		return {
			...status,
			status: "resolved",
			retryAllowed: false,
			reasonCode: "checkout_pre_dispatch_rejected",
		};
	}
	if (
		!["approved", "rejected", "needs_review", "superseded"].includes(
			intentStatus,
		)
	) {
		return undefined;
	}
	return {
		...status,
		status: "resolved",
		retryAllowed: false,
		reasonCode:
			intentStatus === "approved"
				? "checkout_already_completed"
				: intentStatus === "rejected"
					? "checkout_already_rejected"
					: intentStatus === "superseded"
						? record.resultCode === "abandoned_unknown"
							? "abandoned_unknown"
							: "checkout_already_abandoned"
						: "checkout_needs_review",
	};
}

export class ClassCheckoutCartObservationError extends AppError {
	constructor(readonly observedShopifyCartId: string) {
		super("Shopify checkout is temporarily unavailable.", 503);
		this.name = "ClassCheckoutCartObservationError";
	}
}

export class ClassCheckoutStorefrontChangedBeforeRequestError extends AppError {
	constructor() {
		super(
			"Shopify Storefront configuration changed before the request.",
			503,
			"checkout_storefront_binding_changed",
		);
		this.name = "ClassCheckoutStorefrontChangedBeforeRequestError";
	}
}

export function recoveryStatusFor(
	record: ClassCheckoutExecution,
): ClassCheckoutRecoveryStatus {
	const snapshot = record.requestSnapshot as {
		festivalShortName?: unknown;
	} | null;
	const festivalShortName = snapshot?.festivalShortName;
	return {
		status:
			record.state === "recovery_required"
				? "recovery_required"
				: record.state === "running"
					? "processing"
					: record.state === "rejected"
						? "resolved"
						: "ready",
		recoveryReference: record.recoveryReference,
		...(typeof festivalShortName === "string" && festivalShortName
			? { festivalShortName }
			: {}),
		reasonCode:
			record.resultCode ??
			(record.state === "running"
				? "checkout_in_progress"
				: "checkout_retry_available"),
		retryAllowed:
			record.state === "retryable" ||
			record.state === "ready" ||
			record.state === "completed",
		...(record.recoveryRecordedAtIso
			? { recordedAtIso: record.recoveryRecordedAtIso }
			: {}),
	};
}

export function normalizeClassCheckoutLineInputs(
	input: StartClassCheckoutInput,
): ClassCheckoutLineItemInput[] {
	if (input.lineItems !== undefined) {
		return input.lineItems;
	}
	if (!input.festivalClassId || !input.childId || !input.teacherId) {
		return [];
	}
	return [
		{
			festivalClassId: input.festivalClassId,
			childId: input.childId,
			teacherId: input.teacherId,
			accompanistId: input.accompanistId ?? null,
			instrumentId: input.instrumentId,
			pieces: input.pieces ?? [],
		},
	];
}

export function classCheckoutRequestSnapshot(input: StartClassCheckoutInput) {
	return {
		organizationId: input.organizationId,
		festivalId: input.festivalId ?? null,
		festivalShortName: input.festivalShortName ?? null,
		customerId: input.customerId,
		sessionId: input.sessionId,
		divisionId: input.divisionId ?? null,
		lineItems: normalizeClassCheckoutLineInputs(input).map((item) => ({
			festivalClassId: item.festivalClassId,
			childId: item.childId,
			teacherId: item.teacherId,
			accompanistId: item.accompanistId ?? null,
			instrumentId: item.instrumentId ?? null,
			pieces: (item.pieces ?? []).map((piece) => ({
				catalogWorkId:
					typeof piece?.catalogWorkId === "string" && piece.catalogWorkId.trim()
						? piece.catalogWorkId.trim()
						: null,
				title: typeof piece?.title === "string" ? piece.title.trim() : "",
				composer:
					typeof piece?.composer === "string" ? piece.composer.trim() : "",
				movement:
					typeof piece?.movement === "string" && piece.movement.trim()
						? piece.movement.trim()
						: null,
				durationSeconds: piece?.durationSeconds,
			})),
		})),
	};
}

export function classCheckoutRequestFingerprint(
	input: StartClassCheckoutInput,
): string {
	return createHash("sha256")
		.update(JSON.stringify(classCheckoutRequestSnapshot(input)))
		.digest("hex");
}

export type ClassCheckoutFailureStage =
	| "session"
	| "validation"
	| "eligibility"
	| "intent"
	| "create_cart"
	| "attach_cart"
	| "checkout"
	| "recovery"
	| "persistence";

export interface ClassCheckoutFailureLogger {
	error(message: string, context: Record<string, unknown>): void;
}

export const silentClassCheckoutFailureLogger: ClassCheckoutFailureLogger = {
	error() {},
};

export const consoleClassCheckoutFailureLogger: ClassCheckoutFailureLogger = {
	error(message, context) {
		console.error(message, context ?? {});
	},
};

export interface ManagedClassCheckoutExecution {
	claimOwner: string;
	execution: ClassCheckoutExecution;
}
