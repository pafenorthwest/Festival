export const SHIFT_PERIODS = ["AM", "PM"] as const;
export type ShiftPeriod = (typeof SHIFT_PERIODS)[number];

export const VOLUNTEER_ASSIGNMENT_STATUSES = ["active", "cancelled"] as const;
export type VolunteerAssignmentStatus =
	(typeof VOLUNTEER_ASSIGNMENT_STATUSES)[number];

export const BOOK_SHIFT_ITEM_STATUSES = [
	"booked",
	"conflict",
	"unavailable",
] as const;
export type BookShiftItemStatus = (typeof BOOK_SHIFT_ITEM_STATUSES)[number];

export interface VolunteerRole {
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

export interface VolunteerShift {
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

export interface VolunteerAssignment {
	id: string;
	organizationId: string;
	festivalId?: string;
	shiftId: string;
	volunteerId: string;
	status: VolunteerAssignmentStatus;
	createdAtIso: string;
	cancelledAtIso: string | null;
}

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

export interface CreateVolunteerRoleInput {
	slug: string;
	displayName: string;
	description: string;
	detailsUrl?: string | null;
	isRoomProctor: boolean;
	organizationId?: string;
	festivalId?: string;
}

export type CreateRoleInput = CreateVolunteerRoleInput;

export interface UpdateVolunteerRoleInput {
	displayName: string;
	description: string;
	detailsUrl?: string | null;
	isRoomProctor: boolean;
}

export interface CreateVolunteerShiftInput {
	date: string;
	period: ShiftPeriod;
	timeText?: string | null;
	division?: string | null;
	adjudicator?: string | null;
	organizationId?: string;
	festivalId?: string;
	roleId?: string;
}

export interface UpdateVolunteerShiftInput {
	date: string;
	period: ShiftPeriod;
	timeText?: string | null;
	division?: string | null;
	adjudicator?: string | null;
}

export type CreateShiftInput = CreateVolunteerShiftInput;

export interface BookShiftsInput {
	shiftIds: string[];
	volunteerId?: string;
	organizationId?: string;
	festivalId?: string;
	name?: string;
	phone?: string;
	email?: string;
}

export interface BookShiftInput {
	shiftId: string;
	volunteerId?: string;
	organizationId?: string;
	festivalId?: string;
}

export interface CancelShiftAssignmentInput {
	assignmentId: string;
	reason?: string | null;
}

export type CancelAssignmentInput = CancelShiftAssignmentInput;
export type CancelShiftInput = CancelShiftAssignmentInput;

export interface EnrollVolunteerInput {
	name: string;
	phone: string;
	email?: string;
	organizationId?: string;
	festivalId?: string;
	firebaseUid?: string;
}

export interface BookShiftItemOutcome {
	shiftId: string;
	status: BookShiftItemStatus;
	kind?: BookShiftItemStatus;
	assignment?: VolunteerAssignment | null;
	message?: string | null;
}

export type BookShiftsOutcome =
	| {
			kind: "booked";
			assignments: VolunteerAssignment[];
			items?: BookShiftItemOutcome[];
	  }
	| {
			kind: "conflict";
			shiftIds: string[];
			items?: BookShiftItemOutcome[];
			message?: string;
	  };

export interface CoverageGapShift {
	shiftId: string;
	id?: string;
	roleId: string;
	roleDisplayName: string;
	roleName?: string;
	roleSlug?: string;
	date: string;
	period: ShiftPeriod;
	timeText: string | null;
	division: string | null;
	adjudicator: string | null;
	isRoomProctor: boolean;
}

export const SHIFT_COVERAGE_STATUSES = ["Open", "Filled"] as const;
export type ShiftCoverageStatus = (typeof SHIFT_COVERAGE_STATUSES)[number];

/**
 * One volunteer slot (shift) with a server-computed Open/Filled status.
 * Unlike CoverageGapShift (which only lists unfilled slots), this covers
 * every slot in the festival, so it's the source for a full, filterable
 * slot list rather than just a gaps report.
 */
export interface ShiftCoverageEntry {
	shiftId: string;
	roleId: string;
	roleDisplayName: string;
	date: string;
	period: ShiftPeriod;
	timeText: string | null;
	division: string | null;
	adjudicator: string | null;
	isRoomProctor: boolean;
	status: ShiftCoverageStatus;
}

export interface CoverageGapsSummary {
	totalShifts: number;
	coveredShifts: number;
	filledShifts?: number;
	unfilledShifts: number;
	totalGaps?: number;
	coveragePercentage: number;
	gaps: CoverageGapShift[];
	gapsByDate?: Record<string, CoverageGapShift[]>;
	gapsByRole?: Record<string, CoverageGapShift[]>;
	/** Every slot in the festival, each with a computed Open/Filled status. */
	slots: ShiftCoverageEntry[];
}

export interface VolunteerValidationResult<T> {
	valid: boolean;
	errors: string[];
	data?: T;
	request?: T;
}

const ROLE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateCreateVolunteerRoleInput(
	payload: unknown,
): VolunteerValidationResult<CreateVolunteerRoleInput> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { valid: false, errors: ["Role input must be an object."] };
	}
	const body = payload as Record<string, unknown>;
	const errors: string[] = [];

