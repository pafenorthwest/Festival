import type { EntitlementClass } from "./entitlements.js";

export const CUSTOMER_MEMBERSHIP_STATUSES = [
	"processing",
	"rejected",
	"needs_review",
	"active",
	"expired",
] as const;

export type CustomerMembershipStatus =
	(typeof CUSTOMER_MEMBERSHIP_STATUSES)[number];

/**
 * Allowlisted customer-owned handoff contract for the #94 Account UI.
 * It intentionally contains no internal IDs, Shopify payloads, or contact data.
 */
export interface CustomerMembershipStatusEntry {
	status: CustomerMembershipStatus;
	entitlementClass: EntitlementClass;
	displayName: string;
	divisionName?: string;
	paidAmount?: string;
	paidCurrencyCode?: string;
	durationDays?: number;
	startsOn?: string;
	endsOn?: string;
	reasonCode?: "validation_rejected" | "validation_needs_review";
}

export interface CustomerMembershipStatusResponse {
	memberships: CustomerMembershipStatusEntry[];
}
