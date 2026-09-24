import { describe, expect, it } from "bun:test";
import { InMemoryVolunteerRepository } from "../src/volunteers/volunteer-repository.js";

async function seedShift(
	repository: InMemoryVolunteerRepository,
	overrides: Partial<{
		date: string;
		period: "AM" | "PM";
		roleId: string;
	}> = {},
) {
	const role =
		overrides.roleId === undefined
			? await repository.createRole({
					organizationId: "org-a",
					slug: "table-monitor",
					description: "Watch the table.",
					detailsUrl: null,
					isRoomProctor: false,
				})
			: null;
	return repository.createShift({
		organizationId: "org-a",
		roleId: overrides.roleId ?? (role?.id as string),
		date: overrides.date ?? "2027-03-31",
		period: overrides.period ?? "AM",
		timeText: null,
		division: null,
		adjudicator: null,
	});
}

describe("volunteer repository", () => {
	it("keeps separate enrollments for the same person in different festivals", async () => {
		const repository = new InMemoryVolunteerRepository();

		const springEnrollment = await repository.upsertVolunteer({
			organizationId: "org-a",
			festivalId: "festival-spring",
			firebaseUid: "uid-1",
			accountEmail: "a@example.com",
			name: "Ada",
			phone: "555-0100",
		});
		const fallEnrollment = await repository.upsertVolunteer({
			organizationId: "org-a",
			festivalId: "festival-fall",
			firebaseUid: "uid-1",
			accountEmail: "a@example.com",
			name: "Ada",
			phone: "555-0100",
		});

		expect(springEnrollment.id).not.toBe(fallEnrollment.id);
		expect(springEnrollment.festivalId).toBe("festival-spring");
		expect(fallEnrollment.festivalId).toBe("festival-fall");

		const updatedSpringEnrollment = await repository.upsertVolunteer({
			organizationId: "org-a",
			festivalId: "festival-spring",
			firebaseUid: "uid-1",
			accountEmail: "a@example.com",
			name: "Ada Updated",
			phone: "555-0199",
		});
		expect(updatedSpringEnrollment.id).toBe(springEnrollment.id);
		expect(updatedSpringEnrollment.name).toBe("Ada Updated");
	});

	it("books a shift for a volunteer", async () => {
		const repository = new InMemoryVolunteerRepository();
		const volunteer = await repository.upsertVolunteer({
			organizationId: "org-a",
			festivalId: "festival-a",
			firebaseUid: "uid-1",
			accountEmail: "a@example.com",
			name: "Ada",
			phone: "555-0100",
		});
		const shift = await seedShift(repository);

		const outcome = await repository.bookShifts({
			organizationId: "org-a",
			volunteerId: volunteer.id,
			shiftIds: [shift.id],
		});

		expect(outcome.kind).toBe("booked");
	});

	it("refuses to double-book an already-filled shift", async () => {
		const repository = new InMemoryVolunteerRepository();
		const shift = await seedShift(repository);
		const first = await repository.upsertVolunteer({
			organizationId: "org-a",
			festivalId: "festival-a",
			firebaseUid: "uid-1",
			accountEmail: "a@example.com",
			name: "Ada",
			phone: "555-0100",
		});
		const second = await repository.upsertVolunteer({
			organizationId: "org-a",
			festivalId: "festival-a",
			firebaseUid: "uid-2",
			accountEmail: "b@example.com",
			name: "Bea",
			phone: "555-0101",
		});

		await repository.bookShifts({
			organizationId: "org-a",
			volunteerId: first.id,
			shiftIds: [shift.id],
		});
		const outcome = await repository.bookShifts({
			organizationId: "org-a",
			volunteerId: second.id,
			shiftIds: [shift.id],
		});

		expect(outcome.kind).toBe("conflict");
	});

	it("refuses a second AM assignment on the same date, across different roles", async () => {
		const repository = new InMemoryVolunteerRepository();
		const volunteer = await repository.upsertVolunteer({
			organizationId: "org-a",
			festivalId: "festival-a",
			firebaseUid: "uid-1",
			accountEmail: "a@example.com",
			name: "Ada",
			phone: "555-0100",
		});
		const firstShift = await seedShift(repository, {
			date: "2027-03-31",
			period: "AM",
		});
		const secondRole = await repository.createRole({
			organizationId: "org-a",
			slug: "registration-desk",
			description: "Check people in.",
			detailsUrl: null,
			isRoomProctor: false,
		});
		const secondShift = await seedShift(repository, {
			date: "2027-03-31",
			period: "AM",
			roleId: secondRole.id,
		});

		await repository.bookShifts({
			organizationId: "org-a",
			volunteerId: volunteer.id,
			shiftIds: [firstShift.id],
		});
		const outcome = await repository.bookShifts({
			organizationId: "org-a",
			volunteerId: volunteer.id,
			shiftIds: [secondShift.id],
		});

		expect(outcome.kind).toBe("conflict");
	});

	it("books nothing when a multi-slot submission has an internal conflict", async () => {
		const repository = new InMemoryVolunteerRepository();
		const volunteer = await repository.upsertVolunteer({
			organizationId: "org-a",
			festivalId: "festival-a",
			firebaseUid: "uid-1",
			accountEmail: "a@example.com",
			name: "Ada",
			phone: "555-0100",
		});
		const validShift = await seedShift(repository, {
			date: "2027-04-01",
			period: "PM",
		});
		const role = await repository.createRole({
			organizationId: "org-a",
			slug: "room-proctor",
			description: "Proctor a room.",
			detailsUrl: null,
			isRoomProctor: true,
		});
		const conflictingShiftA = await repository.createShift({
			organizationId: "org-a",
			roleId: role.id,
			date: "2027-03-31",
			period: "AM",
			timeText: null,
			division: "Piano",
			adjudicator: "Dr Brown",
		});
		const conflictingShiftB = await repository.createShift({
			organizationId: "org-a",
			roleId: role.id,
			date: "2027-03-31",
			period: "AM",
			timeText: null,
			division: "Piano",
			adjudicator: "Mr Yellow",
		});

		const outcome = await repository.bookShifts({
			organizationId: "org-a",
			volunteerId: volunteer.id,
			shiftIds: [validShift.id, conflictingShiftA.id, conflictingShiftB.id],
		});

		expect(outcome.kind).toBe("conflict");
		const schedule = await repository.listScheduleForOrganization("org-a");
		expect(schedule.every((entry) => entry.assignment === null)).toBe(true);
	});

	it("reopens a slot immediately on cancellation", async () => {
		const repository = new InMemoryVolunteerRepository();
		const volunteer = await repository.upsertVolunteer({
			organizationId: "org-a",
			festivalId: "festival-a",
			firebaseUid: "uid-1",
			accountEmail: "a@example.com",
			name: "Ada",
			phone: "555-0100",
		});
		const shift = await seedShift(repository);

		const booked = await repository.bookShifts({
			organizationId: "org-a",
			volunteerId: volunteer.id,
			shiftIds: [shift.id],
		});
		if (booked.kind !== "booked") throw new Error("Expected a booked outcome.");

		await repository.cancelAssignment({
			organizationId: "org-a",
			assignmentId: booked.assignments[0].id,
			cancelledAtIso: new Date().toISOString(),
		});

		const rebooked = await repository.bookShifts({
			organizationId: "org-a",
			volunteerId: volunteer.id,
			shiftIds: [shift.id],
		});
		expect(rebooked.kind).toBe("booked");
	});
});
