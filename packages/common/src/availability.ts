import type { FestivalSummary } from "./organization.js";

export const AVAILABILITY_HOURS = [
	8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
] as const;

export type AvailabilityHour = (typeof AVAILABILITY_HOURS)[number];

export const DEFAULT_AVAILABLE_HOURS: readonly AvailabilityHour[] = [
	8, 9, 10, 11, 12, 13, 14, 15, 16,
];

export type AvailabilitySubjectType = "accompanist" | "child";

export interface AvailabilitySubject {
	subjectType: AvailabilitySubjectType;
	subjectId: string;
	label: string;
}

export interface AvailabilityDayRecord {
	date: string;
	availableHours: AvailabilityHour[];
}

export interface SubjectFestivalAvailability {
	subjectType: AvailabilitySubjectType;
	subjectId: string;
	label: string;
	days: AvailabilityDayRecord[];
}

export interface CustomerFestivalAvailabilityResponse {
	organizationId: string;
	festivals: FestivalSummary[];
	selectedFestivalId: string | null;
	dates: string[];
	subjects: SubjectFestivalAvailability[];
}

export interface SaveSubjectFestivalAvailabilityInput {
	subjectType: AvailabilitySubjectType;
	subjectId: string;
	days: { date: string; availableHours: number[] }[];
}

export interface SaveCustomerFestivalAvailabilityRequest {
	festivalId: string;
	subjects: SaveSubjectFestivalAvailabilityInput[];
}

function parseIsoCalendarDate(value: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error("Calendar date must use YYYY-MM-DD.");
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (
		Number.isNaN(parsed.valueOf()) ||
		parsed.toISOString().slice(0, 10) !== value
	) {
		throw new Error("Calendar date is invalid.");
	}
	return parsed;
}

export function enumerateFestivalDates(
	startDate: string,
	endDate: string,
): string[] {
	const current = parseIsoCalendarDate(startDate);
	const end = parseIsoCalendarDate(endDate);
	if (end.valueOf() < current.valueOf()) {
		return [];
	}
	const dates: string[] = [];
	while (current.valueOf() <= end.valueOf()) {
		dates.push(current.toISOString().slice(0, 10));
		current.setUTCDate(current.getUTCDate() + 1);
	}
	return dates;
}

export function buildDefaultAvailabilityDays(
	dates: readonly string[],
): AvailabilityDayRecord[] {
	return dates.map((date) => ({
		date,
		availableHours: [...DEFAULT_AVAILABLE_HOURS],
	}));
}

export function isAvailabilityHour(value: number): value is AvailabilityHour {
	return (
		Number.isInteger(value) &&
		(AVAILABILITY_HOURS as readonly number[]).includes(value)
	);
}

export function normalizeAvailableHours(
	hours: readonly number[],
): AvailabilityHour[] {
	const unique = new Set<AvailabilityHour>();
	for (const hour of hours) {
		if (!isAvailabilityHour(hour)) {
			throw new Error(`Invalid availability hour: ${hour}.`);
		}
		unique.add(hour);
	}
	return [...unique].sort((a, b) => a - b);
}

function formatHourPoint(hour24: number): string {
	const suffix = hour24 >= 12 ? "p.m." : "a.m.";
	const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
	return `${hour12}:00 ${suffix}`;
}

export function formatAvailabilityHourBlock(hour: AvailabilityHour): string {
	return `${formatHourPoint(hour)} - ${formatHourPoint(hour + 1)}`;
}

function validateSubjectDays(
	subject: SaveSubjectFestivalAvailabilityInput,
	validDateSet: ReadonlySet<string>,
	errors: string[],
): void {
	if (!Array.isArray(subject.days)) {
		errors.push("Subject days must be an array.");
		return;
	}
	const seenDates = new Set<string>();
	for (const day of subject.days) {
		if (!day || typeof day.date !== "string" || !validDateSet.has(day.date)) {
			errors.push(`Invalid festival date: ${String(day?.date ?? "")}.`);
			continue;
		}
		if (seenDates.has(day.date)) {
			errors.push(`Duplicate availability date: ${day.date}.`);
		}
		seenDates.add(day.date);
		if (
			!Array.isArray(day.availableHours) ||
			!day.availableHours.every((hour) => isAvailabilityHour(hour))
		) {
			errors.push(`Invalid available hours for date ${day.date}.`);
		}
	}
}

export function validateSaveCustomerFestivalAvailabilityRequest(
	input: SaveCustomerFestivalAvailabilityRequest,
	festivalDates: readonly string[],
): { isValid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (typeof input?.festivalId !== "string" || !input.festivalId.trim()) {
		errors.push("Festival ID is required.");
	}
	if (!Array.isArray(input?.subjects)) {
		errors.push("Subjects must be an array.");
		return { isValid: false, errors };
	}
	const validDateSet = new Set(festivalDates);
	const seenSubjects = new Set<string>();
	for (const subject of input.subjects) {
		if (
			!subject ||
			(subject.subjectType !== "accompanist" && subject.subjectType !== "child")
		) {
			errors.push("Subject type must be accompanist or child.");
			continue;
		}
		if (typeof subject.subjectId !== "string" || !subject.subjectId.trim()) {
			errors.push("Subject ID is required.");
			continue;
		}
		const subjectKey = `${subject.subjectType}:${subject.subjectId.trim()}`;
		if (seenSubjects.has(subjectKey)) {
			errors.push(`Duplicate subject: ${subjectKey}.`);
		}
		seenSubjects.add(subjectKey);
		validateSubjectDays(subject, validDateSet, errors);
	}
	return { isValid: errors.length === 0, errors };
}