	const slug =
		typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
	if (slug.length === 0) {
		errors.push("Role slug is required.");
	} else if (slug.length > 64) {
		errors.push("Role slug must be 64 characters or less.");
	} else if (!ROLE_SLUG_PATTERN.test(slug)) {
		errors.push(
			"Role slug may only contain lowercase letters, numbers, and hyphens, and may not start, end, or repeat a hyphen.",
		);
	}

	const displayName =
		typeof body.displayName === "string" ? body.displayName.trim() : "";
	if (displayName.length === 0) {
		errors.push("Role display name is required.");
	} else if (displayName.length > 100) {
		errors.push("Role display name must be 100 characters or less.");
	}

	const description =
		typeof body.description === "string" ? body.description.trim() : "";
	if (description.length === 0) {
		errors.push("Role description is required.");
	}

	const detailsUrlRaw =
		typeof body.detailsUrl === "string" ? body.detailsUrl.trim() : "";
	const detailsUrl = detailsUrlRaw.length === 0 ? null : detailsUrlRaw;
	if (detailsUrl !== null && !/^https?:\/\//.test(detailsUrl)) {
		errors.push("Role details link must be an http(s) URL.");
	}

	const isRoomProctor = body.isRoomProctor === true;
	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: CreateVolunteerRoleInput = {
		slug,
		displayName,
		description,
		detailsUrl,
		isRoomProctor,
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateUpdateVolunteerRoleInput(
	payload: unknown,
): VolunteerValidationResult<UpdateVolunteerRoleInput> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { valid: false, errors: ["Role input must be an object."] };
	}
	const body = payload as Record<string, unknown>;
	const errors: string[] = [];

	const displayName =
		typeof body.displayName === "string" ? body.displayName.trim() : "";
	if (displayName.length === 0) {
		errors.push("Role display name is required.");
	} else if (displayName.length > 100) {
		errors.push("Role display name must be 100 characters or less.");
	}

	const description =
		typeof body.description === "string" ? body.description.trim() : "";
	if (description.length === 0) {
		errors.push("Role description is required.");
	}

	const detailsUrlRaw =
		typeof body.detailsUrl === "string" ? body.detailsUrl.trim() : "";
	const detailsUrl = detailsUrlRaw.length === 0 ? null : detailsUrlRaw;
	if (detailsUrl !== null && !/^https?:\/\//.test(detailsUrl)) {
		errors.push("Role details link must be an http(s) URL.");
	}

	const isRoomProctor = body.isRoomProctor === true;
	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: UpdateVolunteerRoleInput = {
		displayName,
		description,
		detailsUrl,
		isRoomProctor,
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateCreateVolunteerShiftInput(
	payload: unknown,
	roleOrIsRoomProctor?: { isRoomProctor: boolean } | boolean,
): VolunteerValidationResult<CreateVolunteerShiftInput> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { valid: false, errors: ["Shift input must be an object."] };
	}
	const body = payload as Record<string, unknown>;
	const errors: string[] = [];

	const date = typeof body.date === "string" ? body.date.trim() : "";
	if (!DATE_PATTERN.test(date)) {
		errors.push("Shift date is required and must use YYYY-MM-DD format.");
	}

	const periodRaw =
		typeof body.period === "string" ? body.period.trim().toUpperCase() : "";
	if (periodRaw !== "AM" && periodRaw !== "PM") {
		errors.push("Shift period is required and must be AM or PM.");
	}

	const timeTextRaw =
		typeof body.timeText === "string" ? body.timeText.trim() : "";
	const timeText = timeTextRaw.length === 0 ? null : timeTextRaw;

	const divisionRaw =
		typeof body.division === "string" ? body.division.trim() : "";
	const division = divisionRaw.length === 0 ? null : divisionRaw;

