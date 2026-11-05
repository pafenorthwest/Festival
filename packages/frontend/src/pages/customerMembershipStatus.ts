import type {
	CustomerMembershipStatusEntry,
	CustomerMembershipStatusResponse,
} from "@festival/common";

export const MEMBERSHIP_POLL_INTERVAL_MS = 5_000;
export const MEMBERSHIP_POLL_MAX_DURATION_MS = 60_000;

export type CustomerMembershipTone =
	| "processing"
	| "rejected"
	| "review"
	| "active"
	| "expired";

export interface CustomerMembershipDetail {
	label: string;
	value: string;
}

export interface CustomerMembershipViewModel {
	label: string;
	description: string;
	tone: CustomerMembershipTone;
	details: CustomerMembershipDetail[];
}

export function formatMembershipMoney(
	amount: string | undefined,
	currencyCode: string | undefined,
	locale?: string,
): string | undefined {
	if (!amount || !currencyCode) return undefined;
	const numericAmount = Number(amount);
	if (!Number.isFinite(numericAmount)) return `${amount} ${currencyCode}`;
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency: currencyCode,
		}).format(numericAmount);
	} catch {
		return `${amount} ${currencyCode}`;
	}
}

function grantDetails(
	membership: CustomerMembershipStatusEntry,
): CustomerMembershipDetail[] {
	const details: CustomerMembershipDetail[] = [
		{
			label: "Entitlement class",
			value: membership.entitlementClass,
		},
	];
	if (membership.divisionName) {
		details.push({ label: "Division", value: membership.divisionName });
	}
	const price = formatMembershipMoney(
		membership.paidAmount,
		membership.paidCurrencyCode,
	);
	if (price) details.push({ label: "Paid price", value: price });
	if (membership.durationDays !== undefined) {
		details.push({
			label: "Duration",
			value: `${membership.durationDays} days`,
		});
	}
	if (membership.startsOn) {
		details.push({ label: "Start date", value: membership.startsOn });
	}
	if (membership.endsOn && membership.status !== "superseded") {
		details.push({
			label: "End date (exclusive)",
			value: membership.endsOn,
		});
	}
	if (membership.supersededOn) {
		details.push({
			label: "Superseded on",
			value: membership.supersededOn,
		});
	}
	return details;
}

export function customerMembershipViewModel(
	membership: CustomerMembershipStatusEntry,
): CustomerMembershipViewModel {
	switch (membership.status) {
		case "processing":
			return {
				label: "Processing",
				description:
					"Festival is validating the Shopify payment. This does not grant active membership rights yet.",
				tone: "processing",
				details: grantDetails(membership),
			};
		case "rejected":
			return {
				label: "Rejected",
				description:
					"Festival could not approve this purchase. No active membership rights were granted.",
				tone: "rejected",
				details: grantDetails(membership),
			};
		case "needs_review":
			return {
				label: "Needs review",
				description:
					"Festival staff must review this purchase. No active membership rights are available yet.",
				tone: "review",
				details: grantDetails(membership),
			};
		case "scheduled":
			return {
				label: "Scheduled",
				description:
					"This membership is scheduled to begin on its start date. No active membership rights are available yet.",
				tone: "processing",
				details: grantDetails(membership),
			};
		case "active":
			return {
				label: "Active",
				description: "This Festival Teacher Membership is active.",
				tone: "active",
				details: grantDetails(membership),
			};
		case "superseded":
			return {
				label: "Superseded",
				description:
					"This membership has been superseded by a renewed membership. No active membership rights are available from this grant.",
				tone: "expired",
				details: grantDetails(membership),
			};
		case "expired":
			return {
				label: "Expired",
				description: "This Festival Teacher Membership has expired.",
				tone: "expired",
				details: grantDetails(membership),
			};
		case "revoked":
			return {
				label: "Revoked",
				description:
					"This membership has been revoked. No active membership rights are available.",
				tone: "rejected",
				details: grantDetails(membership),
			};
		default: {
			const unexpectedStatus: never = membership.status;
			throw new Error(`Unsupported membership status: ${unexpectedStatus}`);
		}
	}
}

export function membershipStatusSignature(
	memberships: CustomerMembershipStatusResponse["memberships"],
): string {
	return JSON.stringify(memberships);
}

export function hasProcessingMembership(
	memberships: CustomerMembershipStatusResponse["memberships"],
): boolean {
	return memberships.some((membership) => membership.status === "processing");
}

function hasTerminalMembership(
	memberships: CustomerMembershipStatusResponse["memberships"],
): boolean {
	return memberships.some((membership) => membership.status !== "processing");
}

export type MembershipPollingDecision =
	| "continue"
	| "terminal"
	| "timeout"
	| "idle";

export function decideMembershipPolling(input: {
	memberships: CustomerMembershipStatusResponse["memberships"];
	checkoutReturn: boolean;
	initialSignature: string;
	sawProcessing: boolean;
	elapsedMs: number;
}): MembershipPollingDecision {
	const processing = hasProcessingMembership(input.memberships);
	const terminal = hasTerminalMembership(input.memberships);
	const changedFromInitial =
		membershipStatusSignature(input.memberships) !== input.initialSignature;

	if (
		!processing &&
		terminal &&
		(input.sawProcessing || (input.checkoutReturn && changedFromInitial))
	) {
		return "terminal";
	}
	if (input.elapsedMs >= MEMBERSHIP_POLL_MAX_DURATION_MS) return "timeout";
	if (input.checkoutReturn || processing) return "continue";
	return "idle";
}
