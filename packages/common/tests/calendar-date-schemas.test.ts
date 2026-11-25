import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import {
	calendarDateSchema,
	parseSchemaValue,
	UpdateRegistrationAgeDateInputSchema,
} from "../src/index.js";

const IMPOSSIBLE_CALENDAR_DATES = [
	"2027-02-29",
	"2027-02-31",
	"2026-04-31",
	"2026-13-01",
	"2026-00-10",
] as const;

describe("calendar date schemas", () => {
	it("rejects impossible calendar dates and accepts leap-year dates in calendarDateSchema", () => {
		for (const invalidDate of IMPOSSIBLE_CALENDAR_DATES) {
			expect(v.safeParse(calendarDateSchema, invalidDate).success).toBe(false);
		}

		const leapDay = v.safeParse(calendarDateSchema, "2028-02-29");
		expect(leapDay.success).toBe(true);
		if (leapDay.success) {
			expect(leapDay.output).toBe("2028-02-29");
		}
	});

	it("rejects impossible calendar dates and accepts leap-year dates in UpdateRegistrationAgeDateInputSchema", () => {
		for (const invalidDate of IMPOSSIBLE_CALENDAR_DATES) {
			expect(
				v.safeParse(UpdateRegistrationAgeDateInputSchema, {
					registrationAgeDate: invalidDate,
				}).success,
			).toBe(false);
		}

		const malformedFormat = parseSchemaValue(
			UpdateRegistrationAgeDateInputSchema,
			{ registrationAgeDate: "2026/04/01" },
		);
		expect(malformedFormat.success).toBe(false);
		if (!malformedFormat.success) {
			expect(malformedFormat.message).toBe(
				"Registration age date must use YYYY-MM-DD.",
			);
		}

		const leapDay = v.safeParse(UpdateRegistrationAgeDateInputSchema, {
			registrationAgeDate: "2028-02-29",
		});
		expect(leapDay.success).toBe(true);
		if (leapDay.success) {
			expect(leapDay.output.registrationAgeDate).toBe("2028-02-29");
		}
	});
});
