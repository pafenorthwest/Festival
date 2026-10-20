import {
	AVAILABILITY_HOURS,
	type AvailabilityHour,
	type AvailabilitySubjectType,
	buildDefaultAvailabilityDays,
	formatAvailabilityHourBlock,
	type SaveSubjectFestivalAvailabilityInput,
	type SubjectFestivalAvailability,
} from "@festival/common";

export { AVAILABILITY_HOURS, formatAvailabilityHourBlock };

export function detectNarrowViewport(): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	return window.matchMedia("(max-width: 768px)").matches;
}

export function formatAvailabilityDateHeading(isoDate: string): string {
	const parsed = new Date(`${isoDate}T00:00:00.000Z`);
	if (Number.isNaN(parsed.valueOf())) {
		return isoDate;
	}
	const formatted = parsed.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
	return `${formatted} (${isoDate})`;
}

export function normalizeSubjectDaysForDates(
	subject: SubjectFestivalAvailability,
	dates: readonly string[],
): SubjectFestivalAvailability {
	const byDate = new Map(subject.days.map((day) => [day.date, day]));
	const defaults = buildDefaultAvailabilityDays(dates);
	return {
		...subject,
		days: defaults.map((defaultDay) => {
			const existing = byDate.get(defaultDay.date);
			return existing
				? {
						date: existing.date,
						availableHours: [...existing.availableHours],
					}
				: defaultDay;
		}),
	};
}

export function isSubjectHourAvailable(
	subject: SubjectFestivalAvailability,
	date: string,
	hour: AvailabilityHour,
): boolean {
	const day = subject.days.find((entry) => entry.date === date);
	if (!day) {
		return hour !== 17;
	}
	return day.availableHours.includes(hour);
}

export function toggleSubjectHourInList(
	subjects: readonly SubjectFestivalAvailability[],
	subjectType: AvailabilitySubjectType,
	subjectId: string,
	date: string,
	hour: AvailabilityHour,
): SubjectFestivalAvailability[] {
	return subjects.map((subject) => {
		if (
			subject.subjectType !== subjectType ||
			subject.subjectId !== subjectId
		) {
			return subject;
		}
		return {
			...subject,
			days: subject.days.map((day) => {
				if (day.date !== date) {
					return day;
				}
				const hasHour = day.availableHours.includes(hour);
				const nextHours = hasHour
					? day.availableHours.filter((item) => item !== hour)
					: [...day.availableHours, hour].sort((a, b) => a - b);
				return {
					date: day.date,
					availableHours: nextHours,
				};
			}),
		};
	});
}

export function toSaveSubjectsPayload(
	subjects: readonly SubjectFestivalAvailability[],
): SaveSubjectFestivalAvailabilityInput[] {
	return subjects.map((subject) => ({
		subjectType: subject.subjectType,
		subjectId: subject.subjectId,
		days: subject.days.map((day) => ({
			date: day.date,
			availableHours: [...day.availableHours],
		})),
	}));
}
