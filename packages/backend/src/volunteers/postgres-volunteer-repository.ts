import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import type {
	BookShiftsOutcome,
	CreateRoleInput,
	CreateShiftInput,
	UpsertVolunteerInput,
	VolunteerAssignmentRecord,
	VolunteerRecord,
	VolunteerRepository,
	VolunteerRoleRecord,
	VolunteerShiftRecord,
} from "./volunteer-repository.js";

function schemaName(value: string) {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))
		throw new Error("Database schema is invalid.");
	return value;
}

export class PostgresVolunteerRepository implements VolunteerRepository {
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady() {
		await initializePostgresSchema(this.schema);
	}

	async upsertVolunteer(input: UpsertVolunteerInput) {
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.volunteers (id, organization_id, festival_id, firebase_uid, account_email, name, phone)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (organization_id, festival_id, firebase_uid)
			 DO UPDATE SET account_email = $5, name = $6, phone = $7
			 RETURNING id, organization_id, festival_id, firebase_uid, account_email, name, phone, created_at::text`,
			[
				randomUUID(),
				input.organizationId,
				input.festivalId,
				input.firebaseUid,
				input.accountEmail,
				input.name,
				input.phone,
			],
		)) as Array<Record<string, unknown>>;
		return this.volunteer(rows[0]);
	}

	async createRole(input: CreateRoleInput) {
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.volunteer_roles (id, organization_id, festival_id, slug, display_name, description, details_url, is_room_proctor)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 RETURNING id, organization_id, festival_id, slug, display_name, description, details_url, is_room_proctor, created_at::text`,
			[
				randomUUID(),
				input.organizationId,
				input.festivalId,
				input.slug,
				input.displayName,
				input.description,
				input.detailsUrl,
				input.isRoomProctor,
			],
		)) as Array<Record<string, unknown>>;
		return this.role(rows[0]);
	}

	async createShift(input: CreateShiftInput) {
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.volunteer_shifts (id, organization_id, festival_id, role_id, date, period, time_text, division, adjudicator)
			 SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
			 WHERE EXISTS (
				SELECT 1 FROM ${this.schema}.volunteer_roles
				WHERE id = $4 AND organization_id = $2 AND festival_id = $3
			 )
			 RETURNING id, organization_id, festival_id, role_id, date::text, period, time_text, division, adjudicator, created_at::text`,
			[
				randomUUID(),
				input.organizationId,
				input.festivalId,
				input.roleId,
				input.date,
				input.period,
				input.timeText,
				input.division,
				input.adjudicator,
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) {
			throw new Error("Volunteer shift role is outside the selected festival.");
		}
		return this.shift(rows[0]);
	}

	async getRole(organizationId: string, festivalId: string, roleId: string) {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, slug, display_name, description, details_url, is_room_proctor, created_at::text
			 FROM ${this.schema}.volunteer_roles WHERE organization_id = $1 AND festival_id = $2 AND id = $3`,
			[organizationId, festivalId, roleId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? this.role(rows[0]) : null;
	}

	async listRoles(organizationId: string, festivalId: string) {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, slug, display_name, description, details_url, is_room_proctor, created_at::text
			 FROM ${this.schema}.volunteer_roles WHERE organization_id = $1 AND festival_id = $2 ORDER BY created_at`,
			[organizationId, festivalId],
		)) as Array<Record<string, unknown>>;
		return rows.map((row) => this.role(row));
	}

	async listShiftsForRole(
		organizationId: string,
		festivalId: string,
		roleId: string,
	) {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, role_id, date::text, period, time_text, division, adjudicator, created_at::text
			 FROM ${this.schema}.volunteer_shifts WHERE organization_id = $1 AND festival_id = $2 AND role_id = $3 ORDER BY date, period`,
			[organizationId, festivalId, roleId],
		)) as Array<Record<string, unknown>>;
		return rows.map((row) => this.shift(row));
	}

	async bookShifts(_input: {
		organizationId: string;
		festivalId: string;
		volunteerId: string;
		shiftIds: string[];
	}): Promise<BookShiftsOutcome> {
		throw new Error(
			"PostgresVolunteerRepository.bookShifts is not implemented yet " +
				"(atomic, concurrency-safe booking is Week 3 scope).",
		);
	}

	async cancelAssignment(input: {
		organizationId: string;
		festivalId: string;
		assignmentId: string;
		cancelledAtIso: string;
	}) {
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.volunteer_assignments assignment
			 SET status = 'cancelled', cancelled_at = $1
			 FROM ${this.schema}.volunteer_shifts shift
			 WHERE assignment.id = $2 AND assignment.organization_id = $3 AND assignment.status = 'active'
				AND shift.id = assignment.shift_id AND shift.festival_id = $4
			 RETURNING assignment.id, assignment.organization_id, assignment.shift_id, assignment.volunteer_id, assignment.status, assignment.created_at::text, assignment.cancelled_at::text`,
			[
				input.cancelledAtIso,
				input.assignmentId,
				input.organizationId,
				input.festivalId,
			],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? this.assignment(rows[0]) : null;
	}

	async listScheduleForOrganization(
		organizationId: string,
		festivalId: string,
	) {
		const rows = (await sql.unsafe(
			`SELECT
				shift.id AS shift_id, shift.organization_id, shift.festival_id, shift.role_id, shift.date::text, shift.period,
				shift.time_text, shift.division, shift.adjudicator, shift.created_at::text AS shift_created_at,
				role.slug, role.display_name, role.description, role.details_url, role.is_room_proctor, role.created_at::text AS role_created_at,
				assignment.id AS assignment_id, assignment.status, assignment.created_at::text AS assignment_created_at,
				assignment.cancelled_at::text,
				volunteer.id AS volunteer_id, volunteer.festival_id AS volunteer_festival_id, volunteer.firebase_uid,
				volunteer.account_email, volunteer.name, volunteer.phone,
				volunteer.created_at::text AS volunteer_created_at
			 FROM ${this.schema}.volunteer_shifts shift
			 JOIN ${this.schema}.volunteer_roles role ON role.id = shift.role_id
			 LEFT JOIN ${this.schema}.volunteer_assignments assignment
				ON assignment.shift_id = shift.id AND assignment.status = 'active'
			 LEFT JOIN ${this.schema}.volunteers volunteer ON volunteer.id = assignment.volunteer_id
				WHERE shift.organization_id = $1 AND shift.festival_id = $2
				ORDER BY shift.date, shift.period`,
			[organizationId, festivalId],
		)) as Array<Record<string, unknown>>;

		return rows.map((row) => ({
			shift: this.shift({
				id: row.shift_id,
				organization_id: row.organization_id,
				festival_id: row.festival_id,
				role_id: row.role_id,
				date: row.date,
				period: row.period,
				time_text: row.time_text,
				division: row.division,
				adjudicator: row.adjudicator,
				created_at: row.shift_created_at,
			}),
			role: this.role({
				id: row.role_id,
				organization_id: row.organization_id,
				festival_id: row.festival_id,
				slug: row.slug,
				display_name: row.display_name,
				description: row.description,
				details_url: row.details_url,
				is_room_proctor: row.is_room_proctor,
				created_at: row.role_created_at,
			}),
			assignment: row.assignment_id
				? this.assignment({
						id: row.assignment_id,
						organization_id: row.organization_id,
						shift_id: row.shift_id,
						volunteer_id: row.volunteer_id,
						status: row.status,
						created_at: row.assignment_created_at,
						cancelled_at: row.cancelled_at,
					})
				: null,
			volunteer: row.volunteer_id
				? this.volunteer({
						id: row.volunteer_id,
						organization_id: row.organization_id,
						festival_id: row.volunteer_festival_id,
						firebase_uid: row.firebase_uid,
						account_email: row.account_email,
						name: row.name,
						phone: row.phone,
						created_at: row.volunteer_created_at,
					})
				: null,
		}));
	}

	private volunteer(row: Record<string, unknown>): VolunteerRecord {
		return {
			id: String(row.id),
			organizationId: String(row.organization_id),
			festivalId: String(row.festival_id),
			firebaseUid: String(row.firebase_uid),
			accountEmail: String(row.account_email),
			name: String(row.name),
			phone: String(row.phone),
			createdAtIso: String(row.created_at),
		};
	}

	private role(row: Record<string, unknown>): VolunteerRoleRecord {
		return {
			id: String(row.id),
			organizationId: String(row.organization_id),
			festivalId: String(row.festival_id),
			slug: String(row.slug),
			displayName: String(row.display_name),
			description: String(row.description),
			detailsUrl: row.details_url === null ? null : String(row.details_url),
			isRoomProctor: row.is_room_proctor === true,
			createdAtIso: String(row.created_at),
		};
	}

	private shift(row: Record<string, unknown>): VolunteerShiftRecord {
		return {
			id: String(row.id),
			organizationId: String(row.organization_id),
			festivalId: String(row.festival_id),
			roleId: String(row.role_id),
			date: String(row.date),
			period: row.period as VolunteerShiftRecord["period"],
			timeText: row.time_text === null ? null : String(row.time_text),
			division: row.division === null ? null : String(row.division),
			adjudicator: row.adjudicator === null ? null : String(row.adjudicator),
			createdAtIso: String(row.created_at),
		};
	}

	private assignment(row: Record<string, unknown>): VolunteerAssignmentRecord {
		return {
			id: String(row.id),
			organizationId: String(row.organization_id),
			shiftId: String(row.shift_id),
			volunteerId: String(row.volunteer_id),
			status: row.status as VolunteerAssignmentRecord["status"],
			createdAtIso: String(row.created_at),
			cancelledAtIso:
				row.cancelled_at === null ? null : String(row.cancelled_at),
		};
	}
}
