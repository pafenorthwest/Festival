export interface SchedulingClassDefault {
	code: string;
	name: string;
	playingMinutes: number;
	oralMinutes: number;
	additionalParticipant: boolean;
}

function classDefault(
	code: string,
	name: string,
	playingMinutes: number,
	oralMinutes: number,
	additionalParticipant = false,
): SchedulingClassDefault {
	return { code, name, playingMinutes, oralMinutes, additionalParticipant };
}

// Scheduling values from Appendix A, independent of catalog performance limits.
export const SCHEDULING_CLASS_DEFAULTS: readonly SchedulingClassDefault[] = [
	classDefault("PS.6-7", "Piano Solo 6–7", 5, 6),
	classDefault("PS.8-9", "Piano Solo 8–9", 6, 6),
	classDefault("PS.10-11", "Piano Solo 10–11", 8, 6),
	classDefault("PS.12-13", "Piano Solo 12–13", 10, 7),
	classDefault("PS.14-15", "Piano Solo 14–15", 10, 7),
	classDefault("PS.16-17", "Piano Solo 16–17", 12, 7),
	classDefault("PC.6-7", "Piano Concerto 6–7", 8, 8),
	classDefault("PC.8-9", "Piano Concerto 8–9", 8, 8),
	classDefault("PC.10-11", "Piano Concerto 10–11", 10, 9),
	classDefault("PC.12-13", "Piano Concerto 12–13", 12, 9),
	classDefault("PC.14-15", "Piano Concerto 14–15", 15, 10),
	classDefault("PC.16-17", "Piano Concerto 16–17", 15, 10),
	classDefault("PEP.6-9", "Piano Ensemble 6–9, primary", 6, 6),
	classDefault("PEA.6-9", "Piano Ensemble 6–9, additional", 0, 0, true),
	classDefault("PEP.10-13", "Piano Ensemble 10–13, primary", 8, 6),
	classDefault("PEA.10-13", "Piano Ensemble 10–13, additional", 0, 0, true),
	classDefault("PEP.14-17", "Piano Ensemble 14–17, primary", 10, 7),
	classDefault("PEA.14-17", "Piano Ensemble 14–17, additional", 0, 0, true),
	classDefault("SS.8-9", "Violin-Viola Solo 8–9", 5, 6),
	classDefault("SS.10-11", "Violin-Viola Solo 10–11", 6, 6),
	classDefault("SS.12-13", "Violin-Viola Solo 12–13", 8, 6),
	classDefault("SS.14-15", "Violin-Viola Solo 14–15", 10, 7),
	classDefault("SS.16-17", "Violin-Viola Solo 16–17", 10, 7),
	classDefault("SC.8-9", "Violin-Viola Concerto 8–9", 8, 8),
	classDefault("SC.10-11", "Violin-Viola Concerto 10–11", 8, 8),
	classDefault("SC.12-13", "Violin-Viola Concerto 12–13", 10, 9),
	classDefault("SC.14-15", "Violin-Viola Concerto 14–15", 15, 10),
	classDefault("SC.16-17", "Violin-Viola Concerto 16–17", 15, 10),
	classDefault("SEP.8-13", "String Ensemble 8–13, primary", 8, 6),
	classDefault("SEA.8-13", "String Ensemble 8–13, additional", 0, 0, true),
	classDefault("SEP.14-17", "String Ensemble 14–17, primary", 12, 7),
	classDefault("SEA.14-17", "String Ensemble 14–17, additional", 0, 0, true),
	classDefault("WS.9-11", "Woodwind Solo 9–11", 6, 6),
	classDefault("WS.12-13", "Woodwind Solo 12–13", 8, 6),
	classDefault("WS.14-15", "Woodwind Solo 14–15", 10, 7),
	classDefault("WS.16-17", "Woodwind Solo 16–17", 10, 7),
	classDefault("WC.9-11", "Woodwind Concerto 9–11", 8, 8),
	classDefault("WC.12-13", "Woodwind Concerto 12–13", 8, 8),
	classDefault("WC.14-17", "Woodwind Concerto 14–17", 12, 9),
	classDefault("WEP.9-13", "Woodwind or Mixed Ensemble 9–13, primary", 8, 6),
	classDefault(
		"WEA.9-13",
		"Woodwind or Mixed Ensemble 9–13, additional",
		0,
		0,
		true,
	),
	classDefault("WEP.14-17", "Woodwind or Mixed Ensemble 14–17, primary", 10, 7),
	classDefault(
		"WEA.14-17",
		"Woodwind or Mixed Ensemble 14–17, additional",
		0,
		0,
		true,
	),
	classDefault("CS.8-9", "Cello-Bass Solo 8–9", 5, 6),
	classDefault("CS.10-11", "Cello-Bass Solo 10–11", 6, 6),
	classDefault("CS.12-13", "Cello-Bass Solo 12–13", 8, 6),
	classDefault("CS.14-15", "Cello-Bass Solo 14–15", 8, 7),
	classDefault("CS.16-17", "Cello-Bass Solo 16–17", 10, 9),
	classDefault("CC.8-9", "Cello-Bass Concerto 8–9", 8, 8),
	classDefault("CC.10-11", "Cello-Bass Concerto 10–11", 8, 8),
	classDefault("CC.12-13", "Cello-Bass Concerto 12–13", 10, 9),
	classDefault("CC.14-15", "Cello-Bass Concerto 14–15", 10, 10),
	classDefault("CC.16-17", "Cello-Bass Concerto 16–17", 15, 10),
];

