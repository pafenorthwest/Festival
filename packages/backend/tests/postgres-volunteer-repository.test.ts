import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import { PostgresVolunteerRepository } from "../src/volunteers/postgres-volunteer-repository.js";

async function source() {
	return (
		await Bun.file(
			new URL(
				"../src/volunteers/postgres-volunteer-repository.ts",
				import.meta.url,
			),
		).text()
	).replace(/\r\n/g, "\n");
}

describe("PostgresVolunteerRepository", () => {
	it("rejects unsafe schema identifiers before building SQL", () => {
		expect(
			() => new PostgresVolunteerRepository("festival; DROP TABLE users"),
		).toThrow("Database schema is invalid.");
	});

	it("uses a SQL transaction with row locking for bookShifts", async () => {
		const value = await source();
		expect(value).toContain("return (await sql.begin(async (tx) => {");
		expect(value).toContain("SELECT id FROM $" + "{this.schema}.volunteers");
		expect(value).toContain("FOR UPDATE");
		expect(value).toContain("SELECT id, organization_id, festival_id, role_id");
		expect(value).toContain("WHERE id IN ($" + "{placeholders})");
		expect(value).toContain("ORDER BY id");
		expect(value).toContain("FOR UPDATE");
		expect(value).toContain("SELECT shift_id");
		expect(value).toContain("status = 'active'");
		expect(value).toContain(
			"INSERT INTO $" + "{this.schema}.volunteer_assignments",
		);
		expect(value).toContain("'active'");
	});

	it("queries volunteer by uid within festival scope", async () => {
		const value = await source();
		expect(value).toContain(
			"SELECT id, organization_id, festival_id, firebase_uid, account_email, name, phone, created_at::text",
		);
		expect(value).toContain(
			"WHERE organization_id = $1 AND festival_id = $2 AND firebase_uid = $3",
		);
	});

	it("lists only active assignments for a volunteer", async () => {
		const value = await source();
		expect(value).toContain(
			"FROM $" + "{this.schema}.volunteer_assignments assignment",
		);
		expect(value).toContain("JOIN $" + "{this.schema}.volunteer_shifts shift");
		expect(value).toContain("JOIN $" + "{this.schema}.volunteer_roles role");
		expect(value).toContain("AND assignment.status = 'active'");
		expect(value).toContain("ORDER BY shift.date, shift.period");
	});

	it("updates status to cancelled on cancelAssignment", async () => {
		const value = await source();
		expect(value).toContain("SET status = 'cancelled', cancelled_at = $1");
		expect(value).toContain("assignment.status = 'active'");
	});

	describe("method behavior", () => {
		let repo: PostgresVolunteerRepository;
		let unsafeSpy: ReturnType<typeof spyOn>;

		beforeEach(() => {
			repo = new PostgresVolunteerRepository("test_schema");
			unsafeSpy = spyOn(sql, "unsafe");
		});

		afterEach(() => {
			unsafeSpy.mockRestore();
		});

		it("findVolunteerByUid returns mapped VolunteerRecord when found", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "vol-1",
					organization_id: "org-1",
					festival_id: "fest-1",
					firebase_uid: "uid-123",
					account_email: "v@example.com",
					name: "Ada Lovelace",
					phone: "555-1234",
					created_at: "2026-03-01T00:00:00.000Z",
				},
			]);

			const result = await repo.findVolunteerByUid(
				"org-1",
				"fest-1",
				"uid-123",
			);
			expect(result).toEqual({
				id: "vol-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				firebaseUid: "uid-123",
				accountEmail: "v@example.com",
				name: "Ada Lovelace",
				phone: "555-1234",
				createdAtIso: "2026-03-01T00:00:00.000Z",
			});
		});

		it("findVolunteerByUid returns null when not found", async () => {
			unsafeSpy.mockResolvedValueOnce([]);

			const result = await repo.findVolunteerByUid(
				"org-1",
				"fest-1",
				"uid-unknown",
			);
			expect(result).toBeNull();
		});

		it("listAssignmentsForVolunteer returns mapped assignments", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					assignment_id: "assign-1",
					organization_id: "org-1",
					shift_id: "shift-1",
					volunteer_id: "vol-1",
					status: "active",
					assignment_created_at: "2026-03-01T10:00:00.000Z",
					assignment_cancelled_at: null,
					shift_festival_id: "fest-1",
					role_id: "role-1",
					shift_date: "2027-03-31",
					shift_period: "AM",
					shift_time_text: "9am - 12pm",
					shift_division: "Piano",
					shift_adjudicator: "Dr Brown",
					shift_created_at: "2026-03-01T08:00:00.000Z",
					slug: "room-proctor",
					display_name: "Room Proctor",
					description: "Proctor rooms",
					details_url: "https://example.com/details",
					is_room_proctor: true,
					role_created_at: "2026-03-01T07:00:00.000Z",
				},
			]);

			const result = await repo.listAssignmentsForVolunteer(
				"org-1",
				"fest-1",
				"vol-1",
			);
			expect(result).toHaveLength(1);
			expect(result[0].assignment).toEqual({
				id: "assign-1",
				organizationId: "org-1",
				shiftId: "shift-1",
				volunteerId: "vol-1",
				status: "active",
				createdAtIso: "2026-03-01T10:00:00.000Z",
				cancelledAtIso: null,
			});
			expect(result[0].shift).toEqual({
				id: "shift-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				roleId: "role-1",
				date: "2027-03-31",
				period: "AM",
				timeText: "9am - 12pm",
				division: "Piano",
				adjudicator: "Dr Brown",
				createdAtIso: "2026-03-01T08:00:00.000Z",
			});
			expect(result[0].role).toEqual({
				id: "role-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				slug: "room-proctor",
				displayName: "Room Proctor",
				description: "Proctor rooms",
				detailsUrl: "https://example.com/details",
				isRoomProctor: true,
				createdAtIso: "2026-03-01T07:00:00.000Z",
			});
		});

		it("cancelAssignment returns updated record when active assignment exists", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "assign-1",
					organization_id: "org-1",
					shift_id: "shift-1",
					volunteer_id: "vol-1",
					status: "cancelled",
					created_at: "2026-03-01T10:00:00.000Z",
					cancelled_at: "2026-03-02T12:00:00.000Z",
				},
			]);

			const result = await repo.cancelAssignment({
				organizationId: "org-1",
				festivalId: "fest-1",
				assignmentId: "assign-1",
				cancelledAtIso: "2026-03-02T12:00:00.000Z",
			});
			expect(result).toEqual({
				id: "assign-1",
				organizationId: "org-1",
				shiftId: "shift-1",
				volunteerId: "vol-1",
				status: "cancelled",
				createdAtIso: "2026-03-01T10:00:00.000Z",
				cancelledAtIso: "2026-03-02T12:00:00.000Z",
			});
		});

		it("cancelAssignment returns null when assignment not found", async () => {
			unsafeSpy.mockResolvedValueOnce([]);

			const result = await repo.cancelAssignment({
				organizationId: "org-1",
				festivalId: "fest-1",
				assignmentId: "assign-missing",
				cancelledAtIso: "2026-03-02T12:00:00.000Z",
			});
			expect(result).toBeNull();
		});

		it("bookShifts returns conflict when volunteer does not exist", async () => {
			const beginSpy = spyOn(sql, "begin").mockImplementation(
				async (callback) => {
					const tx = {
						unsafe: async () => [],
					};
					return callback(tx as never);
				},
			);

			const result = await repo.bookShifts({
				organizationId: "org-1",
				festivalId: "fest-1",
				volunteerId: "vol-nonexistent",
				shiftIds: ["shift-1"],
			});
			expect(result).toEqual({ kind: "conflict", shiftIds: ["shift-1"] });
			beginSpy.mockRestore();
		});

		it("bookShifts returns booked when shiftIds is empty", async () => {
			const beginSpy = spyOn(sql, "begin").mockImplementation(
				async (callback) => {
					const tx = {
						unsafe: async () => [{ id: "vol-1" }],
					};
					return callback(tx as never);
				},
			);

			const result = await repo.bookShifts({
				organizationId: "org-1",
				festivalId: "fest-1",
				volunteerId: "vol-1",
				shiftIds: [],
			});
			expect(result).toEqual({ kind: "booked", assignments: [] });
			beginSpy.mockRestore();
		});

		it("bookShifts books shifts successfully through SQL transaction", async () => {
			const beginSpy = spyOn(sql, "begin").mockImplementation(
				async (callback) => {
					let callCount = 0;
					const tx = {
						unsafe: async () => {
							callCount += 1;
							if (callCount === 1) {
								// volunteer lock check
								return [{ id: "vol-1" }];
							}
							if (callCount === 2) {
								// locked shifts query
								return [
									{
										id: "shift-1",
										organization_id: "org-1",
										festival_id: "fest-1",
										role_id: "role-1",
										date: "2027-03-31",
										period: "AM",
										time_text: null,
										division: null,
										adjudicator: null,
										created_at: "2026-03-01T00:00:00.000Z",
									},
								];
							}
							if (callCount === 3) {
								// active assignments for shifts
								return [];
							}
							if (callCount === 4) {
								// existing volunteer active assignments
								return [];
							}
							if (callCount === 5) {
								// insert assignment
								return [
									{
										id: "assign-new-1",
										organization_id: "org-1",
										shift_id: "shift-1",
										volunteer_id: "vol-1",
										status: "active",
										created_at: "2026-03-01T12:00:00.000Z",
										cancelled_at: null,
									},
								];
							}
							return [];
						},
					};
					return callback(tx as never);
				},
			);

			const result = await repo.bookShifts({
				organizationId: "org-1",
				festivalId: "fest-1",
				volunteerId: "vol-1",
				shiftIds: ["shift-1"],
			});
			expect(result.kind).toBe("booked");
			if (result.kind === "booked") {
				expect(result.assignments).toHaveLength(1);
				expect(result.assignments[0].id).toBe("assign-new-1");
				expect(result.assignments[0].status).toBe("active");
			}
			beginSpy.mockRestore();
		});
	});
});
