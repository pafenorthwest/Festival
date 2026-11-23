import { describe, expect, it } from "bun:test";
import type { VolunteerRoleRecord } from "../src/volunteers/volunteer-repository.js";
import {
	validateBookShiftsRequest,
	validateCreateRoleRequest,
	validateCreateShiftRequest,
	validateCreateShiftsBatchRequest,
	validateShiftDateWithinFestivalWindow,
} from "../src/volunteers/volunteer-validation.js";

function role(
	overrides: Partial<VolunteerRoleRecord> = {},
): VolunteerRoleRecord {
	return {
		id: "role-1",
		organizationId: "org-a",
		festivalId: "fest-a",
		slug: "general",
		displayName: "General",
		description: "General volunteer duties.",
		detailsUrl: null,
		isRoomProctor: false,
		createdAtIso: new Date().toISOString(),
		...overrides,
	};
}

describe("validateCreateRoleRequest", () => {
	it("accepts a well-formed role", () => {
		const result = validateCreateRoleRequest({
			slug: "room-proctor",
			displayName: "Room Proctor",
			description: "Proctor a room.",
			detailsUrl: "https://example.com/roles/room-proctor",
			isRoomProctor: true,
		});

		expect("request" in result).toBe(true);
		if (!("request" in result)) throw new Error("Expected a valid request.");
		expect(result.request).toEqual({
			slug: "room-proctor",
			displayName: "Room Proctor",
			description: "Proctor a room.",
			detailsUrl: "https://example.com/roles/room-proctor",
			isRoomProctor: true,
		});
	});

	it("rejects a missing slug, display name, and description", () => {
		const result = validateCreateRoleRequest({});
		expect("errors" in result).toBe(true);
		if (!("errors" in result)) throw new Error("Expected errors.");
		expect(result.errors).toContain("Role slug is required.");
		expect(result.errors).toContain("Role display name is required.");
		expect(result.errors).toContain("Role description is required.");
	});

	it("rejects a slug with invalid characters", () => {
		const result = validateCreateRoleRequest({
			slug: "Room Proctor!",
			displayName: "Room Proctor",
			description: "Proctor a room.",
		});
		expect("errors" in result).toBe(true);
		if (!("errors" in result)) throw new Error("Expected errors.");
		expect(
			result.errors.some((error) => error.includes("lowercase letters")),
		).toBe(true);
	});

	it("rejects a non-http(s) details link", () => {
		const result = validateCreateRoleRequest({
			slug: "general",
			displayName: "General",
			description: "General duties.",
			detailsUrl: "javascript:alert(1)",
		});
		expect("errors" in result).toBe(true);
		if (!("errors" in result)) throw new Error("Expected errors.");
		expect(result.errors).toContain(
			"Role details link must be an http(s) URL.",
		);
	});
});

describe("validateCreateShiftRequest", () => {
	it("accepts a well-formed non-Room-Proctor shift", () => {
		const result = validateCreateShiftRequest(
			{ date: "2027-03-31", period: "am", timeText: "9am - 4:30pm" },
			role(),
		);
		expect("request" in result).toBe(true);
		if (!("request" in result)) throw new Error("Expected a valid request.");
		expect(result.request).toEqual({
			date: "2027-03-31",
			period: "AM",
			timeText: "9am - 4:30pm",
			division: null,
			adjudicator: null,
		});
	});

	it("requires a division and adjudicator for a Room Proctor shift", () => {
		const result = validateCreateShiftRequest(
			{ date: "2027-03-31", period: "AM" },
			role({ isRoomProctor: true }),
		);
		expect("errors" in result).toBe(true);
		if (!("errors" in result)) throw new Error("Expected errors.");
		expect(result.errors).toContain("Room Proctor shifts require a division.");
		expect(result.errors).toContain(
			"Room Proctor shifts require an adjudicator.",
		);
	});

	it("rejects a division or adjudicator on a non-Room-Proctor shift", () => {
		const result = validateCreateShiftRequest(
			{ date: "2027-03-31", period: "AM", division: "Piano" },
			role({ isRoomProctor: false }),
		);
		expect("errors" in result).toBe(true);
		if (!("errors" in result)) throw new Error("Expected errors.");
		expect(result.errors).toContain(
			"Only Room Proctor shifts may have a division or adjudicator.",
		);
	});

	it("rejects a malformed date or period", () => {
		const result = validateCreateShiftRequest(
			{ date: "03/31/2027", period: "morning" },
			role(),
		);
		expect("errors" in result).toBe(true);
		if (!("errors" in result)) throw new Error("Expected errors.");
		expect(result.errors).toContain(
			"Shift date is required and must use YYYY-MM-DD format.",
		);
		expect(result.errors).toContain(
			"Shift period is required and must be AM or PM.",
		);
	});
});

