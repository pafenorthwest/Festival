import { describe, expect, it } from "bun:test";
import {
	addShiftsLabel,
	buildShiftInputs,
	createShiftsForDays,
	datesWithMatchingShift,
	describeCreateResult,
	isValidShiftDate,
	listFestivalDays,
	mergeDays,
	validateNewShiftDraft,
	validateShiftDates,
} from "../src/domains/volunteers/shiftDays.js";
import type { VolunteerShift } from "../src/lib/api.js";

const shift = (overrides: Partial<VolunteerShift>): VolunteerShift => ({
	id: "s1",
	organizationId: "o",
	festivalId: "f",
	roleId: "r",
	date: "2026-11-12",
	period: "AM",
	timeText: null,
	division: null,
	adjudicator: null,
	createdAtIso: "2026-11-01T00:00:00.000Z",
	...overrides,
});

describe("listFestivalDays", () => {
	it("lists every day from start to end inclusive", () => {
		expect(listFestivalDays("2026-11-10", "2026-11-13")).toEqual([
			"2026-11-10",
			"2026-11-11",
			"2026-11-12",
			"2026-11-13",
		]);
		expect(listFestivalDays("2026-11-10", "2026-11-10")).toEqual([
			"2026-11-10",
		]);
	});

	it("crosses month and year boundaries and leap days", () => {
		expect(listFestivalDays("2026-12-30", "2027-01-02")).toEqual([
			"2026-12-30",
			"2026-12-31",
			"2027-01-01",
			"2027-01-02",
		]);
		expect(listFestivalDays("2028-02-28", "2028-03-01")).toEqual([
			"2028-02-28",
			"2028-02-29",
			"2028-03-01",
		]);
	});

	it("returns nothing for missing, reversed, or malformed dates", () => {
		expect(listFestivalDays(undefined, "2026-11-10")).toEqual([]);
		expect(listFestivalDays("2026-11-12", "2026-11-10")).toEqual([]);
		expect(listFestivalDays("11/10/2026", "2026-11-12")).toEqual([]);
	});

	it("stops a runaway range from listing years of days", () => {
		expect(
			listFestivalDays("2020-01-01", "2030-01-01").length,
		).toBeLessThanOrEqual(62);
	});
});

describe("isValidShiftDate", () => {
	it("accepts real calendar dates only", () => {
		expect(isValidShiftDate("2026-11-12")).toBe(true);
		expect(isValidShiftDate("2026-02-30")).toBe(false);
		expect(isValidShiftDate("2026-13-01")).toBe(false);
		expect(isValidShiftDate("tomorrow")).toBe(false);
	});
});

describe("mergeDays", () => {
	it("adds extra dates, removes duplicates, and keeps date order", () => {
		expect(
			mergeDays(["2026-11-11", "2026-11-12"], ["2026-11-09", "2026-11-12"]),
		).toEqual(["2026-11-09", "2026-11-11", "2026-11-12"]);
	});
});

describe("datesWithMatchingShift", () => {
	const existing = [
		shift({ id: "a", date: "2026-11-10", period: "AM" }),
		shift({ id: "b", date: "2026-11-11", period: "PM" }),
		shift({
			id: "c",
			date: "2026-11-12",
			period: "AM",
			division: "Piano",
			adjudicator: "Dr. Lee",
		}),
	];

	it("matches the same period on days that already have it", () => {
		expect(
			[...datesWithMatchingShift(existing, { period: "AM" })].sort(),
		).toEqual(["2026-11-10"]);
		expect([...datesWithMatchingShift(existing, { period: "PM" })]).toEqual([
			"2026-11-11",
		]);
	});

	it("treats a different division or adjudicator as a different shift, ignoring case and spacing", () => {
		const proctor = {
			period: "AM" as const,
			division: " piano ",
			adjudicator: "DR. LEE",
		};
		expect([...datesWithMatchingShift(existing, proctor)]).toEqual([
			"2026-11-12",
		]);
		expect(
			datesWithMatchingShift(existing, { ...proctor, division: "Voice" }).size,
		).toBe(0);
	});
});

