import { describe, expect, it } from "bun:test";
import {
	AVAILABILITY_HOURS,
	buildDefaultAvailabilityDays,
	DEFAULT_AVAILABLE_HOURS,
	enumerateFestivalDates,
	formatAvailabilityHourBlock,
	normalizeAvailableHours,
	validateSaveCustomerFestivalAvailabilityRequest,
} from "./availability.js";

describe("availability helpers", () => {
	it("defines default hours with 8:00 a.m.-5:00 p.m. available and 5:00-6:00 p.m. unavailable", () => {
		expect(AVAILABILITY_HOURS).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
		expect(DEFAULT_AVAILABLE_HOURS).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
		expect(DEFAULT_AVAILABLE_HOURS.includes(17)).toBe(false);

		const days = buildDefaultAvailabilityDays(["2026-05-01", "2026-05-02"]);
		expect(days).toEqual([
			{
				date: "2026-05-01",
				availableHours: [8, 9, 10, 11, 12, 13, 14, 15, 16],
			},
			{
				date: "2026-05-02",
				availableHours: [8, 9, 10, 11, 12, 13, 14, 15, 16],
			},
		]);
	});

	it("enumerates festival dates inclusively across month boundaries", () => {
		expect(enumerateFestivalDates("2026-04-29", "2026-05-02")).toEqual([
			"2026-04-29",
			"2026-04-30",
			"2026-05-01",
			"2026-05-02",
		]);
		expect(enumerateFestivalDates("2026-05-10", "2026-05-10")).toEqual([
			"2026-05-10",
		]);
		expect(enumerateFestivalDates("2026-05-12", "2026-05-10")).toEqual([]);
	});

	it("formats availability hour blocks", () => {
		expect(formatAvailabilityHourBlock(8)).toBe("8:00 a.m. - 9:00 a.m.");
		expect(formatAvailabilityHourBlock(11)).toBe("11:00 a.m. - 12:00 p.m.");
		expect(formatAvailabilityHourBlock(12)).toBe("12:00 p.m. - 1:00 p.m.");
		expect(formatAvailabilityHourBlock(16)).toBe("4:00 p.m. - 5:00 p.m.");
		expect(formatAvailabilityHourBlock(17)).toBe("5:00 p.m. - 6:00 p.m.");
	});

	it("normalizes available hours by sorting, deduplicating, and validating bounds", () => {
		expect(normalizeAvailableHours([14, 8, 10, 8, 17, 12])).toEqual([
			8, 10, 12, 14, 17,
		]);
		expect(normalizeAvailableHours([])).toEqual([]);
		expect(() => normalizeAvailableHours([7])).toThrow(
			"Invalid availability hour: 7.",
		);
		expect(() => normalizeAvailableHours([18])).toThrow(
			"Invalid availability hour: 18.",
		);
		expect(() => normalizeAvailableHours([10.5])).toThrow(
			"Invalid availability hour: 10.5.",
		);
	});

	it("validates SaveCustomerFestivalAvailabilityRequest", () => {
		const festivalDates = ["2026-05-01", "2026-05-02"];

		const validResult = validateSaveCustomerFestivalAvailabilityRequest(
			{
				festivalId: "fest-1",
				subjects: [
					{
						subjectType: "accompanist",
						subjectId: "cust-1",
						days: [
							{ date: "2026-05-01", availableHours: [8, 9, 10] },
							{ date: "2026-05-02", availableHours: [] },
						],
					},
					{
						subjectType: "child",
						subjectId: "child-1",
						days: [{ date: "2026-05-01", availableHours: [12, 13, 17] }],
					},
				],
			},
			festivalDates,
		);
		expect(validResult).toEqual({ isValid: true, errors: [] });

		const invalidResult = validateSaveCustomerFestivalAvailabilityRequest(
			{
				festivalId: "",
				subjects: [
					{
						subjectType: "child",
						subjectId: "child-1",
						days: [
							{ date: "2026-05-03", availableHours: [8] },
							{ date: "2026-05-01", availableHours: [8, 18] },
						],
					},
				],
			},
			festivalDates,
		);
		expect(invalidResult.isValid).toBe(false);
		expect(invalidResult.errors).toContain("Festival ID is required.");
		expect(invalidResult.errors).toContain(
			"Invalid festival date: 2026-05-03.",
		);
		expect(invalidResult.errors).toContain(
			"Invalid available hours for date 2026-05-01.",
		);
	});
});
