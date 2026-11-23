import {
	getShiftDateBounds,
	isDateWithinShiftWindow,
	MAX_SHIFT_BATCH_DATES,
	type ShiftPeriod,
} from "@festival/common";
import type {
	CreateVolunteerShiftInput,
	CreateVolunteerShiftsBatchInput,
	VolunteerShift,
} from "../../lib/api.js";

export { getShiftDateBounds, isDateWithinShiftWindow, MAX_SHIFT_BATCH_DATES };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_ABBREVIATIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** A festival is days long; this only stops a bad date range from listing years. */
const MAX_FESTIVAL_DAYS = MAX_SHIFT_BATCH_DATES;
export const MAX_EXTRA_SHIFT_DATES = 31;

export type ShiftDraftFields = Pick<
	CreateVolunteerShiftInput,
	"period" | "timeText" | "division" | "adjudicator"
>;

export interface ShiftDateBounds {
	minDate: string;
	maxDate: string;
}

function toUtcMs(date: string): number | null {
	if (!DATE_PATTERN.test(date)) return null;
	const [year, month, day] = date.split("-").map(Number);
	const ms = Date.UTC(year, month - 1, day);
	return Number.isNaN(ms) ? null : ms;
}

export function isValidShiftDate(date: string): boolean {
	const ms = toUtcMs(date);
	return ms !== null && new Date(ms).toISOString().slice(0, 10) === date;
}

/**
 * Formats YYYY-MM-DD as "Mon 11/10" when in the same single-year festival,
 * or "Mon 11/10/2026" when the date's year differs or the festival spans years.
 */
export function formatShiftDateLabel(
	date: string,
	festivalStartDate?: string,
	festivalEndDate?: string,
): string {
	const ms = toUtcMs(date);
	if (ms === null || !isValidShiftDate(date)) return date;
	const utcDate = new Date(ms);
	const year = utcDate.getUTCFullYear();
	const month = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
	const day = String(utcDate.getUTCDate()).padStart(2, "0");
	const weekday = WEEKDAY_ABBREVIATIONS[utcDate.getUTCDay()];

	const startYear =
		festivalStartDate && isValidShiftDate(festivalStartDate)
			? Number(festivalStartDate.slice(0, 4))
			: null;
	const endYear =
		festivalEndDate && isValidShiftDate(festivalEndDate)
			? Number(festivalEndDate.slice(0, 4))
			: null;
	const spansYears =
		startYear !== null && endYear !== null && startYear !== endYear;
	const differsFromFestival =
		(startYear !== null && year !== startYear) ||
		(endYear !== null && year !== endYear);

	return spansYears || differsFromFestival
		? `${weekday} ${month}/${day}/${year}`
		: `${weekday} ${month}/${day}`;
}

/** Every day from start to end inclusive, as YYYY-MM-DD. Empty when either date is unusable. */
export function listFestivalDays(
	startDate: string | undefined,
	endDate: string | undefined,
): string[] {
	const start = startDate ? toUtcMs(startDate) : null;
	const end = endDate ? toUtcMs(endDate) : null;
	if (start === null || end === null || end < start) return [];
	const days: string[] = [];
	for (
		let ms = start;
		ms <= end && days.length < MAX_FESTIVAL_DAYS;
		ms += DAY_MS
	) {
		days.push(new Date(ms).toISOString().slice(0, 10));
	}
	return days;
}

/** Festival days plus any extra dates, without duplicates, in date order. */
export function mergeDays(
	festivalDays: readonly string[],
	extraDates: readonly string[],
): string[] {
	return [...new Set([...festivalDays, ...extraDates])].sort();
}

function normalize(value: string | null | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

/** Dates on which this role already has a shift identical to the one being built. */
export function datesWithMatchingShift(
	existing: readonly VolunteerShift[],
	draft: Pick<ShiftDraftFields, "period" | "division" | "adjudicator">,
): Set<string> {
	const matches = new Set<string>();
	for (const shift of existing) {
		if (
			shift.period === draft.period &&
			normalize(shift.division) === normalize(draft.division) &&
			normalize(shift.adjudicator) === normalize(draft.adjudicator)
		) {
			matches.add(shift.date);
		}
	}
	return matches;
}

/** Mirrors the server's rules so a bad form fails once before calling the API. */
export function validateNewShiftDraft(
	draft: ShiftDraftFields,
	isRoomProctor: boolean,
): string | null {
	if (draft.period !== "AM" && draft.period !== "PM") {
		return "Shift period is required and must be AM or PM.";
	}
	const division = (draft.division ?? "").trim();
	const adjudicator = (draft.adjudicator ?? "").trim();
	if (isRoomProctor) {
		if (!division) return "Room Proctor shifts require a division.";
		if (!adjudicator) return "Room Proctor shifts require an adjudicator.";
	} else if (division || adjudicator) {
		return "Only Room Proctor shifts may have a division or adjudicator.";
	}
	return null;
}

export function validateShiftDates(
	dates: readonly string[],
	dateBounds?: ShiftDateBounds | null,
): string | null {
	if (dates.length === 0) return "Choose at least one day.";
	if (dates.length > MAX_SHIFT_BATCH_DATES) {
		return `You can add at most ${MAX_SHIFT_BATCH_DATES} days at once.`;
	}
	if (!dates.every(isValidShiftDate)) return "Every day must be a valid date.";
	if (
		dateBounds &&
		dates.some((date) => date < dateBounds.minDate || date > dateBounds.maxDate)
	) {
		return `Every day must be between ${dateBounds.minDate} and ${dateBounds.maxDate}.`;
	}
	return null;
}

/** Atomic batch payload with deduplicated sorted dates and trimmed fields. */
export function buildShiftBatchInput(
	dates: readonly string[],
	draft: ShiftDraftFields,
): CreateVolunteerShiftsBatchInput {
	const period: ShiftPeriod = draft.period;
	return {
		dates: [...new Set(dates)].sort(),
		period,
		timeText: (draft.timeText ?? "").trim(),
		division: (draft.division ?? "").trim(),
		adjudicator: (draft.adjudicator ?? "").trim(),
	};
}

export function addShiftsLabel(count: number): string {
	return count > 1 ? `Add ${count} shifts` : "Add shift";
}
