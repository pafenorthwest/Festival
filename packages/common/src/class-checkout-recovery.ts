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
