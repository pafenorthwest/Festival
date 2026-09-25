import { describe, expect, it } from "bun:test";
import type { VolunteerRoleRecord } from "../src/volunteers/volunteer-repository.js";
import {
	validateCreateRoleRequest,
	validateCreateShiftRequest,
} from "../src/volunteers/volunteer-validation.js";

function role(
	overrides: Partial<VolunteerRoleRecord> = {},
): VolunteerRoleRecord {
	return {
		id: "role-1",
		organizationId: "org-a",
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
