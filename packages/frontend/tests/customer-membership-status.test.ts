import { describe, expect, it } from "bun:test";
import {
	CUSTOMER_MEMBERSHIP_STATUSES,
	type CustomerMembershipStatusEntry,
} from "@festival/common";
import {
	customerMembershipViewModel,
	decideMembershipPolling,
	formatMembershipMoney,
	isBlockingMembershipStatus,
	MEMBERSHIP_POLL_INTERVAL_MS,
	MEMBERSHIP_POLL_MAX_DURATION_MS,
	membershipStatusSignature,
	resolveMembershipAcquisitionState,
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
		const scheduled = customerMembershipViewModel(membership("scheduled"));
		const superseded = customerMembershipViewModel(membership("superseded"));
		const revoked = customerMembershipViewModel(membership("revoked"));

		expect(processing).toMatchObject({
			label: "Processing",
			tone: "processing",
		});
		expect(processing.description).toContain("does not grant active");
		expect(rejected).toMatchObject({ label: "Rejected", tone: "rejected" });
		expect(rejected.description).toContain("No active membership rights");
		expect(review).toMatchObject({ label: "Needs review", tone: "review" });
		expect(review.description).toContain("No active membership rights");
		expect(scheduled).toMatchObject({ label: "Scheduled", tone: "processing" });
		expect(scheduled.description).toContain("No active membership rights");
		expect(superseded).toMatchObject({
			label: "Superseded",
			tone: "expired",
		});
		expect(superseded.description).toContain("No active membership rights");
		expect(revoked).toMatchObject({ label: "Revoked", tone: "rejected" });
		expect(revoked.description).toContain("No active membership rights");
		expect(
			JSON.stringify([
				processing,
				rejected,
				review,
				scheduled,
				superseded,
				revoked,
			]),
		).not.toContain("reasonCode");
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

		const supersededWithDate = customerMembershipViewModel({
			...snapshot,
			status: "superseded",
			supersededOn: "2027-01-15",
		});
		expect(supersededWithDate.details).toEqual([
			{ label: "Entitlement class", value: "teacher_membership" },
			{ label: "Division", value: "Piano" },
			{ label: "Paid price", value: "$75.00" },
			{ label: "Duration", value: "365 days" },
			{ label: "Start date", value: "2026-08-14" },
			{ label: "Superseded on", value: "2027-01-15" },
		]);
		expect(supersededWithDate.details).not.toContainEqual({
			label: "End date (exclusive)",
			value: "2027-08-14",
		});
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

function classMembership(
	entitlementClass: CustomerMembershipStatusEntry["entitlementClass"],
	status: CustomerMembershipStatusEntry["status"],
): CustomerMembershipStatusEntry {
	return {
		entitlementClass,
		displayName:
			entitlementClass === "teacher_membership"
				? "Teacher Membership"
				: "Accompanist Membership",
		status,
	};
}

describe("membership acquisition state evaluation", () => {
	const blockingStatuses = [
		"active",
		"scheduled",
		"processing",
		"needs_review",
	] as const;
	const nonBlockingStatuses = [
		"expired",
		"revoked",
		"superseded",
		"rejected",
	] as const;

	it("classifies all 8 CUSTOMER_MEMBERSHIP_STATUSES into blocking and non-blocking", () => {
		expect(CUSTOMER_MEMBERSHIP_STATUSES).toHaveLength(8);
		expect(new Set([...blockingStatuses, ...nonBlockingStatuses])).toEqual(
			new Set(CUSTOMER_MEMBERSHIP_STATUSES),
		);
		for (const status of blockingStatuses) {
			expect(isBlockingMembershipStatus(status)).toBe(true);
		}
		for (const status of nonBlockingStatuses) {
			expect(isBlockingMembershipStatus(status)).toBe(false);
		}
	});

	it("evaluates all 4 ownership combinations independently", () => {
		const baseInput = { loading: false, error: "" };
		expect(
			resolveMembershipAcquisitionState({ ...baseInput, memberships: [] }),
		).toEqual({
			teacherDisabled: false,
			accompanistDisabled: false,
		});
		expect(
			resolveMembershipAcquisitionState({
				...baseInput,
				memberships: [classMembership("teacher_membership", "active")],
			}),
		).toEqual({
			teacherDisabled: true,
			accompanistDisabled: false,
		});
		expect(
			resolveMembershipAcquisitionState({
				...baseInput,
				memberships: [classMembership("accompanist_membership", "active")],
			}),
		).toEqual({
			teacherDisabled: false,
			accompanistDisabled: true,
		});
		expect(
			resolveMembershipAcquisitionState({
				...baseInput,
				memberships: [
					classMembership("teacher_membership", "active"),
					classMembership("accompanist_membership", "active"),
				],
			}),
		).toEqual({
			teacherDisabled: true,
			accompanistDisabled: true,
		});
	});

	it("isolates teacher and accompanist classes across every status and mixed history", () => {
		const baseInput = { loading: false, error: "" };
		for (const status of blockingStatuses) {
			expect(
				resolveMembershipAcquisitionState({
					...baseInput,
					memberships: [classMembership("teacher_membership", status)],
				}),
			).toEqual({ teacherDisabled: true, accompanistDisabled: false });
			expect(
				resolveMembershipAcquisitionState({
					...baseInput,
					memberships: [classMembership("accompanist_membership", status)],
				}),
			).toEqual({ teacherDisabled: false, accompanistDisabled: true });
		}
		for (const status of nonBlockingStatuses) {
			expect(
				resolveMembershipAcquisitionState({
					...baseInput,
					memberships: [
						classMembership("teacher_membership", status),
						classMembership("accompanist_membership", status),
					],
				}),
			).toEqual({ teacherDisabled: false, accompanistDisabled: false });
		}
		expect(
			resolveMembershipAcquisitionState({
				...baseInput,
				memberships: [
					classMembership("teacher_membership", "expired"),
					classMembership("teacher_membership", "active"),
					classMembership("accompanist_membership", "revoked"),
				],
			}),
		).toEqual({ teacherDisabled: true, accompanistDisabled: false });
		expect(
			resolveMembershipAcquisitionState({
				...baseInput,
				memberships: [
					classMembership("teacher_membership", "superseded"),
					classMembership("accompanist_membership", "expired"),
					classMembership("accompanist_membership", "scheduled"),
				],
			}),
		).toEqual({ teacherDisabled: false, accompanistDisabled: true });
	});

	it("fails closed on loading or error and scopes checkoutProcessing to teacher", () => {
		expect(
			resolveMembershipAcquisitionState({
				memberships: [],
				loading: true,
				error: "",
			}),
		).toEqual({ teacherDisabled: true, accompanistDisabled: true });
		expect(
			resolveMembershipAcquisitionState({
				memberships: [],
				loading: false,
				error: "Festival membership status could not be loaded.",
			}),
		).toEqual({ teacherDisabled: true, accompanistDisabled: true });
		expect(
			resolveMembershipAcquisitionState({
				memberships: [],
				loading: false,
				error: "",
				checkoutProcessing: true,
			}),
		).toEqual({ teacherDisabled: true, accompanistDisabled: false });
		expect(
			resolveMembershipAcquisitionState({
				memberships: [classMembership("accompanist_membership", "active")],
				loading: false,
				error: "",
				checkoutProcessing: true,
			}),
		).toEqual({ teacherDisabled: true, accompanistDisabled: true });
	});
});
