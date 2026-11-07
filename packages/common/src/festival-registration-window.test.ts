import { describe, expect, it } from "bun:test";
import {
	isFestivalRegistrationOpen,
	parseRegistrationWindowBoundary,
	validateFestivalRegistrationWindow,
} from "./festival-registration-window.js";

describe("festival-registration-window", () => {
	describe("unset and missing windows (fail-closed)", () => {
		it("returns false for null, undefined, or empty bounds at evaluation time", () => {
			const now = new Date("2026-04-10T12:00:00.000Z");

			expect(isFestivalRegistrationOpen({}, now)).toBeFalse();
			expect(
				isFestivalRegistrationOpen(
					{ registrationOpensAt: null, registrationClosesAt: null },
					now,
				),
			).toBeFalse();
			expect(
				isFestivalRegistrationOpen(
					{ registrationOpensAt: "", registrationClosesAt: "   " },
					now,
				),
			).toBeFalse();
			expect(
				isFestivalRegistrationOpen(
					{
						registrationOpensAt: "2026-04-01T00:00:00.000Z",
						registrationClosesAt: null,
					},
					now,
				),
			).toBeFalse();
			expect(
				isFestivalRegistrationOpen(
					{
						registrationOpensAt: null,
						registrationClosesAt: "2026-04-30T23:59:59.999Z",
					},
					now,
				),
			).toBeFalse();
		});

		it("treats unset window as valid to save on a festival with null ISO bounds", () => {
			expect(validateFestivalRegistrationWindow({})).toEqual({
				isValid: true,
				errors: [],
				opensAtIso: null,
				closesAtIso: null,
			});

			expect(
				validateFestivalRegistrationWindow({
					registrationOpensAt: null,
					registrationClosesAt: null,
				}),
			).toEqual({
				isValid: true,
				errors: [],
				opensAtIso: null,
				closesAtIso: null,
			});

			expect(
				validateFestivalRegistrationWindow({
					registrationOpensAt: "  ",
					registrationClosesAt: "",
				}),
			).toEqual({
				isValid: true,
				errors: [],
				opensAtIso: null,
				closesAtIso: null,
			});
		});
	});

	describe("inclusive opening and exclusive closing boundaries", () => {
		const window = {
			registrationOpensAt: "2026-04-01T09:00:00.000Z",
			registrationClosesAt: "2026-04-15T17:00:00.000Z",
		};

		it("returns true when now equals opensAt exactly", () => {
			expect(
				isFestivalRegistrationOpen(
					window,
					new Date("2026-04-01T09:00:00.000Z"),
				),
			).toBeTrue();
		});

		it("returns false when now equals closesAt exactly", () => {
			expect(
				isFestivalRegistrationOpen(
					window,
					new Date("2026-04-15T17:00:00.000Z"),
				),
			).toBeFalse();
		});

		it("returns true 1ms before closesAt", () => {
			expect(
				isFestivalRegistrationOpen(
					window,
					new Date("2026-04-15T16:59:59.999Z"),
				),
			).toBeTrue();
		});

		it("returns false 1ms before opensAt", () => {
			expect(
				isFestivalRegistrationOpen(
					window,
					new Date("2026-04-01T08:59:59.999Z"),
				),
			).toBeFalse();
		});

		it("returns false 1ms after closesAt", () => {
			expect(
				isFestivalRegistrationOpen(
					window,
					new Date("2026-04-15T17:00:00.001Z"),
				),
			).toBeFalse();
		});
	});

	describe("IANA timezone interpretation", () => {
		it("interprets local datetime strings in America/Los_Angeles and America/New_York", () => {
			const laValidation = validateFestivalRegistrationWindow(
				{
					registrationOpensAt: "2026-04-01T09:00",
					registrationClosesAt: "2026-04-15T17:30:45",
				},
				"America/Los_Angeles",
			);
			expect(laValidation).toEqual({
				isValid: true,
				errors: [],
				opensAtIso: "2026-04-01T16:00:00.000Z",
				closesAtIso: "2026-04-16T00:30:45.000Z",
			});

			const nyValidation = validateFestivalRegistrationWindow(
				{
					registrationOpensAt: "2026-01-10T09:00",
					registrationClosesAt: "2026-01-20T17:00:00",
				},
				"America/New_York",
			);
			expect(nyValidation).toEqual({
				isValid: true,
				errors: [],
				opensAtIso: "2026-01-10T14:00:00.000Z",
				closesAtIso: "2026-01-20T22:00:00.000Z",
			});
		});

		it("interprets YYYY-MM-DD dates as start of day for open and end of day for close in organization timezone", () => {
			const laWindow = {
				registrationOpensAt: "2026-04-01",
				registrationClosesAt: "2026-04-02",
			};
			const laValidation = validateFestivalRegistrationWindow(
				laWindow,
				"America/Los_Angeles",
			);
			expect(laValidation).toEqual({
				isValid: true,
				errors: [],
				opensAtIso: "2026-04-01T07:00:00.000Z",
				closesAtIso: "2026-04-03T06:59:59.999Z",
			});

			expect(
				isFestivalRegistrationOpen(
					laWindow,
					new Date("2026-04-01T07:00:00.000Z"),
					"America/Los_Angeles",
				),
			).toBeTrue();
			expect(
				isFestivalRegistrationOpen(
					laWindow,
					new Date("2026-04-01T06:59:59.999Z"),
					"America/Los_Angeles",
				),
			).toBeFalse();
			expect(
				isFestivalRegistrationOpen(
					laWindow,
					new Date("2026-04-03T06:59:59.998Z"),
					"America/Los_Angeles",
				),
			).toBeTrue();
			expect(
				isFestivalRegistrationOpen(
					laWindow,
					new Date("2026-04-03T06:59:59.999Z"),
					"America/Los_Angeles",
				),
			).toBeFalse();
			expect(
				isFestivalRegistrationOpen(
					laWindow,
					new Date("2026-04-03T07:00:00.000Z"),
					"America/Los_Angeles",
				),
			).toBeFalse();
		});

		it("accepts explicit ISO offsets regardless of organization timezone", () => {
			const validation = validateFestivalRegistrationWindow(
				{
					registrationOpensAt: "2026-04-01T09:00:00-07:00",
					registrationClosesAt: "2026-04-15T17:00:00.000Z",
				},
				"America/New_York",
			);
			expect(validation).toEqual({
				isValid: true,
				errors: [],
				opensAtIso: "2026-04-01T16:00:00.000Z",
				closesAtIso: "2026-04-15T17:00:00.000Z",
			});
		});

		it.each([
			"America/Los_Angeles",
			"America/New_York",
		])("rejects nonexistent local times in %s", (timezone) => {
			expect(
				parseRegistrationWindowBoundary(
					"2026-03-08T02:30:15.125",
					"open",
					timezone,
				),
			).toBeNull();
			const window = {
				registrationOpensAt: "2026-03-08T02:30",
				registrationClosesAt: "2026-03-08T04:00",
			};
			expect(validateFestivalRegistrationWindow(window, timezone)).toEqual({
				isValid: false,
				errors: ["Registration open timestamp is invalid."],
				opensAtIso: null,
				closesAtIso: null,
			});
			expect(
				isFestivalRegistrationOpen(
					window,
					new Date("2026-03-08T09:45:00.000Z"),
					timezone,
				),
			).toBeFalse();
		});

		it("preserves valid local times and fractional precision around the DST gap", () => {
			expect(
				validateFestivalRegistrationWindow(
					{
						registrationOpensAt: "2026-03-08T01:59:59.999",
						registrationClosesAt: "2026-03-08T03:00:00.001",
					},
					"America/Los_Angeles",
				),
			).toEqual({
				isValid: true,
				errors: [],
				opensAtIso: "2026-03-08T09:59:59.999Z",
				closesAtIso: "2026-03-08T10:00:00.001Z",
			});
		});

		it("accepts explicit offsets even when the wall time falls in the organization DST gap", () => {
			expect(
				validateFestivalRegistrationWindow(
					{
						registrationOpensAt: "2026-03-08T02:30:00.125-08:00",
						registrationClosesAt: "2026-03-08T04:00:00-07:00",
					},
					"America/Los_Angeles",
				),
			).toEqual({
				isValid: true,
				errors: [],
				opensAtIso: "2026-03-08T10:30:00.125Z",
				closesAtIso: "2026-03-08T11:00:00.000Z",
			});
		});
	});

	describe("validation of partial, reversed, and malformed windows", () => {
		it("rejects partial windows when only one bound is provided", () => {
			const onlyOpen = validateFestivalRegistrationWindow({
				registrationOpensAt: "2026-04-01T09:00:00.000Z",
				registrationClosesAt: null,
			});
			expect(onlyOpen.isValid).toBeFalse();
			expect(onlyOpen.errors).toEqual([
				"Both registration open and close timestamps must be provided together.",
			]);

			const onlyClose = validateFestivalRegistrationWindow({
				registrationOpensAt: null,
				registrationClosesAt: "2026-04-15T17:00:00.000Z",
			});
			expect(onlyClose.isValid).toBeFalse();
			expect(onlyClose.errors).toEqual([
				"Both registration open and close timestamps must be provided together.",
			]);
		});

		it("rejects reversed windows where opensAt > closesAt", () => {
			const reversed = validateFestivalRegistrationWindow({
				registrationOpensAt: "2026-04-16T00:00:00.000Z",
				registrationClosesAt: "2026-04-15T23:59:59.999Z",
			});
			expect(reversed.isValid).toBeFalse();
			expect(reversed.errors).toContain(
				"Registration close timestamp must be on or after the open timestamp.",
			);
			expect(
				isFestivalRegistrationOpen(
					{
						registrationOpensAt: "2026-04-16T00:00:00.000Z",
						registrationClosesAt: "2026-04-15T23:59:59.999Z",
					},
					new Date("2026-04-16T00:00:00.000Z"),
				),
			).toBeFalse();
		});

		it("rejects malformed timestamps and invalid timezones", () => {
			const malformed = validateFestivalRegistrationWindow({
				registrationOpensAt: "2026-02-30T09:00:00Z",
				registrationClosesAt: "not-a-timestamp",
			});
			expect(malformed.isValid).toBeFalse();
			expect(malformed.errors).toEqual([
				"Registration open timestamp is invalid.",
				"Registration close timestamp is invalid.",
			]);

			const badTimezone = validateFestivalRegistrationWindow(
				{
					registrationOpensAt: "2026-04-01",
					registrationClosesAt: "2026-04-02",
				},
				"Invalid/Timezone",
			);
			expect(badTimezone.isValid).toBeFalse();
			expect(badTimezone.errors).toEqual([
				"Organization timezone must be a valid IANA timezone.",
			]);

			expect(
				parseRegistrationWindowBoundary("2026-04-01T25:00", "open", "UTC"),
			).toBeNull();
			expect(
				isFestivalRegistrationOpen(
					{
						registrationOpensAt: "not-a-date",
						registrationClosesAt: "2026-04-15T17:00:00.000Z",
					},
					new Date("2026-04-10T12:00:00.000Z"),
				),
			).toBeFalse();
		});
	});
});
