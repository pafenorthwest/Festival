import { createHash } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import type {
	ClassCheckoutClaim,
	ClassCheckoutExecution,
} from "./class-checkout-execution.js";
import type { StartClassCheckoutInput } from "./class-checkout-service.js";

export interface ClassCheckoutRecoveryStatus {
	status: "recovery_required" | "processing" | "ready" | "resolved";
	recoveryReference: string;
	reasonCode: string;
	retryAllowed: boolean;
	recordedAtIso?: string;
	checkoutUrl?: string;
	correlationId?: string;
}

export class ClassCheckoutRecoveryRequiredError extends AppError {
	readonly recovery: ClassCheckoutRecoveryStatus;
	constructor(record: ClassCheckoutExecution, matchesSubmission = true) {
		super(
			"This checkout needs recovery before it can continue.",
			409,
			record.state === "recovery_required"
				? "checkout_recovery_required"
				: "checkout_previous_operation_pending",
		);
		this.recovery = {
			...recoveryStatusFor(record),
			...(matchesSubmission ? {} : { retryAllowed: false }),
		};
	}
}

export class ClassCheckoutPersistenceUnavailableError extends AppError {
	constructor() {
		super(
			"Checkout recovery could not be saved. Please check its status before trying again.",
			503,
			"checkout_persistence_unavailable",
		);
	}
}

export function recoveryStatusFor(
	record: ClassCheckoutExecution,
): ClassCheckoutRecoveryStatus {
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

/** Deliberate allowlist: credentials and request idempotency keys never enter snapshots. */
export function classCheckoutRequestSnapshot(input: StartClassCheckoutInput) {
	const lines = input.lineItems ?? [
		{
			childId: input.childId,
			festivalClassId: input.festivalClassId,
			teacherId: input.teacherId,
			accompanistId: input.accompanistId,
			instrumentId: input.instrumentId,
			pieces: input.pieces ?? [],
		},
	];
	return {
		version: 1,
		festivalId: input.festivalId?.trim() || null,
		festivalShortName: input.festivalShortName?.trim() || null,
		divisionId: input.divisionId?.trim() || null,
		lines: lines.map((line) => ({
			childId: line.childId?.trim() || "",
			festivalClassId: line.festivalClassId?.trim() || "",
			teacherId: line.teacherId?.trim() || "",
			accompanistId: line.accompanistId?.trim() || null,
			instrumentId: line.instrumentId?.trim() || null,
			pieces: (line.pieces ?? []).map((piece) => ({
				title: piece.title?.trim() || "",
				composer: piece.composer?.trim() || "",
				movement: piece.movement?.trim() || null,
				durationSeconds: piece.durationSeconds ?? null,
				durationMinutes:
					"durationMinutes" in piece ? (piece.durationMinutes ?? null) : null,
				catalogWorkId: piece.catalogWorkId?.trim() || null,
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

export interface ManagedClassCheckoutExecution {
	record: ClassCheckoutExecution;
	claim: ClassCheckoutClaim;
}
