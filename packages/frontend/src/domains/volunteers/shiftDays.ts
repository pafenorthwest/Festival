import type { ShiftPeriod } from "@festival/common";
import { formatScheduleDate } from "../../app/appFormatting.js";
import type {
	CreateVolunteerShiftInput,
	VolunteerShift,
} from "../../lib/api.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A festival is days long; this only stops a bad date range from listing years. */
const MAX_FESTIVAL_DAYS = 62;

export type ShiftDraftFields = Pick<
	CreateVolunteerShiftInput,
	"period" | "timeText" | "division" | "adjudicator"
>;

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

/** Mirrors the server's rules so a bad form fails once, not once per day. */
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

export function validateShiftDates(dates: readonly string[]): string | null {
	if (dates.length === 0) return "Choose at least one day.";
	if (!dates.every(isValidShiftDate)) return "Every day must be a valid date.";
	return null;
}

/** One input per day, in date order, with the same details on each. */
export function buildShiftInputs(
	dates: readonly string[],
	draft: ShiftDraftFields,
): CreateVolunteerShiftInput[] {
	const period: ShiftPeriod = draft.period;
	return [...new Set(dates)].sort().map((date) => ({
		date,
		period,
		timeText: (draft.timeText ?? "").trim(),
		division: (draft.division ?? "").trim(),
		adjudicator: (draft.adjudicator ?? "").trim(),
	}));
}

export interface CreateShiftsResult {
	created: string[];
	failed?: { date: string; message: string };
	/** Days that were not created, starting with the one that failed. */
	remaining: string[];
}

/**
 * Creates the shifts one after another and stops at the first failure, so a
 * problem that affects every request (such as a lost connection) is reported
 * once instead of repeated for each day.
 */
export async function createShiftsForDays(
	inputs: readonly CreateVolunteerShiftInput[],
	create: (input: CreateVolunteerShiftInput) => Promise<unknown>,
): Promise<CreateShiftsResult> {
	const created: string[] = [];
	for (const [index, input] of inputs.entries()) {
		try {
			await create(input);
			created.push(input.date);
		} catch (error) {
			return {
				created,
				failed: {
					date: input.date,
					message:
						error instanceof Error && error.message
							? error.message
							: "The shift could not be created.",
				},
				remaining: inputs.slice(index).map((item) => item.date),
			};
		}
	}
	return { created, remaining: [] };
}

export function describeCreateResult(
	result: CreateShiftsResult,
	total: number,
): string {
	if (!result.failed) {
		return result.created.length === 1
			? "Added 1 shift."
			: `Added ${result.created.length} shifts.`;
	}
	const added = `Added ${result.created.length} of ${total} shifts.`;
	const reason = result.failed.message.replace(/[.\s]+$/, "");
	return `${added} Could not add ${formatScheduleDate(result.failed.date)}: ${reason}. The days that were not added are still selected.`;
}

export function addShiftsLabel(count: number): string {
	return count > 1 ? `Add ${count} shifts` : "Add shift";
}
