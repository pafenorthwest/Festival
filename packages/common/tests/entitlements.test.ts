import { describe, expect, it } from "bun:test";
import {
	addCalendarDays,
	assertValidEntitlementDurationDays,
	assertValidEntitlementGrantSnapshotInput,
	calendarDateInTimezone,
	deriveEntitlementDates,
	INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
	MAX_ENTITLEMENT_DURATION_DAYS,
} from "../src/entitlements.js";

describe("Teacher Membership entitlement contracts", () => {
	it("accepts bounded positive integer durations", () => {
		expect(
			assertValidEntitlementDurationDays(
				INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
			),
		).toBe(365);
		expect(
			assertValidEntitlementDurationDays(MAX_ENTITLEMENT_DURATION_DAYS),
		).toBe(MAX_ENTITLEMENT_DURATION_DAYS);
		for (const invalid of [0, -1, 1.5, MAX_ENTITLEMENT_DURATION_DAYS + 1]) {
			expect(() => assertValidEntitlementDurationDays(invalid)).toThrow(
				"positive integer",
			);
		}
	});

	it("derives local paid dates and exclusive calendar-day end dates", () => {
		expect(
			deriveEntitlementDates({
				fullyPaidAtIso: "2026-08-15T06:30:00.000Z",
				organizationTimezone: "America/Los_Angeles",
				durationDays: 365,
			}),
		).toEqual({ startsOn: "2026-08-14", endsOn: "2027-08-14" });
		expect(addCalendarDays("2026-08-14", 365)).toBe("2027-08-14");
	});

	it("stays deterministic across daylight-saving boundaries", () => {
		expect(
			deriveEntitlementDates({
				fullyPaidAtIso: "2026-03-08T07:30:00.000Z",
				organizationTimezone: "America/Los_Angeles",
				durationDays: 1,
			}),
		).toEqual({ startsOn: "2026-03-07", endsOn: "2026-03-08" });
		expect(
			calendarDateInTimezone("2026-11-01T08:30:00.000Z", "America/Los_Angeles"),
		).toBe("2026-11-01");
	});

	it("rejects invalid dates, timestamps, and timezones explicitly", () => {
		expect(() => addCalendarDays("2026-02-30", 1)).toThrow("invalid");
		expect(() => calendarDateInTimezone("not-an-instant", "UTC")).toThrow(
			"fully-paid timestamp",
		);
		expect(() =>
			calendarDateInTimezone("2026-08-15T06:30:00", "America/Los_Angeles"),
		).toThrow("explicit numeric UTC offset");
		expect(calendarDateInTimezone("2026-08-14T23:30:00-07:00", "UTC")).toBe(
			"2026-08-15",
		);
		expect(() => calendarDateInTimezone("2026-01-01T00:00:00Z", "")).toThrow(
			"valid IANA timezone",
		);
		expect(() =>
			calendarDateInTimezone("2026-01-01T00:00:00Z", "Pacific/Nowhere"),
		).toThrow("valid IANA timezone");
	});

	it("rejects malformed immutable grant contracts", () => {
		const valid = {
			organizationId: "org-1",
			customerId: "customer-1",
			entitlementClass: "teacher_membership" as const,
			offeringId: "offering-1",
			durationDays: 365,
			divisionId: "division-1",
			divisionNameSnapshot: "High Strings",
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-1",
			shopifyOrderGid: "gid://shopify/Order/1",
			shopifyOrderLineGid: "gid://shopify/LineItem/1",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			status: "active" as const,
		};
		expect(() => assertValidEntitlementGrantSnapshotInput(valid)).not.toThrow();
		expect(() =>
			assertValidEntitlementGrantSnapshotInput({
				...valid,
				paidCurrencyCode: "usd",
			}),
		).toThrow("three-letter code");
		expect(() =>
			assertValidEntitlementGrantSnapshotInput({
				...valid,
				endsOn: "2026-08-15",
			}),
		).toThrow("startsOn plus durationDays");
	});
});
