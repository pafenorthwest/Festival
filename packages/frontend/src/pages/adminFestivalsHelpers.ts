import {
	type FestivalSummary,
	isFestivalRegistrationOpen,
	isValidIanaTimezone,
	type UpdateFestivalRegistrationWindowInput,
	validateFestivalRegistrationWindow,
} from "@festival/common";

const LOCAL_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toRegistrationWindowInputValue(
	value?: string | null,
	timezone = "UTC",
): string {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) {
		return "";
	}
	if (LOCAL_INPUT_PATTERN.test(trimmed)) {
		return trimmed;
	}
	if (DATE_ONLY_PATTERN.test(trimmed)) {
		return `${trimmed}T00:00`;
	}
	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) {
		return trimmed.slice(0, 16);
	}
	const tz = isValidIanaTimezone(timezone) ? timezone : "UTC";
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).formatToParts(parsed);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((item) => item.type === type)?.value ?? "";
	const year = part("year");
	const month = part("month");
	const day = part("day");
	const hour = part("hour");
	const minute = part("minute");
	if (!year || !month || !day || !hour || !minute) {
		return "";
	}
	return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function formatRegistrationWindowTimestamp(
	value: string,
	timezone = "UTC",
): string {
	const inputVal = toRegistrationWindowInputValue(value, timezone);
	if (!inputVal) {
		return value;
	}
	return inputVal.replace("T", " ");
}

export function formatFestivalRegistrationWindow(
	festival: Pick<
		FestivalSummary,
		"registrationOpensAt" | "registrationClosesAt"
	>,
	timezone = "UTC",
	now = new Date(),
): string {
	const opensAt = festival.registrationOpensAt?.trim() ?? "";
	const closesAt = festival.registrationClosesAt?.trim() ?? "";
	if (!opensAt || !closesAt) {
		return "Registration window not set (Closed)";
	}
	const open = isFestivalRegistrationOpen(festival, now, timezone);
	const opensFormatted = formatRegistrationWindowTimestamp(opensAt, timezone);
	const closesFormatted = formatRegistrationWindowTimestamp(closesAt, timezone);
	return `${opensFormatted} – ${closesFormatted} (${open ? "Open" : "Closed"})`;
}

export function buildRegistrationWindowPayload(
	opensAtDraft?: string | null,
	closesAtDraft?: string | null,
	timezone = "UTC",
): {
	isValid: boolean;
	error: string;
	payload: UpdateFestivalRegistrationWindowInput;
} {
	const rawOpens = opensAtDraft?.trim() || null;
	const rawCloses = closesAtDraft?.trim() || null;
	const tz = isValidIanaTimezone(timezone) ? timezone : "UTC";
	const validation = validateFestivalRegistrationWindow(
		{
			registrationOpensAt: rawOpens,
			registrationClosesAt: rawCloses,
		},
		tz,
	);
	return {
		isValid: validation.isValid,
		error: validation.errors.join(" "),
		payload: {
			registrationOpensAt: rawOpens,
			registrationClosesAt: rawCloses,
		},
	};
}