describe("validateBookShiftsRequest", () => {
	it("accepts valid shiftIds", () => {
		const result = validateBookShiftsRequest({
			shiftIds: ["shift-1", "shift-2"],
		});
		expect("request" in result).toBe(true);
		if (!("request" in result)) throw new Error("Expected valid request.");
		expect(result.request.shiftIds).toEqual(["shift-1", "shift-2"]);
	});

	it("rejects non-object bodies", () => {
		const result = validateBookShiftsRequest(null);
		expect("errors" in result).toBe(true);
		if (!("errors" in result)) throw new Error("Expected errors.");
		expect(result.errors).toContain("Request body must be an object.");
	});

	it("rejects empty or missing shiftIds", () => {
		const result = validateBookShiftsRequest({ shiftIds: [] });
		expect("errors" in result).toBe(true);
		if (!("errors" in result)) throw new Error("Expected errors.");
		expect(result.errors).toContain(
			"shiftIds must be a non-empty array of shift IDs.",
		);
	});

	it("rejects empty string in shiftIds", () => {
		const result = validateBookShiftsRequest({ shiftIds: ["shift-1", "   "] });
		expect("errors" in result).toBe(true);
		if (!("errors" in result)) throw new Error("Expected errors.");
		expect(result.errors).toContain(
			"Each shift ID must be a non-empty string.",
		);
	});
});

describe("validateShiftDateWithinFestivalWindow", () => {
	const festival = { startDate: "2027-03-01", endDate: "2027-03-05" };

	it("accepts dates inside the festival range", () => {
		expect(
			validateShiftDateWithinFestivalWindow("2027-03-03", festival),
		).toBeNull();
	});

	it("accepts dates at the +/- 30 day window boundaries", () => {
		expect(
			validateShiftDateWithinFestivalWindow("2027-01-30", festival),
		).toBeNull();
		expect(
			validateShiftDateWithinFestivalWindow("2027-04-04", festival),
		).toBeNull();
	});

	it("rejects dates outside the festival window including wrong year", () => {
		expect(
			validateShiftDateWithinFestivalWindow("2026-03-01", festival),
		).not.toBeNull();
		expect(
			validateShiftDateWithinFestivalWindow("2027-01-29", festival),
		).not.toBeNull();
		expect(
			validateShiftDateWithinFestivalWindow("2027-04-05", festival),
		).not.toBeNull();
	});
});

describe("validateCreateShiftsBatchRequest", () => {
	const festival = { startDate: "2027-03-01", endDate: "2027-03-05" };

	it("accepts a valid multi-day batch", () => {
		const result = validateCreateShiftsBatchRequest(
			{
				dates: ["2027-03-01", "2027-03-02", "2027-03-03"],
				period: "pm",
				timeText: "1pm - 4:30pm",
			},
			role(),
			festival,
		);
		expect("request" in result).toBe(true);
		if (!("request" in result)) throw new Error("Expected a valid request.");
		expect(result.request).toEqual({
			dates: ["2027-03-01", "2027-03-02", "2027-03-03"],
			period: "PM",
			timeText: "1pm - 4:30pm",
			division: null,
			adjudicator: null,
		});
	});

	it("rejects empty dates", () => {
		const result = validateCreateShiftsBatchRequest(
			{ dates: [], period: "AM" },
			role(),
			festival,
		);
		expect("errors" in result).toBe(true);
	});

	it("rejects batches exceeding 62 dates", () => {
		const dates = Array.from({ length: 63 }, (_, index) => {
			const day = new Date(Date.UTC(2027, 1, 1 + index));
			return day.toISOString().slice(0, 10);
		});
		const result = validateCreateShiftsBatchRequest(
			{ dates, period: "AM" },
			role(),
			festival,
		);
		expect("errors" in result).toBe(true);
	});

	it("rejects duplicate dates in payload", () => {
		const result = validateCreateShiftsBatchRequest(
			{ dates: ["2027-03-01", "2027-03-01"], period: "AM" },
			role(),
			festival,
		);
		expect("errors" in result).toBe(true);
	});

	it("rejects out-of-window wrong-year dates", () => {
		const result = validateCreateShiftsBatchRequest(
			{ dates: ["2027-03-01", "2026-03-01"], period: "AM" },
			role(),
			festival,
		);
		expect("errors" in result).toBe(true);
	});

	it("enforces Room Proctor division and adjudicator rules", () => {
		const missing = validateCreateShiftsBatchRequest(
			{ dates: ["2027-03-01"], period: "AM" },
			role({ isRoomProctor: true }),
			festival,
		);
		expect("errors" in missing).toBe(true);

		const extra = validateCreateShiftsBatchRequest(
			{ dates: ["2027-03-01"], period: "AM", division: "Piano" },
			role({ isRoomProctor: false }),
			festival,
		);
		expect("errors" in extra).toBe(true);
	});
});