describe("validateNewShiftDraft", () => {
	it("requires a division and adjudicator for Room Proctor roles", () => {
		expect(validateNewShiftDraft({ period: "AM" }, true)).toBe(
			"Room Proctor shifts require a division.",
		);
		expect(
			validateNewShiftDraft({ period: "AM", division: "Piano" }, true),
		).toBe("Room Proctor shifts require an adjudicator.");
		expect(
			validateNewShiftDraft(
				{ period: "AM", division: "Piano", adjudicator: "Lee" },
				true,
			),
		).toBeNull();
	});

	it("rejects a division or adjudicator on other roles", () => {
		expect(
			validateNewShiftDraft({ period: "PM", division: "Piano" }, false),
		).toBe("Only Room Proctor shifts may have a division or adjudicator.");
		expect(
			validateNewShiftDraft({ period: "PM", timeText: "9-1" }, false),
		).toBeNull();
	});
});

describe("validateShiftDates", () => {
	it("needs at least one valid day", () => {
		expect(validateShiftDates([])).toBe("Choose at least one day.");
		expect(validateShiftDates(["2026-11-10", "nope"])).toBe(
			"Every day must be a valid date.",
		);
		expect(validateShiftDates(["2026-11-10"])).toBeNull();
	});
});

describe("buildShiftInputs", () => {
	it("makes one input per day, in date order, with the same details on each", () => {
		const inputs = buildShiftInputs(
			["2026-11-12", "2026-11-10", "2026-11-12"],
			{
				period: "PM",
				timeText: " 1pm - 5pm ",
				division: " Piano ",
				adjudicator: " Lee ",
			},
		);
		expect(inputs).toEqual([
			{
				date: "2026-11-10",
				period: "PM",
				timeText: "1pm - 5pm",
				division: "Piano",
				adjudicator: "Lee",
			},
			{
				date: "2026-11-12",
				period: "PM",
				timeText: "1pm - 5pm",
				division: "Piano",
				adjudicator: "Lee",
			},
		]);
	});
});

describe("createShiftsForDays", () => {
	const inputs = buildShiftInputs(["2026-11-10", "2026-11-11", "2026-11-12"], {
		period: "AM",
	});

	it("creates every day in order", async () => {
		const seen: string[] = [];
		const result = await createShiftsForDays(inputs, async (input) => {
			seen.push(input.date);
		});
		expect(seen).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
		expect(result).toEqual({ created: seen, remaining: [] });
	});

	it("waits for each request before sending the next", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		await createShiftsForDays(inputs, async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 1));
			inFlight--;
		});
		expect(maxInFlight).toBe(1);
	});

	it("stops at the first failure and keeps the failed and later days as remaining", async () => {
		const attempted: string[] = [];
		const result = await createShiftsForDays(inputs, async (input) => {
			attempted.push(input.date);
			if (input.date === "2026-11-11") throw new Error("Server said no.");
		});
		expect(attempted).toEqual(["2026-11-10", "2026-11-11"]);
		expect(result.created).toEqual(["2026-11-10"]);
		expect(result.failed).toEqual({
			date: "2026-11-11",
			message: "Server said no.",
		});
		expect(result.remaining).toEqual(["2026-11-11", "2026-11-12"]);
	});

	it("gives a plain message when the error has none", async () => {
		const result = await createShiftsForDays(inputs, async () => {
			throw "boom";
		});
		expect(result.failed?.message).toBe("The shift could not be created.");
	});
});

describe("describeCreateResult", () => {
	it("reports a full success", () => {
		expect(
			describeCreateResult({ created: ["2026-11-10"], remaining: [] }, 1),
		).toBe("Added 1 shift.");
		expect(
			describeCreateResult(
				{ created: ["2026-11-10", "2026-11-11"], remaining: [] },
				2,
			),
		).toBe("Added 2 shifts.");
	});

	it("names the day that failed and says the rest are still selected", () => {
		const message = describeCreateResult(
			{
				created: ["2026-11-10"],
				failed: { date: "2026-11-11", message: "Server said no." },
				remaining: ["2026-11-11", "2026-11-12"],
			},
			3,
		);
		expect(message).toBe(
			"Added 1 of 3 shifts. Could not add Wed 11/11: Server said no. The days that were not added are still selected.",
		);
	});
});

describe("addShiftsLabel", () => {
	it("keeps the singular label for one day and counts several", () => {
		expect(addShiftsLabel(0)).toBe("Add shift");
		expect(addShiftsLabel(1)).toBe("Add shift");
		expect(addShiftsLabel(4)).toBe("Add 4 shifts");
	});
});