	const adjudicatorRaw =
		typeof body.adjudicator === "string" ? body.adjudicator.trim() : "";
	const adjudicator = adjudicatorRaw.length === 0 ? null : adjudicatorRaw;

	const isRoomProctor =
		typeof roleOrIsRoomProctor === "boolean"
			? roleOrIsRoomProctor
			: (roleOrIsRoomProctor?.isRoomProctor ?? false);

	if (isRoomProctor) {
		if (!division) errors.push("Room Proctor shifts require a division.");
		if (!adjudicator) {
			errors.push("Room Proctor shifts require an adjudicator.");
		}
	} else if (division || adjudicator) {
		errors.push("Only Room Proctor shifts may have a division or adjudicator.");
	}

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: CreateVolunteerShiftInput = {
		date,
		period: periodRaw as ShiftPeriod,
		timeText,
		division,
		adjudicator,
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateUpdateVolunteerShiftInput(
	payload: unknown,
	roleOrIsRoomProctor?: { isRoomProctor: boolean } | boolean,
): VolunteerValidationResult<UpdateVolunteerShiftInput> {
	const result = validateCreateVolunteerShiftInput(
		payload,
		roleOrIsRoomProctor,
	);
	if (!result.valid || !result.data) {
		return { valid: false, errors: result.errors };
	}
	const data: UpdateVolunteerShiftInput = {
		date: result.data.date,
		period: result.data.period,
		timeText: result.data.timeText,
		division: result.data.division,
		adjudicator: result.data.adjudicator,
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateBookShiftsInput(
	payload: unknown,
): VolunteerValidationResult<BookShiftsInput> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { valid: false, errors: ["Shift booking input must be an object."] };
	}
	const body = payload as Record<string, unknown>;
	const errors: string[] = [];

	if (!Array.isArray(body.shiftIds) || body.shiftIds.length === 0) {
		errors.push("At least one shift must be selected.");
	} else if (body.shiftIds.some((id) => typeof id !== "string" || !id.trim())) {
		errors.push("All shift IDs must be non-empty strings.");
	}

	const rawShiftIds = Array.isArray(body.shiftIds)
		? body.shiftIds.map((s) => (typeof s === "string" ? s.trim() : ""))
		: [];
	if (new Set(rawShiftIds).size !== rawShiftIds.length) {
		errors.push("Duplicate shifts cannot be selected.");
	}

	const name = typeof body.name === "string" ? body.name.trim() : undefined;
	if (name !== undefined && name.length === 0) {
		errors.push("Volunteer name cannot be empty.");
	}

	const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;
	if (phone !== undefined && phone.length === 0) {
		errors.push("Volunteer phone cannot be empty.");
	}

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: BookShiftsInput = {
		shiftIds: rawShiftIds,
		...(typeof body.volunteerId === "string"
			? { volunteerId: body.volunteerId }
			: {}),
		...(name ? { name } : {}),
		...(phone ? { phone } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateCancelShiftAssignmentInput(
	payload: unknown,
): VolunteerValidationResult<CancelShiftAssignmentInput> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return {
			valid: false,
			errors: ["Shift cancellation input must be an object."],
		};
	}
	const body = payload as Record<string, unknown>;
	const errors: string[] = [];

	const assignmentId =
		typeof body.assignmentId === "string" ? body.assignmentId.trim() : "";
	if (assignmentId.length === 0) {
		errors.push("Assignment ID is required for shift cancellation.");
	}

	const reason =
		typeof body.reason === "string" ? body.reason.trim() : undefined;

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: CancelShiftAssignmentInput = {
		assignmentId,
		...(reason ? { reason } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateEnrollVolunteerInput(
	payload: unknown,
): VolunteerValidationResult<EnrollVolunteerInput> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return {
			valid: false,
			errors: ["Volunteer enrollment input must be an object."],
		};
	}
	const body = payload as Record<string, unknown>;
	const errors: string[] = [];

	const name = typeof body.name === "string" ? body.name.trim() : "";
	if (name.length === 0) {
		errors.push("Name is required.");
	} else if (name.length > 200) {
		errors.push("Name must be 200 characters or less.");
	}

	const phone = typeof body.phone === "string" ? body.phone.trim() : "";
	if (phone.length === 0) {
		errors.push("Phone is required.");
	} else if (phone.length > 40) {
		errors.push("Phone must be 40 characters or less.");
	}

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: EnrollVolunteerInput = { name, phone };
	return { valid: true, errors: [], data, request: data };
}

export function calculateCoverageGaps(
	shifts: readonly VolunteerShift[],
	roles: readonly VolunteerRole[],
	assignments: readonly VolunteerAssignment[],
): CoverageGapsSummary {
	const roleMap = new Map<string, VolunteerRole>(
		roles.map((role) => [role.id, role]),
	);
	const activeAssignmentShiftIds = new Set<string>(
		assignments
			.filter((assignment) => assignment.status === "active")
			.map((assignment) => assignment.shiftId),
	);

	const gaps: CoverageGapShift[] = [];
	const gapsByDate: Record<string, CoverageGapShift[]> = {};
	const gapsByRole: Record<string, CoverageGapShift[]> = {};
	const slots: ShiftCoverageEntry[] = [];

	for (const shift of shifts) {
		const role = roleMap.get(shift.roleId);
		const isFilled = activeAssignmentShiftIds.has(shift.id);

		slots.push({
			shiftId: shift.id,
			roleId: shift.roleId,
			roleDisplayName: role?.displayName ?? "Unknown Role",
			date: shift.date,
			period: shift.period,
			timeText: shift.timeText,
			division: shift.division,
			adjudicator: shift.adjudicator,
			isRoomProctor: role?.isRoomProctor ?? false,
			status: isFilled ? "Filled" : "Open",
		});

		if (isFilled) {
			continue;
		}
		const gap: CoverageGapShift = {
			shiftId: shift.id,
			id: shift.id,
			roleId: shift.roleId,
			roleDisplayName: role?.displayName ?? "Unknown Role",
			roleName: role?.displayName ?? "Unknown Role",
			roleSlug: role?.slug,
			date: shift.date,
			period: shift.period,
			timeText: shift.timeText,
			division: shift.division,
			adjudicator: shift.adjudicator,
			isRoomProctor: role?.isRoomProctor ?? false,
		};
		gaps.push(gap);

		if (!gapsByDate[gap.date]) gapsByDate[gap.date] = [];
		gapsByDate[gap.date].push(gap);

		if (!gapsByRole[gap.roleId]) gapsByRole[gap.roleId] = [];
		gapsByRole[gap.roleId].push(gap);
	}

	const totalShifts = shifts.length;
	const unfilledShifts = gaps.length;
	const coveredShifts = totalShifts - unfilledShifts;
	const coveragePercentage =
		totalShifts === 0
			? 100
			: Math.round((coveredShifts / totalShifts) * 10000) / 100;

	return {
		totalShifts,
		coveredShifts,
		filledShifts: coveredShifts,
		unfilledShifts,
		totalGaps: unfilledShifts,
		coveragePercentage,
		gaps,
		gapsByDate,
		gapsByRole,
		slots,
	};
}

export function validateShiftBookingConflicts(
	selectedShifts: readonly VolunteerShift[],
	existingVolunteerShifts: readonly VolunteerShift[],
	activeAssignments: readonly VolunteerAssignment[],
): { valid: boolean; conflictShiftIds: string[]; errors: string[] } {
	const errors: string[] = [];
	const conflictShiftIds = new Set<string>();

	const activeShiftIdSet = new Set(
		activeAssignments
			.filter((a) => a.status === "active")
			.map((a) => a.shiftId),
	);

	for (const shift of selectedShifts) {
		if (activeShiftIdSet.has(shift.id)) {
			conflictShiftIds.add(shift.id);
			errors.push(
				`Shift on ${shift.date} (${shift.period}) is already filled.`,
			);
		}
	}

	const seenPeriods = new Set<string>();
	for (const shift of selectedShifts) {
		const key = `${shift.date}:${shift.period}`;
		if (seenPeriods.has(key)) {
			conflictShiftIds.add(shift.id);
			errors.push(
				`Multiple shifts selected for ${shift.date} (${shift.period}).`,
			);
		}
		seenPeriods.add(key);
	}

	for (const shift of selectedShifts) {
		const hasConflict = existingVolunteerShifts.some(
			(existing) =>
				existing.date === shift.date &&
				existing.period === shift.period &&
				existing.id !== shift.id,
		);
		if (hasConflict) {
			conflictShiftIds.add(shift.id);
			errors.push(
				`Volunteer already has an assignment on ${shift.date} (${shift.period}).`,
			);
		}
	}

	return {
		valid: conflictShiftIds.size === 0,
		conflictShiftIds: [...conflictShiftIds],
		errors,
	};
}
