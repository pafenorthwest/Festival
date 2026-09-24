import { describe, expect, it } from "bun:test";
import {
	deriveDisplayName,
	deriveFestivalMetadataCutoff,
	divisionNameUniquenessKey,
	getStartOfDayInTimezone,
	isValidIanaTimezone,
	normalizeDivisionName,
	ORGANIZATION_ROLES,
	subtractCalendarDays,
	validateFestivalDates,
	validateFestivalName,
	validateOrganizationName,
	validateOrganizationShortName,
} from "../src/organization.js";

describe("organization helpers", () => {
	it("validates allowed organization names", () => {
		const result = validateOrganizationName("Performing Arts Festival");

		expect(result.valid).toBeTrue();
		expect(result.normalized).toBe("Performing Arts Festival");
	});

	it("rejects invalid organization name punctuation", () => {
		const result = validateOrganizationName("Festival Admins!");

		expect(result.valid).toBeFalse();
		expect(result.errors).toContain(
			"Organization name may only contain letters, numbers, spaces, and hyphens.",
		);
	});

	it("validates and normalizes organization short names", () => {
		const result = validateOrganizationShortName("PAFE");

		expect(result.valid).toBeTrue();
		expect(result.normalized).toBe("pafe");
	});

	it("rejects long or invalid organization short names", () => {
		const result = validateOrganizationShortName("FestivalFestival!");

		expect(result.valid).toBeFalse();
		expect(result.errors).toContain(
			"Organization short name must be 16 characters or less.",
		);
		expect(result.errors).toContain(
			"Organization short name may only contain letters, numbers, and hyphens.",
		);
	});

	it("exports the locked invite role list", () => {
		expect(ORGANIZATION_ROLES).toEqual([
			"Admin",
			"Division Chair",
			"Music Reviewer",
			"Concert Chair",
			"Read Only",
		]);
	});

	it("normalizes division names and validates IANA timezones", () => {
		expect(normalizeDivisionName("  High   Strings ")).toBe("High Strings");
		expect(divisionNameUniquenessKey("HIGH STRINGS")).toBe("high strings");
		expect(isValidIanaTimezone("America/Los_Angeles")).toBeTrue();
		expect(isValidIanaTimezone("Pacific/Nowhere")).toBeFalse();
	});

	it("prefers explicit invite acceptance names", () => {
		expect(
			deriveDisplayName({
				name: "Ada Lovelace",
				displayName: "Existing User",
				email: "ada@example.com",
			}),
		).toBe("Ada Lovelace");
	});

	it("validates festival names and date ranges", () => {
		expect(validateFestivalName("Spring Festival (West)").valid).toBeTrue();

		const invalidName = validateFestivalName("Spring Festival!");
		expect(invalidName.valid).toBeFalse();
		expect(invalidName.errors).toContain(
			"Festival name may only contain letters, numbers, spaces, and parentheses.",
		);

		const invalidDates = validateFestivalDates({
			startDate: "2027-06-10",
			endDate: "2027-06-09",
			today: "2027-06-01",
		});
		expect(invalidDates.valid).toBeFalse();
		expect(invalidDates.errors).toContain(
			"Festival end date must be the same as or after start date.",
		);

		const pastDates = validateFestivalDates({
			startDate: "2027-05-31",
			endDate: "2027-06-01",
			today: "2027-06-01",
		});
		expect(pastDates.valid).toBeFalse();
		expect(pastDates.errors).toContain(
			"Festival start date cannot be in the past.",
		);
	});

	describe("subtractCalendarDays", () => {
		it("subtracts days correctly across normal calendar dates", () => {
			expect(subtractCalendarDays("2026-05-15", 0)).toBe("2026-05-15");
			expect(subtractCalendarDays("2026-05-15", 1)).toBe("2026-05-14");
			expect(subtractCalendarDays("2026-05-15", 15)).toBe("2026-04-30");
			expect(subtractCalendarDays("2026-05-15", 42)).toBe("2026-04-03");
			expect(subtractCalendarDays("2026-01-05", 10)).toBe("2025-12-26");
			expect(subtractCalendarDays("2026-01-01", 365)).toBe("2025-01-01");
		});

		it("handles leap year boundaries accurately", () => {
			expect(subtractCalendarDays("2024-03-01", 1)).toBe("2024-02-29");
			expect(subtractCalendarDays("2024-03-15", 42)).toBe("2024-02-02");
			expect(subtractCalendarDays("2023-03-01", 1)).toBe("2023-02-28");
			expect(subtractCalendarDays("2023-03-15", 42)).toBe("2023-02-01");
			expect(subtractCalendarDays("2000-03-01", 1)).toBe("2000-02-29");
			expect(subtractCalendarDays("1900-03-01", 1)).toBe("1900-02-28");
		});

		it("rejects invalid date format, invalid calendar date, and invalid days", () => {
			expect(() => subtractCalendarDays("not-a-date", 1)).toThrow(
				"Calendar date must use YYYY-MM-DD.",
			);
			expect(() => subtractCalendarDays("2026/05/15", 1)).toThrow(
				"Calendar date must use YYYY-MM-DD.",
			);
			expect(() => subtractCalendarDays("2026-5-15", 1)).toThrow(
				"Calendar date must use YYYY-MM-DD.",
			);
			expect(() => subtractCalendarDays("2026-02-30", 1)).toThrow(
				"Calendar date is invalid.",
			);
			expect(() => subtractCalendarDays("2026-02-29", 1)).toThrow(
				"Calendar date is invalid.",
			);
			expect(() => subtractCalendarDays("2026-13-01", 1)).toThrow(
				"Calendar date is invalid.",
			);
			expect(() => subtractCalendarDays("2026-05-15", -1)).toThrow(
				"Days must be a non-negative integer.",
			);
			expect(() => subtractCalendarDays("2026-05-15", 1.5)).toThrow(
				"Days must be a non-negative integer.",
			);
			expect(() => subtractCalendarDays("2026-05-15", Number.NaN)).toThrow(
				"Days must be a non-negative integer.",
			);
		});
	});

	describe("getStartOfDayInTimezone", () => {
		it("returns exact midnight instant for UTC, America/Los_Angeles, and Asia/Tokyo", () => {
			const utcDate = getStartOfDayInTimezone("2026-05-15", "UTC");
			expect(utcDate.toISOString()).toBe("2026-05-15T00:00:00.000Z");
			assertTimezoneMidnight(utcDate, "2026-05-15", "UTC");

			const tokyoDate = getStartOfDayInTimezone("2026-05-15", "Asia/Tokyo");
			expect(tokyoDate.toISOString()).toBe("2026-05-14T15:00:00.000Z");
			assertTimezoneMidnight(tokyoDate, "2026-05-15", "Asia/Tokyo");

			const losAngelesSummer = getStartOfDayInTimezone(
				"2026-05-15",
				"America/Los_Angeles",
			);
			expect(losAngelesSummer.toISOString()).toBe("2026-05-15T07:00:00.000Z");
			assertTimezoneMidnight(
				losAngelesSummer,
				"2026-05-15",
				"America/Los_Angeles",
			);

			const losAngelesWinter = getStartOfDayInTimezone(
				"2026-01-15",
				"America/Los_Angeles",
			);
			expect(losAngelesWinter.toISOString()).toBe("2026-01-15T08:00:00.000Z");
			assertTimezoneMidnight(
				losAngelesWinter,
				"2026-01-15",
				"America/Los_Angeles",
			);
		});

		it("handles Daylight Saving boundaries accurately", () => {
			const springForwardDay = getStartOfDayInTimezone(
				"2026-03-08",
				"America/Los_Angeles",
			);
			expect(springForwardDay.toISOString()).toBe("2026-03-08T08:00:00.000Z");
			assertTimezoneMidnight(
				springForwardDay,
				"2026-03-08",
				"America/Los_Angeles",
			);

			const afterSpringDay = getStartOfDayInTimezone(
				"2026-03-09",
				"America/Los_Angeles",
			);
			expect(afterSpringDay.toISOString()).toBe("2026-03-09T07:00:00.000Z");
			assertTimezoneMidnight(
				afterSpringDay,
				"2026-03-09",
				"America/Los_Angeles",
			);

			const fallBackDay = getStartOfDayInTimezone(
				"2026-11-01",
				"America/Los_Angeles",
			);
			expect(fallBackDay.toISOString()).toBe("2026-11-01T07:00:00.000Z");
			assertTimezoneMidnight(fallBackDay, "2026-11-01", "America/Los_Angeles");

			const afterFallBackDay = getStartOfDayInTimezone(
				"2026-11-02",
				"America/Los_Angeles",
			);
			expect(afterFallBackDay.toISOString()).toBe("2026-11-02T08:00:00.000Z");
			assertTimezoneMidnight(
				afterFallBackDay,
				"2026-11-02",
				"America/Los_Angeles",
			);
		});

		it("rejects invalid date format, invalid calendar date, and invalid timezone", () => {
			expect(() => getStartOfDayInTimezone("bad-date", "UTC")).toThrow(
				"Calendar date must use YYYY-MM-DD.",
			);
			expect(() => getStartOfDayInTimezone("2026-02-30", "UTC")).toThrow(
				"Calendar date is invalid.",
			);
			expect(() =>
				getStartOfDayInTimezone("2026-05-15", "Invalid/Timezone"),
			).toThrow("Timezone must be a valid IANA timezone.");
			expect(() => getStartOfDayInTimezone("2026-05-15", "")).toThrow(
				"Timezone must be a valid IANA timezone.",
			);
		});
	});

	describe("deriveFestivalMetadataCutoff", () => {
		it("derives exact 42-day cutoff instant at 00:00:00 across timezones and dates", () => {
			const losAngelesCutoff = deriveFestivalMetadataCutoff(
				"2026-05-15",
				"America/Los_Angeles",
			);
			expect(losAngelesCutoff.toISOString()).toBe("2026-04-03T07:00:00.000Z");
			assertTimezoneMidnight(
				losAngelesCutoff,
				"2026-04-03",
				"America/Los_Angeles",
			);

			const tokyoCutoff = deriveFestivalMetadataCutoff(
				"2026-05-15",
				"Asia/Tokyo",
			);
			expect(tokyoCutoff.toISOString()).toBe("2026-04-02T15:00:00.000Z");
			assertTimezoneMidnight(tokyoCutoff, "2026-04-03", "Asia/Tokyo");

			const utcCutoff = deriveFestivalMetadataCutoff("2026-05-15", "UTC");
			expect(utcCutoff.toISOString()).toBe("2026-04-03T00:00:00.000Z");
			assertTimezoneMidnight(utcCutoff, "2026-04-03", "UTC");

			const leapCutoff = deriveFestivalMetadataCutoff(
				"2024-03-15",
				"America/Los_Angeles",
			);
			expect(leapCutoff.toISOString()).toBe("2024-02-02T08:00:00.000Z");
			assertTimezoneMidnight(leapCutoff, "2024-02-02", "America/Los_Angeles");

			const dstCutoff = deriveFestivalMetadataCutoff(
				"2026-04-19",
				"America/Los_Angeles",
			);
			expect(dstCutoff.toISOString()).toBe("2026-03-08T08:00:00.000Z");
			assertTimezoneMidnight(dstCutoff, "2026-03-08", "America/Los_Angeles");
		});

		it("rejects invalid inputs on deriveFestivalMetadataCutoff", () => {
			expect(() =>
				deriveFestivalMetadataCutoff("bad-date", "America/Los_Angeles"),
			).toThrow("Calendar date must use YYYY-MM-DD.");
			expect(() =>
				deriveFestivalMetadataCutoff("2026-02-30", "America/Los_Angeles"),
			).toThrow("Calendar date is invalid.");
			expect(() =>
				deriveFestivalMetadataCutoff("2026-05-15", "Mars/Colony"),
			).toThrow("Timezone must be a valid IANA timezone.");
		});
	});
});

function assertTimezoneMidnight(
	instant: Date,
	expectedDate: string,
	timezone: string,
): void {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const parts = dtf.formatToParts(instant);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value;
	expect(`${part("year")}-${part("month")}-${part("day")}`).toBe(expectedDate);
	expect(part("hour")).toBe("00");
	expect(part("minute")).toBe("00");
	expect(part("second")).toBe("00");
}
