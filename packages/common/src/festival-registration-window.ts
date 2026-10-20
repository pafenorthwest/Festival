import { isValidIanaTimezone } from "./organization.js";

export interface FestivalRegistrationWindow {
	registrationOpensAt?: string | null;
	registrationClosesAt?: string | null;
}

export interface UpdateFestivalRegistrationWindowInput {
	registrationOpensAt: string | null;
	registrationClosesAt: string | null;
}

export interface FestivalRegistrationWindowValidation {
	isValid: boolean;
	errors: string[];
	opensAtIso: string | null;
	closesAtIso: string | null;
}

export type RegistrationWindowBoundaryKind = "open" | "close";

interface LocalDateTimeComponents {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	millisecond: number;
}

const ISO_WITH_OFFSET_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATETIME_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidCalendarComponents(
	year: number,
	month: number,
	day: number,
): boolean {
	if (month < 1 || month > 12 || day < 1 || day > 31) {
		return false;
	}
	const utcDate = new Date(Date.UTC(year, month - 1, day));
	return (
		!Number.isNaN(utcDate.getTime()) &&
		utcDate.getUTCFullYear() === year &&
		utcDate.getUTCMonth() === month - 1 &&
		utcDate.getUTCDate() === day
	);
}

function getLocalAsUtcMs(dtf: Intl.DateTimeFormat, date: Date): number {
	const parts = dtf.formatToParts(date);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((p) => p.type === type)?.value);
	return Date.UTC(
		part("year"),
		part("month") - 1,
		part("day"),
		part("hour"),
		part("minute"),
		part("second"),
		date.getUTCMilliseconds(),
	);
}

function resolveTimezoneDate(
	components: LocalDateTimeComponents,
	timezone: string,
): Date | null {
	if (
		!isValidCalendarComponents(
			components.year,
			components.month,
			components.day,
		)
	) {
		return null;
	}
	if (
		components.hour > 23 ||
		components.minute > 59 ||
		components.second > 59
	) {
		return null;
	}
	const targetUtcMs = Date.UTC(
		components.year,
		components.month - 1,
		components.day,
		components.hour,
		components.minute,
		components.second,
		components.millisecond,
	);
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	let guessMs = targetUtcMs;
	for (let i = 0; i < 4; i++) {
		const diff = getLocalAsUtcMs(dtf, new Date(guessMs)) - targetUtcMs;
		if (diff === 0) {
			break;
		}
		guessMs -= diff;
	}
	return new Date(guessMs);
}

function parseExplicitOffsetIso(raw: string): Date | null {
	const datePart = raw.slice(0, 10);
	const [year, month, day] = datePart.split("-").map(Number);
	if (!isValidCalendarComponents(year, month, day)) {
		return null;
	}
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseRegistrationWindowBoundary(
	value: string,
	kind: RegistrationWindowBoundaryKind,
	timezone = "UTC",
): Date | null {
	const trimmed = value.trim();
	if (!trimmed || !isValidIanaTimezone(timezone)) {
		return null;
	}
	if (ISO_WITH_OFFSET_PATTERN.test(trimmed)) {
		return parseExplicitOffsetIso(trimmed);
	}
	const calendarMatch = CALENDAR_DATE_PATTERN.exec(trimmed);
	if (calendarMatch) {
		const isClose = kind === "close";
		return resolveTimezoneDate(
			{
				year: Number(calendarMatch[1]),
				month: Number(calendarMatch[2]),
				day: Number(calendarMatch[3]),
				hour: isClose ? 23 : 0,
				minute: isClose ? 59 : 0,
				second: isClose ? 59 : 0,
				millisecond: isClose ? 999 : 0,
			},
			timezone,
		);
	}
	const localMatch = LOCAL_DATETIME_PATTERN.exec(trimmed);
	if (localMatch) {
		const msRaw = localMatch[7];
		const millisecond = msRaw ? Number(msRaw.padEnd(3, "0")) : 0;
		return resolveTimezoneDate(
			{
				year: Number(localMatch[1]),
				month: Number(localMatch[2]),
				day: Number(localMatch[3]),
				hour: Number(localMatch[4]),
				minute: Number(localMatch[5]),
				second: localMatch[6] ? Number(localMatch[6]) : 0,
				millisecond,
			},
			timezone,
		);
	}
	return null;
}

function normalizeWindowBound(value?: string | null): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function validateFestivalRegistrationWindow(
	window: FestivalRegistrationWindow,
	timezone = "UTC",
): FestivalRegistrationWindowValidation {
	const rawOpens = normalizeWindowBound(window.registrationOpensAt);
	const rawCloses = normalizeWindowBound(window.registrationClosesAt);

	if (rawOpens === null && rawCloses === null) {
		return { isValid: true, errors: [], opensAtIso: null, closesAtIso: null };
	}
	if (rawOpens === null || rawCloses === null) {
		return {
			isValid: false,
			errors: [
				"Both registration open and close timestamps must be provided together.",
			],
			opensAtIso: null,
			closesAtIso: null,
		};
	}

	const errors: string[] = [];
	if (!isValidIanaTimezone(timezone)) {
		return {
			isValid: false,
			errors: ["Organization timezone must be a valid IANA timezone."],
			opensAtIso: null,
			closesAtIso: null,
		};
	}

	const opensAt = parseRegistrationWindowBoundary(rawOpens, "open", timezone);
	const closesAt = parseRegistrationWindowBoundary(
		rawCloses,
		"close",
		timezone,
	);

	if (!opensAt) {
		errors.push("Registration open timestamp is invalid.");
	}
	if (!closesAt) {
		errors.push("Registration close timestamp is invalid.");
	}
	if (opensAt && closesAt && opensAt.getTime() > closesAt.getTime()) {
		errors.push(
			"Registration close timestamp must be on or after the open timestamp.",
		);
	}

	const isValid = errors.length === 0 && opensAt !== null && closesAt !== null;
	return {
		isValid,
		errors,
		opensAtIso: isValid ? opensAt.toISOString() : null,
		closesAtIso: isValid ? closesAt.toISOString() : null,
	};
}

export function isFestivalRegistrationOpen(
	festival: FestivalRegistrationWindow,
	now: Date,
	timezone = "UTC",
): boolean {
	if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
		return false;
	}
	const rawOpens = normalizeWindowBound(festival.registrationOpensAt);
	const rawCloses = normalizeWindowBound(festival.registrationClosesAt);
	if (rawOpens === null || rawCloses === null) {
		return false;
	}
	const opensAt = parseRegistrationWindowBoundary(rawOpens, "open", timezone);
	const closesAt = parseRegistrationWindowBoundary(
		rawCloses,
		"close",
		timezone,
	);
	if (!opensAt || !closesAt || opensAt.getTime() > closesAt.getTime()) {
		return false;
	}
	const nowMs = now.getTime();
	return nowMs >= opensAt.getTime() && nowMs <= closesAt.getTime();
}
