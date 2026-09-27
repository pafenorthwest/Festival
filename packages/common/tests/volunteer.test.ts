import { describe, expect, it } from "bun:test";
import {
	calculateCoverageGaps,
	type VolunteerAssignment,
	type VolunteerRole,
	type VolunteerShift,
	validateBookShiftsInput,
	validateCancelShiftAssignmentInput,
	validateCreateVolunteerRoleInput,
	validateCreateVolunteerShiftInput,
	validateEnrollVolunteerInput,
	validateShiftBookingConflicts,
} from "../src/index.js";

describe("volunteer domain schemas and validation", () => {
	describe("validateCreateVolunteerRoleInput", () => {
		it("validates a valid volunteer role", () => {
			const result = validateCreateVolunteerRoleInput({
				slug: "room-proctor",
				displayName: "Room Proctor",
				description: "Proctor competition rooms.",
				detailsUrl: "https://example.com/roles/proctor",
				isRoomProctor: true,
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.slug).toBe("room-proctor");
			expect(result.data?.isRoomProctor).toBe(true);
		});

		it("rejects non-object or missing input", () => {
			const result = validateCreateVolunteerRoleInput(null);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Role input must be an object.");
		});

		it("rejects invalid role slugs", () => {
			const empty = validateCreateVolunteerRoleInput({
				slug: "",
				displayName: "Name",
				description: "Desc",
			});
			expect(empty.valid).toBe(false);
			expect(empty.errors).toContain("Role slug is required.");

			const invalidChars = validateCreateVolunteerRoleInput({
				slug: "bad_slug",
				displayName: "Name",
				description: "Desc",
			});
			expect(invalidChars.valid).toBe(false);
			expect(invalidChars.errors[0]).toContain("may only contain lowercase");
		});

		it("rejects invalid details URL", () => {
			const result = validateCreateVolunteerRoleInput({
				slug: "role-slug",
				displayName: "Name",
				description: "Desc",
				detailsUrl: "not-a-url",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Role details link must be an http(s) URL.",
			);
		});
	});

	describe("validateCreateVolunteerShiftInput", () => {
		it("validates a standard shift", () => {
			const result = validateCreateVolunteerShiftInput(
				{
					date: "2027-03-31",
					period: "AM",
					timeText: "9:00 AM - 12:00 PM",
				},
				false,
			);
			expect(result.valid).toBe(true);
			expect(result.data?.date).toBe("2027-03-31");
			expect(result.data?.period).toBe("AM");
		});

		it("validates room proctor shift with division and adjudicator", () => {
			const result = validateCreateVolunteerShiftInput(
				{
					date: "2027-03-31",
					period: "PM",
					division: "Piano",
					adjudicator: "Dr Brown",
				},
				{ isRoomProctor: true },
			);
			expect(result.valid).toBe(true);
			expect(result.data?.division).toBe("Piano");
			expect(result.data?.adjudicator).toBe("Dr Brown");
		});

		it("rejects room proctor shift missing required division or adjudicator", () => {
			const result = validateCreateVolunteerShiftInput(
				{
					date: "2027-03-31",
					period: "PM",
				},
				true,
			);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Room Proctor shifts require a division.",
			);
			expect(result.errors).toContain(
				"Room Proctor shifts require an adjudicator.",
			);
		});

		it("rejects standard shift with division or adjudicator", () => {
			const result = validateCreateVolunteerShiftInput(
				{
					date: "2027-03-31",
					period: "PM",
					division: "Piano",
				},
				false,
			);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Only Room Proctor shifts may have a division or adjudicator.",
			);
		});
	});

	describe("validateBookShiftsInput", () => {
		it("validates valid shift booking input", () => {
			const result = validateBookShiftsInput({
				shiftIds: ["shift-1", "shift-2"],
				name: "Ada Lovelace",
				phone: "555-0100",
			});
			expect(result.valid).toBe(true);
			expect(result.data?.shiftIds).toEqual(["shift-1", "shift-2"]);
		});

		it("rejects empty or duplicate shift selections", () => {
			const empty = validateBookShiftsInput({ shiftIds: [] });
			expect(empty.valid).toBe(false);
			expect(empty.errors).toContain("At least one shift must be selected.");

			const duplicates = validateBookShiftsInput({
				shiftIds: ["shift-1", "shift-1"],
			});
			expect(duplicates.valid).toBe(false);
			expect(duplicates.errors).toContain(
				"Duplicate shifts cannot be selected.",
			);
		});
	});

	describe("validateCancelShiftAssignmentInput", () => {
		it("validates assignment cancellation", () => {
			const result = validateCancelShiftAssignmentInput({
				assignmentId: "assign-123",
				reason: "Schedule conflict",
			});
			expect(result.valid).toBe(true);
			expect(result.data?.assignmentId).toBe("assign-123");
		});

		it("rejects missing assignmentId", () => {
			const result = validateCancelShiftAssignmentInput({});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Assignment ID is required for shift cancellation.",
			);
		});
	});

	describe("validateEnrollVolunteerInput", () => {
		it("validates volunteer enrollment", () => {
			const result = validateEnrollVolunteerInput({
				name: "Ada Lovelace",
				phone: "555-0100",
			});
			expect(result.valid).toBe(true);
			expect(result.data?.name).toBe("Ada Lovelace");
		});

		it("rejects missing or overly long fields", () => {
			const empty = validateEnrollVolunteerInput({ name: "", phone: "" });
			expect(empty.valid).toBe(false);
			expect(empty.errors).toContain("Name is required.");
			expect(empty.errors).toContain("Phone is required.");
		});
	});

	describe("calculateCoverageGaps", () => {
		const roles: VolunteerRole[] = [
			{
				id: "role-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				slug: "proctor",
				displayName: "Room Proctor",
				description: "Proctor",
				detailsUrl: null,
				isRoomProctor: true,
				createdAtIso: "2026-01-01T00:00:00Z",
			},
			{
				id: "role-2",
				organizationId: "org-1",
				festivalId: "fest-1",
				slug: "greeter",
				displayName: "Greeter",
				description: "Greet",
				detailsUrl: null,
				isRoomProctor: false,
				createdAtIso: "2026-01-01T00:00:00Z",
			},
		];

		const shifts: VolunteerShift[] = [
			{
				id: "shift-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				roleId: "role-1",
				date: "2027-03-31",
				period: "AM",
				timeText: "9am - 12pm",
				division: "Piano",
				adjudicator: "Dr Brown",
				createdAtIso: "2026-01-01T00:00:00Z",
			},
			{
				id: "shift-2",
				organizationId: "org-1",
				festivalId: "fest-1",
				roleId: "role-2",
				date: "2027-03-31",
				period: "PM",
				timeText: null,
				division: null,
				adjudicator: null,
				createdAtIso: "2026-01-01T00:00:00Z",
			},
		];

		it("identifies unfilled shifts as coverage gaps", () => {
			const assignments: VolunteerAssignment[] = [
				{
					id: "assign-1",
					organizationId: "org-1",
					shiftId: "shift-1",
					volunteerId: "vol-1",
					status: "active",
					createdAtIso: "2026-01-01T00:00:00Z",
					cancelledAtIso: null,
				},
			];

			const summary = calculateCoverageGaps(shifts, roles, assignments);
			expect(summary.totalShifts).toBe(2);
			expect(summary.coveredShifts).toBe(1);
			expect(summary.unfilledShifts).toBe(1);
			expect(summary.coveragePercentage).toBe(50);
			expect(summary.gaps).toHaveLength(1);
			expect(summary.gaps[0].shiftId).toBe("shift-2");
			expect(summary.gaps[0].roleDisplayName).toBe("Greeter");
		});

		it("treats cancelled assignments as uncovered gaps", () => {
			const assignments: VolunteerAssignment[] = [
				{
					id: "assign-1",
					organizationId: "org-1",
					shiftId: "shift-1",
					volunteerId: "vol-1",
					status: "cancelled",
					createdAtIso: "2026-01-01T00:00:00Z",
					cancelledAtIso: "2026-01-02T00:00:00Z",
				},
			];

			const summary = calculateCoverageGaps(shifts, roles, assignments);
			expect(summary.unfilledShifts).toBe(2);
			expect(summary.coveragePercentage).toBe(0);
		});
	});

	describe("validateShiftBookingConflicts", () => {
		const shift1: VolunteerShift = {
			id: "s-1",
			organizationId: "org-1",
			festivalId: "fest-1",
			roleId: "r-1",
			date: "2027-03-31",
			period: "AM",
			timeText: null,
			division: null,
			adjudicator: null,
			createdAtIso: "2026-01-01T00:00:00Z",
		};
		const shift2: VolunteerShift = {
			id: "s-2",
			organizationId: "org-1",
			festivalId: "fest-1",
			roleId: "r-2",
			date: "2027-03-31",
			period: "AM",
			timeText: null,
			division: null,
			adjudicator: null,
			createdAtIso: "2026-01-01T00:00:00Z",
		};
		const shift3: VolunteerShift = {
			id: "s-3",
			organizationId: "org-1",
			festivalId: "fest-1",
			roleId: "r-1",
			date: "2027-03-31",
			period: "PM",
			timeText: null,
			division: null,
			adjudicator: null,
			createdAtIso: "2026-01-01T00:00:00Z",
		};

		it("flags internal conflicts within selected shifts", () => {
			const result = validateShiftBookingConflicts([shift1, shift2], [], []);
			expect(result.valid).toBe(false);
			expect(result.conflictShiftIds).toContain("s-2");
		});

		it("allows different periods on the same date", () => {
			const result = validateShiftBookingConflicts([shift1, shift3], [], []);
			expect(result.valid).toBe(true);
			expect(result.conflictShiftIds).toEqual([]);
		});

		it("flags conflict with already filled shift", () => {
			const active: VolunteerAssignment = {
				id: "a-1",
				organizationId: "org-1",
				shiftId: "s-1",
				volunteerId: "other-vol",
				status: "active",
				createdAtIso: "2026-01-01T00:00:00Z",
				cancelledAtIso: null,
			};
			const result = validateShiftBookingConflicts([shift1], [], [active]);
			expect(result.valid).toBe(false);
			expect(result.conflictShiftIds).toContain("s-1");
		});

		it("flags conflict with volunteer existing shift", () => {
			const result = validateShiftBookingConflicts([shift1], [shift2], []);
			expect(result.valid).toBe(false);
			expect(result.conflictShiftIds).toContain("s-1");
		});
	});
});
