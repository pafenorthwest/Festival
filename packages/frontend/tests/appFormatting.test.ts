import { describe, expect, it } from "bun:test";
import { formatScheduleDate } from "../src/app/appFormatting.js";

describe("formatScheduleDate", () => {
	it("formats a date as weekday and MM/DD, per specs/VOLUNTEER-PORTAL.md", () => {
		expect(formatScheduleDate("2026-03-31")).toBe("Tue 03/31");
	});

	it("pads single-digit months and days", () => {
		expect(formatScheduleDate("2026-01-05")).toBe("Mon 01/05");
	});

	it("returns the original value when it isn't a well-formed date", () => {
		expect(formatScheduleDate("not-a-date")).toBe("not-a-date");
	});
});
