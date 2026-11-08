/** Customer-safe checkout state. Provider identifiers and request keys stay server-side. */
export interface ClassCheckoutRecoveryStatusDto {
	status: "recovery_required" | "processing" | "ready" | "resolved";
	recoveryReference: string;
	reasonCode: string;
	retryAllowed: boolean;
	checkoutUrl?: string;
	correlationId?: string;
	recordedAtIso?: string;
}
