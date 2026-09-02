import { describe, expect, it } from "bun:test";
import type { CustomerMembershipStatusEntry } from "@festival/common";
import {
	customerMembershipViewModel,
	decideMembershipPolling,
	formatMembershipMoney,
	MEMBERSHIP_POLL_INTERVAL_MS,
	MEMBERSHIP_POLL_MAX_DURATION_MS,
	membershipStatusSignature,
} from "../src/pages/customerMembershipStatus.js";

const base = {
	entitlementClass: "teacher_membership",
	displayName: "Teacher Membership",
} as const;

function membership(
	status: CustomerMembershipStatusEntry["status"],
): CustomerMembershipStatusEntry {
	return { ...base, status };
}

describe("customer membership status presentation", () => {
	it("defines the selected bounded polling cadence", () => {
		expect(MEMBERSHIP_POLL_INTERVAL_MS).toBe(5_000);
		expect(MEMBERSHIP_POLL_MAX_DURATION_MS).toBe(60_000);
	});

	it("presents every non-active state without granting rights or exposing reasons", () => {
		const processing = customerMembershipViewModel(membership("processing"));
		const rejected = customerMembershipViewModel(membership("rejected"));
		const review = customerMembershipViewModel(membership("needs_review"));

		expect(processing).toMatchObject({
			label: "Processing",
			tone: "processing",
		});
		expect(processing.description).toContain("does not grant active");
		expect(rejected).toMatchObject({ label: "Rejected", tone: "rejected" });
		expect(rejected.description).toContain("No active membership rights");
		expect(review).toMatchObject({ label: "Needs review", tone: "review" });
		expect(review.description).toContain("No active membership rights");
		expect(JSON.stringify([processing, rejected, review])).not.toContain(
			"reasonCode",
		);
	});

	it("presents complete active and expired grant snapshots", () => {
		const snapshot: CustomerMembershipStatusEntry = {
			...base,
			status: "active",
			divisionName: "Piano",
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			durationDays: 365,
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
		};
		const active = customerMembershipViewModel(snapshot);
		const expired = customerMembershipViewModel({
			...snapshot,
			status: "expired",
		});

		expect(active).toMatchObject({ label: "Active", tone: "active" });
		expect(expired).toMatchObject({ label: "Expired", tone: "expired" });
		expect(active.details).toEqual([
			{ label: "Entitlement class", value: "teacher_membership" },
			{ label: "Division", value: "Piano" },
			{ label: "Paid price", value: "$75.00" },
			{ label: "Duration", value: "365 days" },
			{ label: "Start date", value: "2026-08-14" },
			{ label: "End date (exclusive)", value: "2027-08-14" },
		]);
		expect(expired.details).toEqual(active.details);
	});

	it("formats currency with an exact fallback and never converts calendar dates", () => {
		expect(formatMembershipMoney("75.00", "USD", "en-US")).toBe("$75.00");
		expect(formatMembershipMoney("75.00", "NOT_A_CURRENCY", "en-US")).toBe(
			"75.00 NOT_A_CURRENCY",
		);
		const incomplete = customerMembershipViewModel({
			...base,
			status: "active",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
		});
		expect(incomplete.details).toContainEqual({
			label: "Start date",
			value: "2026-08-14",
		});
		expect(incomplete.details).toContainEqual({
			label: "End date (exclusive)",
			value: "2027-08-14",
		});
		expect(
			incomplete.details.some((detail) => detail.value.includes("undefined")),
		).toBe(false);
	});
});

describe("customer membership polling policy", () => {
	const emptySignature = membershipStatusSignature([]);

	it("continues for checkout return or processing and otherwise stays idle", () => {
		expect(
			decideMembershipPolling({
				memberships: [],
				checkoutReturn: true,
				initialSignature: emptySignature,
				sawProcessing: false,
				elapsedMs: 5_000,
			}),
		).toBe("continue");
		expect(
			decideMembershipPolling({
				memberships: [membership("processing")],
				checkoutReturn: false,
				initialSignature: emptySignature,
				sawProcessing: true,
				elapsedMs: 5_000,
			}),
		).toBe("continue");
		expect(
			decideMembershipPolling({
				memberships: [],
				checkoutReturn: false,
				initialSignature: emptySignature,
				sawProcessing: false,
				elapsedMs: 0,
			}),
		).toBe("idle");
	});

	it("stops when observed processing resolves or checkout state changes to terminal", () => {
		const active = membership("active");
		expect(
			decideMembershipPolling({
				memberships: [active],
				checkoutReturn: false,
				initialSignature: membershipStatusSignature([membership("processing")]),
				sawProcessing: true,
				elapsedMs: 10_000,
			}),
		).toBe("terminal");
		expect(
			decideMembershipPolling({
				memberships: [membership("needs_review")],
				checkoutReturn: true,
				initialSignature: emptySignature,
				sawProcessing: false,
				elapsedMs: 10_000,
			}),
		).toBe("terminal");
	});

	it("does not mistake unchanged prior history for the returning checkout", () => {
		const prior = [membership("expired")];
		expect(
			decideMembershipPolling({
				memberships: prior,
				checkoutReturn: true,
				initialSignature: membershipStatusSignature(prior),
				sawProcessing: false,
				elapsedMs: 5_000,
			}),
		).toBe("continue");
	});

	it("stops at the bounded duration", () => {
		expect(
			decideMembershipPolling({
				memberships: [],
				checkoutReturn: true,
				initialSignature: emptySignature,
				sawProcessing: false,
				elapsedMs: MEMBERSHIP_POLL_MAX_DURATION_MS,
			}),
		).toBe("timeout");
	});
});
