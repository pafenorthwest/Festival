import type { RepertoirePiece } from "./registration.js";

/** Customer-safe checkout state. Provider identifiers and request keys stay server-side. */
export interface ClassCheckoutRecoveryStatusDto {
	status: "recovery_required" | "processing" | "ready" | "resolved";
	recoveryReference: string;
	/** Festival that owns the recovery attempt, which may differ from the current cart. */
	festivalShortName?: string;
	reasonCode: string;
	retryAllowed: boolean;
	restartAllowed?: boolean;
	checkoutUrl?: string;
	correlationId?: string;
	recordedAtIso?: string;
}

export interface ClassCheckoutRestartRegistration {
	lineId: string;
	childId: string;
	childName: string;
	divisionId: string;
	divisionName: string;
	teacherId: string;
	teacherName: string;
	classId: string;
	className: string;
	classSubtypeId?: string | null;
	classSubtypeName?: string | null;
	minimumAge?: number;
	maximumAge?: number;
	priceCents: number;
	accompanistId?: string | null;
	accompanistName?: string | null;
	instrumentId?: string;
	instrumentName?: string;
	pieces: RepertoirePiece[];
}

export interface ClassCheckoutRestartDto {
	replacementKey: string;
	registrations: ClassCheckoutRestartRegistration[];
}

export type AdminClassCheckoutRecoveryAction =
	| "adopt_cart"
	| "retry_pre_dispatch"
	| "abandon_unknown";

export type AdminClassCheckoutRecoveryCheckpoint =
	| "prepared"
	| "create_dispatched"
	| "remote_cart_known"
	| "attached";

export interface AdminClassCheckoutRecoveryEventDto {
	id: string;
	generation: number;
	eventType: string;
	createdAtIso: string;
	/** True when the event carries a Shopify cart id. The id itself is never returned. */
	hasCartEvidence: boolean;
}

/** One class checkout attempt that an operator can inspect or resolve. */
export interface AdminClassCheckoutRecoveryDto
	extends ClassCheckoutRecoveryStatusDto {
	/** Version of the attempt. Sent back on resolve so a stale decision is rejected. */
	generation: number;
	intentId: string;
	checkpoint: AdminClassCheckoutRecoveryCheckpoint;
	updatedAtIso: string;
	events: AdminClassCheckoutRecoveryEventDto[];
}

export interface AdminClassCheckoutRecoveryListResponse {
	recoveries: AdminClassCheckoutRecoveryDto[];
}

export interface AdminClassCheckoutRecoverySweepResponse {
	recoveredCount: number;
}

export interface AdminResolveClassCheckoutRecoveryInput {
	expectedGeneration: number;
	reason: string;
	action: AdminClassCheckoutRecoveryAction;
	shopifyCartId?: string;
	evidenceEventId?: string;
	acknowledgeUnknown?: boolean;
}

export interface AdminResolveClassCheckoutRecoveryResponse {
	recovery: ClassCheckoutRecoveryStatusDto & {
		generation: number;
		intentId: string;
		customerId: string;
	};
}
