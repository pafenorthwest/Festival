import { describe, expect, it } from "bun:test";
import { buildWednesdayDeadlineOptions } from "../src/pages/SchedulingDatesAndPoliciesSection.js";

// 2026-03-11 and 2026-03-18 are Wednesdays; the other dates are not.
const festivalDates = ["2026-03-10", "2026-03-18", "2026-03-11", "2026-03-12"];

describe("buildWednesdayDeadlineOptions", () => {
	it("offers only the Wednesdays among the configured festival dates", () => {
		expect(buildWednesdayDeadlineOptions(festivalDates, null)).toEqual([
			{ value: "2026-03-11", label: "2026-03-11 (Wed)", invalid: false },
			{ value: "2026-03-18", label: "2026-03-18 (Wed)", invalid: false },
		]);
	});

	it("offers nothing when no festival date is a Wednesday", () => {
		expect(
			buildWednesdayDeadlineOptions(["2026-03-10", "2026-03-12"], null),
		).toEqual([]);
	});

	it("does not duplicate a saved value that is already offered", () => {
		const options = buildWednesdayDeadlineOptions(festivalDates, "2026-03-11");
		expect(options.map((o) => o.value)).toEqual(["2026-03-11", "2026-03-18"]);
		expect(options.every((o) => !o.invalid)).toBe(true);
	});

	it("keeps a saved Wednesday outside the festival dates as an invalid option", () => {
		const [first, ...rest] = buildWednesdayDeadlineOptions(
			festivalDates,
			"2026-03-25",
		);
		expect(first).toEqual({
			value: "2026-03-25",
			label: "2026-03-25 (invalid: not a festival date)",
			invalid: true,
		});
		expect(rest.map((o) => o.value)).toEqual(["2026-03-11", "2026-03-18"]);
	});

	it("keeps a saved non-Wednesday as an invalid option", () => {
		const [first] = buildWednesdayDeadlineOptions(festivalDates, "2026-03-12");
		expect(first?.invalid).toBe(true);
		expect(first?.label).toContain("not a Wednesday");
	});
});