export const PERFORMER_TRANSITION_SECONDS = 90;
export const ADJUDICATOR_DAY_BUDGET_MINUTES = 440;
export const DEFAULT_BETWEEN_CLASS_GAP_MINUTES = 7;
export const DEFAULT_ACCOMPANIST_GAP_MINUTES = 7;
export const FULL_DAY_LUNCH_MINUTES = 30;
export const LONG_BREAK_MINUTES = 10;
export const FULL_DAY_OUTSIDE_BUDGET_MINUTES =
	FULL_DAY_LUNCH_MINUTES + LONG_BREAK_MINUTES * 2;
export const HALF_DAY_OUTSIDE_BUDGET_MINUTES = LONG_BREAK_MINUTES;
export const DEFAULT_LUNCH_WINDOW_START = "11:45";
export const DEFAULT_LUNCH_WINDOW_END = "12:30";
export const DEFAULT_MORNING_BREAK_WINDOW_START = "09:45";
export const DEFAULT_MORNING_BREAK_WINDOW_END = "10:30";
export const DEFAULT_AFTERNOON_BREAK_WINDOW_START = "14:30";
export const DEFAULT_AFTERNOON_BREAK_WINDOW_END = "15:30";

export const CONCERTO_WEDNESDAY_DEADLINE_CODES = [
	"PC.12-13",
	"PC.14-15",
	"PC.16-17",
	"SC.12-13",
	"SC.14-15",
	"SC.16-17",
	"CC.12-13",
	"CC.14-15",
	"CC.16-17",
	"WC.14-17",
] as const;

const CONCERTO_WEDNESDAY_DEADLINE_SET = new Set<string>(
	CONCERTO_WEDNESDAY_DEADLINE_CODES,
);

export const SCHEDULING_CLASS_TYPES = ["solo", "concerto", "ensemble"] as const;
export type SchedulingClassType = (typeof SCHEDULING_CLASS_TYPES)[number];

export const SCHEDULING_DAY_TYPES = ["full", "half"] as const;
export type SchedulingDayType = (typeof SCHEDULING_DAY_TYPES)[number];

export function isWednesdayDeadlineCode(code: string): boolean {
	return CONCERTO_WEDNESDAY_DEADLINE_SET.has(code.trim().toUpperCase());
}

export function isConcertoClassCode(code: string): boolean {
	return /^[A-Z]+C\./.test(code.trim().toUpperCase());
}

export function inferClassTypeFromCode(code: string): SchedulingClassType {
	const normalized = code.trim().toUpperCase();
	if (/^[A-Z]+C\./.test(normalized)) return "concerto";
	if (/^[A-Z]+E[PA]?\./.test(normalized)) return "ensemble";
	return "solo";
}

export function isWednesdayDate(dateStr: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
	const parsed = new Date(`${dateStr}T00:00:00Z`);
	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === dateStr &&
		parsed.getUTCDay() === 3
	);
}

export function parseTimeOfDayMinutes(timeStr: string): number {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr);
	if (!match) return Number.NaN;
	return Number(match[1]) * 60 + Number(match[2]);
}

export function enumerateDateRange(
	startDate: string,
	endDate: string,
): string[] {
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
		!/^\d{4}-\d{2}-\d{2}$/.test(endDate)
	) {
		return [];
	}
	const start = new Date(`${startDate}T00:00:00Z`);
	const end = new Date(`${endDate}T00:00:00Z`);
	if (
		Number.isNaN(start.getTime()) ||
		Number.isNaN(end.getTime()) ||
		start > end
	) {
		return [];
	}
	const dates: string[] = [];
	const cursor = new Date(start);
	for (let i = 0; i < 31 && cursor <= end; i += 1) {
		dates.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return dates;
}

export function schedulingSectionLimits(playingMinutes: number) {
	if (playingMinutes < 8) return { min: 3, max: 5 };
	if (playingMinutes <= 10) return { min: 2, max: 4 };
	return { min: 2, max: 3 };
}

// Each entry performs once. Its oral time is pooled at the end of the section.
export function schedulingSectionSeconds(
	playingMinutes: number,
	oralMinutes: number,
	entryCount: number,
): number {
	if (playingMinutes === 0 && oralMinutes === 0) return 0;
	const playingSeconds = Math.round(playingMinutes * 60);
	const oralSeconds = Math.round(oralMinutes * 60);
	return (
		entryCount * (playingSeconds + PERFORMER_TRANSITION_SECONDS + oralSeconds)
	);
}
