import { randomUUID } from "node:crypto";

export type ShiftPeriod = "AM" | "PM";
export type VolunteerAssignmentStatus = "active" | "cancelled";

export interface VolunteerRecord {
	id: string;
	organizationId: string;
	festivalId: string;
	firebaseUid: string;
	accountEmail: string;
	name: string;
	phone: string;
	createdAtIso: string;
}

export interface VolunteerRoleRecord {
	id: string;
	organizationId: string;
	festivalId: string;
	slug: string;
	displayName: string;
	description: string;
	detailsUrl: string | null;
	isRoomProctor: boolean;
	createdAtIso: string;
}

export interface VolunteerShiftRecord {
	id: string;
	organizationId: string;
	festivalId: string;
	roleId: string;
	date: string;
	period: ShiftPeriod;
	timeText: string | null;
	division: string | null;
	adjudicator: string | null;
	createdAtIso: string;
}

export interface VolunteerAssignmentRecord {
	id: string;
	organizationId: string;
	shiftId: string;
	volunteerId: string;
	status: VolunteerAssignmentStatus;
	createdAtIso: string;
	cancelledAtIso: string | null;
}

export type BookShiftsOutcome =
	| { kind: "booked"; assignments: VolunteerAssignmentRecord[] }
	| { kind: "conflict"; shiftIds: string[] };

export interface UpsertVolunteerInput {
	organizationId: string;
	festivalId: string;
	firebaseUid: string;
	accountEmail: string;
	name: string;
	phone: string;
}

export interface CreateRoleInput {
	organizationId: string;
	festivalId: string;
	slug: string;
	displayName: string;
	description: string;
	detailsUrl: string | null;
	isRoomProctor: boolean;
}

export interface CreateShiftInput {
	organizationId: string;
	festivalId: string;
	roleId: string;
	date: string;
	period: ShiftPeriod;
	timeText: string | null;
	division: string | null;
	adjudicator: string | null;
}

export interface VolunteerRepository {
	upsertVolunteer(input: UpsertVolunteerInput): Promise<VolunteerRecord>;

	createRole(input: CreateRoleInput): Promise<VolunteerRoleRecord>;
	createShift(input: CreateShiftInput): Promise<VolunteerShiftRecord>;

	getRole(
		organizationId: string,
		festivalId: string,
		roleId: string,
	): Promise<VolunteerRoleRecord | null>;
	listRoles(
		organizationId: string,
		festivalId: string,
	): Promise<VolunteerRoleRecord[]>;
	listShiftsForRole(
		organizationId: string,
		festivalId: string,
		roleId: string,
	): Promise<VolunteerShiftRecord[]>;

	bookShifts(input: {
		organizationId: string;
		festivalId: string;
		volunteerId: string;
		shiftIds: string[];
	}): Promise<BookShiftsOutcome>;

	cancelAssignment(input: {
		organizationId: string;
		festivalId: string;
		assignmentId: string;
		cancelledAtIso: string;
	}): Promise<VolunteerAssignmentRecord | null>;

	listScheduleForOrganization(
		organizationId: string,
		festivalId: string,
	): Promise<
		Array<{
			shift: VolunteerShiftRecord;
			role: VolunteerRoleRecord;
			assignment: VolunteerAssignmentRecord | null;
			volunteer: VolunteerRecord | null;
		}>
	>;
}

export class InMemoryVolunteerRepository implements VolunteerRepository {
	private readonly volunteers = new Map<string, VolunteerRecord>();
	private readonly roles = new Map<string, VolunteerRoleRecord>();
	private readonly shifts = new Map<string, VolunteerShiftRecord>();
	private readonly assignments = new Map<string, VolunteerAssignmentRecord>();

	async upsertVolunteer(input: UpsertVolunteerInput) {
		const existing = [...this.volunteers.values()].find(
			(volunteer) =>
				volunteer.organizationId === input.organizationId &&
				volunteer.festivalId === input.festivalId &&
				volunteer.firebaseUid === input.firebaseUid,
		);
		if (existing) {
			existing.accountEmail = input.accountEmail;
			existing.name = input.name;
			existing.phone = input.phone;
			return { ...existing };
		}
		const record: VolunteerRecord = {
			...input,
			id: randomUUID(),
			createdAtIso: new Date().toISOString(),
		};
		this.volunteers.set(record.id, record);
		return { ...record };
	}

	async createRole(input: CreateRoleInput) {
		const record: VolunteerRoleRecord = {
			...input,
			id: randomUUID(),
			createdAtIso: new Date().toISOString(),
		};
		this.roles.set(record.id, record);
		return { ...record };
	}

	async createShift(input: CreateShiftInput) {
		const role = this.roles.get(input.roleId);
		if (
			!role ||
			role.organizationId !== input.organizationId ||
			role.festivalId !== input.festivalId
		) {
			throw new Error("Volunteer shift role is outside the selected festival.");
		}
		const record: VolunteerShiftRecord = {
			...input,
			id: randomUUID(),
			createdAtIso: new Date().toISOString(),
		};
		this.shifts.set(record.id, record);
		return { ...record };
	}

