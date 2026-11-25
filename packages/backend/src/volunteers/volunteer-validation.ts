import {
	getShiftDateBounds,
	isDateWithinShiftWindow,
	MAX_SHIFT_BATCH_DATES,
} from "@festival/common";
import type {
	ShiftPeriod,
	VolunteerRoleRecord,
} from "./volunteer-repository.js";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface CreateRoleRequest {
	slug: string;
	displayName: string;
	description: string;
	detailsUrl: string | null;
	isRoomProctor: boolean;
}

export interface UpdateRoleRequest {
	displayName: string;
	description: string;
	detailsUrl: string | null;
	isRoomProctor: boolean;
}

export interface CreateShiftRequest {
	date: string;
	period: ShiftPeriod;
	timeText: string | null;
	division: string | null;
	adjudicator: string | null;
}

export interface CreateShiftsBatchRequest {
	dates: string[];
	period: ShiftPeriod;
	timeText: string | null;
	division: string | null;
	adjudicator: string | null;
}

export interface FestivalDateWindow {
	startDate: string;
	endDate: string;
}

export interface EnrollVolunteerRequest {
	name: string;
	phone: string;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function validateCreateRoleRequest(
	payload: unknown,
): { request: CreateRoleRequest } | { errors: string[] } {
	const body = (payload ?? {}) as Record<string, unknown>;
	const errors: string[] = [];

	const slug = asString(body.slug).toLowerCase();
	if (slug.length === 0) {
		errors.push("Role slug is required.");
	} else if (slug.length > 64) {
		errors.push("Role slug must be 64 characters or less.");
	} else if (!SLUG_PATTERN.test(slug)) {
		errors.push(
			"Role slug may only contain lowercase letters, numbers, and hyphens, and may not start, end, or repeat a hyphen.",
		);
	}

	const displayName = asString(body.displayName);
	if (displayName.length === 0) {
		errors.push("Role display name is required.");
	} else if (displayName.length > 100) {
		errors.push("Role display name must be 100 characters or less.");
	}

	const description = asString(body.description);
	if (description.length === 0) {
		errors.push("Role description is required.");
	}

	const detailsUrlRaw = asString(body.detailsUrl);
	const detailsUrl = detailsUrlRaw.length === 0 ? null : detailsUrlRaw;
	if (detailsUrl !== null && !/^https?:\/\//.test(detailsUrl)) {
		errors.push("Role details link must be an http(s) URL.");
	}

	const isRoomProctor = body.isRoomProctor === true;

	if (errors.length > 0) return { errors };
	return {
		request: { slug, displayName, description, detailsUrl, isRoomProctor },
	};
}

export function validateUpdateRoleRequest(
	payload: unknown,
): { request: UpdateRoleRequest } | { errors: string[] } {
	const body = (payload ?? {}) as Record<string, unknown>;
	const errors: string[] = [];

	const displayName = asString(body.displayName);
	if (displayName.length === 0) {
		errors.push("Role display name is required.");
	} else if (displayName.length > 100) {
		errors.push("Role display name must be 100 characters or less.");
	}

	const description = asString(body.description);
	if (description.length === 0) {
		errors.push("Role description is required.");
	}

	const detailsUrlRaw = asString(body.detailsUrl);
	const detailsUrl = detailsUrlRaw.length === 0 ? null : detailsUrlRaw;
	if (detailsUrl !== null && !/^https?:\/\//.test(detailsUrl)) {
		errors.push("Role details link must be an http(s) URL.");
	}

	const isRoomProctor = body.isRoomProctor === true;

	if (errors.length > 0) return { errors };
	return {
		request: { displayName, description, detailsUrl, isRoomProctor },
	};
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateShiftDateWithinFestivalWindow(
	date: string,
	festival: FestivalDateWindow,
): string | null {
	const bounds = getShiftDateBounds(festival.startDate, festival.endDate);
	if (!bounds) return null;
	if (!isDateWithinShiftWindow(date, festival.startDate, festival.endDate)) {
		return `Shift date ${date} must be within ${bounds.minDate} to ${bounds.maxDate} for this festival.`;
	}
	return null;
}

function parseShiftCommonFields(
	body: Record<string, unknown>,
	role: VolunteerRoleRecord,
	errors: string[],
) {
	const period = asString(body.period).toUpperCase();
	if (period !== "AM" && period !== "PM") {
		errors.push("Shift period is required and must be AM or PM.");
	}

	const timeTextRaw = asString(body.timeText);
	const timeText = timeTextRaw.length === 0 ? null : timeTextRaw;

	const divisionRaw = asString(body.division);
	const adjudicatorRaw = asString(body.adjudicator);
	const division = divisionRaw.length === 0 ? null : divisionRaw;
	const adjudicator = adjudicatorRaw.length === 0 ? null : adjudicatorRaw;

	if (role.isRoomProctor) {
		if (!division) errors.push("Room Proctor shifts require a division.");
		if (!adjudicator)
			errors.push("Room Proctor shifts require an adjudicator.");
	} else if (division || adjudicator) {
		errors.push("Only Room Proctor shifts may have a division or adjudicator.");
	}

	return { period: period as ShiftPeriod, timeText, division, adjudicator };
}

export function validateCreateShiftRequest(
	payload: unknown,
	role: VolunteerRoleRecord,
): { request: CreateShiftRequest } | { errors: string[] } {
	const body = (payload ?? {}) as Record<string, unknown>;
	const errors: string[] = [];

	const date = asString(body.date);
	if (!DATE_PATTERN.test(date)) {
		errors.push("Shift date is required and must use YYYY-MM-DD format.");
	}

	const common = parseShiftCommonFields(body, role, errors);
	if (errors.length > 0) return { errors };
	return { request: { date, ...common } };
}

export function validateCreateShiftsBatchRequest(
	payload: unknown,
	role: VolunteerRoleRecord,
	festival?: FestivalDateWindow,
): { request: CreateShiftsBatchRequest } | { errors: string[] } {
	const body = (payload ?? {}) as Record<string, unknown>;
	const errors: string[] = [];
	const dates: string[] = [];

	if (!Array.isArray(body.dates) || body.dates.length === 0) {
		errors.push("Select at least one shift date.");
	} else if (body.dates.length > MAX_SHIFT_BATCH_DATES) {
		errors.push(
			`At most ${MAX_SHIFT_BATCH_DATES} shift dates may be created at once.`,
		);
	} else {
		const seen = new Set<string>();
		for (const rawDate of body.dates) {
			const date = asString(rawDate);
			if (!DATE_PATTERN.test(date)) {
				errors.push("Each shift date must use YYYY-MM-DD format.");
				break;
			}
			if (seen.has(date)) {
				errors.push(`Duplicate date in request: ${date}.`);
				break;
			}
			seen.add(date);
			if (festival) {
				const windowError = validateShiftDateWithinFestivalWindow(
					date,
					festival,
				);
				if (windowError) {
					errors.push(windowError);
					break;
				}
			}
			dates.push(date);
		}
	}

	const common = parseShiftCommonFields(body, role, errors);
	if (errors.length > 0) return { errors };
	return { request: { dates, ...common } };
}

export const validateUpdateShiftRequest = validateCreateShiftRequest;

export function validateEnrollVolunteerRequest(
	payload: unknown,
): { request: EnrollVolunteerRequest } | { errors: string[] } {
	const body = (payload ?? {}) as Record<string, unknown>;
	const errors: string[] = [];

	const name = asString(body.name);
	if (name.length === 0) {
		errors.push("Name is required.");
	} else if (name.length > 200) {
		errors.push("Name must be 200 characters or less.");
	}

	const phone = asString(body.phone);
	if (phone.length === 0) {
		errors.push("Phone is required.");
	} else if (phone.length > 40) {
		errors.push("Phone must be 40 characters or less.");
	}

	if (errors.length > 0) return { errors };
	return { request: { name, phone } };
}

export interface BookShiftsRequest {
	shiftIds: string[];
}

export function validateBookShiftsRequest(
	payload: unknown,
): { request: BookShiftsRequest } | { errors: string[] } {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { errors: ["Request body must be an object."] };
	}
	const body = payload as Record<string, unknown>;
	const errors: string[] = [];

	if (!Array.isArray(body.shiftIds) || body.shiftIds.length === 0) {
		errors.push("shiftIds must be a non-empty array of shift IDs.");
	} else {
		for (const id of body.shiftIds) {
			if (typeof id !== "string" || id.trim().length === 0) {
				errors.push("Each shift ID must be a non-empty string.");
				break;
			}
		}
	}

	if (errors.length > 0) return { errors };
	return {
		request: {
			shiftIds: (body.shiftIds as string[]).map((id) => id.trim()),
		},
	};
}
