import type { ClassCheckoutRestartRegistration } from "./class-checkout-recovery.js";

export type PendingClassCheckoutState =
	| "ready"
	| "payment_pending"
	| "partially_paid"
	| "processing"
	| "needs_review";

/** Customer-safe view of an outstanding purchase, verified against Shopify. */
export interface PendingClassCheckoutDto {
	state: PendingClassCheckoutState;
	recoveryReference: string;
	festivalShortName: string | null;
	/** Null when Shopify could not verify the current registration count. */
	registrationCount: number | null;
	/** Saved Festival details; these do not establish current payment state. */
	registrations: ClassCheckoutRestartRegistration[];
	resumeAllowed: boolean;
	reasonCode: string;
	verifiedAtIso: string | null;
	estimatedTotal?: {
		amount: string;
		currencyCode: string;
	};
	payment?: {
		receivedAmount: string;
		outstandingAmount: string;
		currencyCode: string;
	};
}

export interface PendingClassCheckoutResponse {
	checkout: PendingClassCheckoutDto | null;
}

export interface ResumePendingClassCheckoutResponse {
	checkoutUrl: string;
	/** Confirms an optional client submission key belongs to this resumed attempt. */
	submissionMatched?: boolean;
}