	async getRole(organizationId: string, festivalId: string, roleId: string) {
		const role = this.roles.get(roleId);
		if (
			!role ||
			role.organizationId !== organizationId ||
			role.festivalId !== festivalId
		)
			return null;
		return { ...role };
	}

	async listRoles(organizationId: string, festivalId: string) {
		return [...this.roles.values()]
			.filter(
				(role) =>
					role.organizationId === organizationId &&
					role.festivalId === festivalId,
			)
			.map((role) => ({ ...role }));
	}

	async listShiftsForRole(
		organizationId: string,
		festivalId: string,
		roleId: string,
	) {
		return [...this.shifts.values()]
			.filter(
				(shift) =>
					shift.organizationId === organizationId &&
					shift.festivalId === festivalId &&
					shift.roleId === roleId,
			)
			.map((shift) => ({ ...shift }));
	}

	async bookShifts(input: {
		organizationId: string;
		festivalId: string;
		volunteerId: string;
		shiftIds: string[];
	}): Promise<BookShiftsOutcome> {
		const { organizationId, festivalId, volunteerId, shiftIds } = input;
		const volunteer = this.volunteers.get(volunteerId);
		if (
			!volunteer ||
			volunteer.organizationId !== organizationId ||
			volunteer.festivalId !== festivalId
		) {
			return { kind: "conflict", shiftIds };
		}

		const shifts = shiftIds.map((id) => this.shifts.get(id));
		const missingIds = shiftIds.filter(
			(_, index) =>
				!shifts[index] ||
				shifts[index]?.organizationId !== organizationId ||
				shifts[index]?.festivalId !== festivalId,
		);
		if (missingIds.length > 0)
			return { kind: "conflict", shiftIds: missingIds };
		const requestedShifts = shifts as VolunteerShiftRecord[];

		const takenIds = shiftIds.filter((id) =>
			[...this.assignments.values()].some(
				(assignment) =>
					assignment.shiftId === id && assignment.status === "active",
			),
		);

		const existingPeriods = new Set(
			[...this.assignments.values()]
				.filter(
					(assignment) =>
						assignment.status === "active" &&
						assignment.volunteerId === volunteerId,
				)
				.map((assignment) => this.shifts.get(assignment.shiftId))
				.filter((shift): shift is VolunteerShiftRecord => Boolean(shift))
				.filter((shift) => shift.festivalId === festivalId)
				.map((shift) => `${shift.date}:${shift.period}`),
		);

		const seenInBatch = new Set<string>();
		const periodConflictIds: string[] = [];
		for (const shift of requestedShifts) {
			const key = `${shift.date}:${shift.period}`;
			if (existingPeriods.has(key) || seenInBatch.has(key)) {
				periodConflictIds.push(shift.id);
			}
			seenInBatch.add(key);
		}

		const conflictIds = [...new Set([...takenIds, ...periodConflictIds])];
		if (conflictIds.length > 0)
			return { kind: "conflict", shiftIds: conflictIds };

		const nowIso = new Date().toISOString();
		const assignments = shiftIds.map((shiftId) => {
			const assignment: VolunteerAssignmentRecord = {
				id: randomUUID(),
				organizationId,
				shiftId,
				volunteerId,
				status: "active",
				createdAtIso: nowIso,
				cancelledAtIso: null,
			};
			this.assignments.set(assignment.id, assignment);
			return { ...assignment };
		});

		return { kind: "booked", assignments };
	}

	async cancelAssignment(input: {
		organizationId: string;
		festivalId: string;
		assignmentId: string;
		cancelledAtIso: string;
	}) {
		const assignment = this.assignments.get(input.assignmentId);
		if (
			!assignment ||
			assignment.organizationId !== input.organizationId ||
			this.shifts.get(assignment.shiftId)?.festivalId !== input.festivalId ||
			assignment.status !== "active"
		)
			return null;
		assignment.status = "cancelled";
		assignment.cancelledAtIso = input.cancelledAtIso;
		return { ...assignment };
	}

	async listScheduleForOrganization(
		organizationId: string,
		festivalId: string,
	) {
		const activeByShiftId = new Map<string, VolunteerAssignmentRecord>();
		for (const assignment of this.assignments.values()) {
			if (
				assignment.organizationId === organizationId &&
				assignment.status === "active"
			) {
				activeByShiftId.set(assignment.shiftId, assignment);
			}
		}

		return [...this.shifts.values()]
			.filter(
				(shift) =>
					shift.organizationId === organizationId &&
					shift.festivalId === festivalId,
			)
			.map((shift) => {
				const role = this.roles.get(shift.roleId);
				if (!role) {
					throw new Error(
						`Shift ${shift.id} references missing role ${shift.roleId}.`,
					);
				}
				const assignment = activeByShiftId.get(shift.id) ?? null;
				const volunteer = assignment
					? (this.volunteers.get(assignment.volunteerId) ?? null)
					: null;
				return {
					shift: { ...shift },
					role: { ...role },
					assignment: assignment ? { ...assignment } : null,
					volunteer: volunteer ? { ...volunteer } : null,
				};
			});
	}
}
