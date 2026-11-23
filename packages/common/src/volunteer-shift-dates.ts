export const SHIFT_DATE_WINDOW_DAYS = 30;
export const MAX_SHIFT_BATCH_DATES = 62;

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function parseUtcCalendarDate(value: string): number | null {
	const match = CALENDAR_DATE_PATTERN.exec(value.trim());
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const ms = Date.UTC(year, month - 1, day);
	const check = new Date(ms);
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day
	) {
		return null;
	}
	return ms;
}

function formatUtcCalendarDate(ms: number): string {
	const date = new Date(ms);
	const year = String(date.getUTCFullYear()).padStart(4, "0");
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function getShiftDateBounds(
	startDate: string,
	endDate: string,
): { minDate: string; maxDate: string } | null {
	const startMs = parseUtcCalendarDate(startDate);
	const endMs = parseUtcCalendarDate(endDate);
	if (startMs === null || endMs === null || endMs < startMs) {
		return null;
	}
	const offsetMs = SHIFT_DATE_WINDOW_DAYS * MS_PER_DAY;
	return {
		minDate: formatUtcCalendarDate(startMs - offsetMs),
		maxDate: formatUtcCalendarDate(endMs + offsetMs),
	};
}

export function isDateWithinShiftWindow(
	date: string,
	startDate: string,
	endDate: string,
): boolean {
	const dateMs = parseUtcCalendarDate(date);
	if (dateMs === null) return false;
	const bounds = getShiftDateBounds(startDate, endDate);
	if (!bounds) return false;
	const normalized = formatUtcCalendarDate(dateMs);
	return normalized >= bounds.minDate && normalized <= bounds.maxDate;
}
