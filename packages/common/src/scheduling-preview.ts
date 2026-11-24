import {
	ADJUDICATOR_DAY_BUDGET_MINUTES,
	FULL_DAY_LUNCH_MINUTES,
	FULL_DAY_OUTSIDE_BUDGET_MINUTES,
	HALF_DAY_OUTSIDE_BUDGET_MINUTES,
	isWednesdayDate,
	parseTimeOfDayMinutes,
	type SchedulingConfiguration,
} from "./scheduling.js";
import {
	type EffectiveClassRulePreview,
	evaluateEffectiveClassRules,
	type RoomWindowPreview,
	type SchedulingDiagnosticIssue,
	type SchedulingPreviewContext,
} from "./scheduling-preview-rules.js";
import type { Room } from "./tenant.js";

export * from "./scheduling-preview-rules.js";

export interface SchedulingConfigurationPreview {
	windowSummaries: RoomWindowPreview[];
	effectiveClassRules: EffectiveClassRulePreview[];
	totals: {
		totalWindows: number;
		totalRawMinutes: number;
		totalUsableMinutes: number;
		wednesdayConcertoUsableMinutes: number;
		configuredClassCount: number;
		unmappedActiveClassCount: number;
	};
	blockingIssues: SchedulingDiagnosticIssue[];
	warnings: SchedulingDiagnosticIssue[];
}

function formatRoomPianos(room: Room | undefined): string {
	if (!room) return "Missing room";
	if (room.pianoConfigurations.length === 0) return "No pianos";
	return room.pianoConfigurations
		.map((item) => `${item.count} ${item.pianoType}`)
		.join(", ");
}

function mergeIntervals(intervals: readonly [number, number][]): number {
	if (intervals.length === 0) return 0;
	const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
	let total = 0;
	let [curStart, curEnd] = sorted[0];
	for (let i = 1; i < sorted.length; i += 1) {
		const [nextStart, nextEnd] = sorted[i];
		if (nextStart <= curEnd) {
			curEnd = Math.max(curEnd, nextEnd);
		} else {
			total += curEnd - curStart;
			curStart = nextStart;
			curEnd = nextEnd;
		}
	}
	return total + (curEnd - curStart);
}

function intervalsOverlap(
	aStart: number,
	aEnd: number,
	bStart: number,
	bEnd: number,
): boolean {
	return aStart < bEnd && bStart < aEnd;
}

export function evaluateSchedulingConfigPreview(
	config: SchedulingConfiguration,
	context: SchedulingPreviewContext,
): SchedulingConfigurationPreview {
	const roomMap = new Map(context.rooms.map((room) => [room.id, room]));
	const adjudicatorMap = new Map(
		config.adjudicators.map((adj) => [adj.id, adj]),
	);
	const classMap = new Map(context.catalogClasses.map((cls) => [cls.id, cls]));
	const festivalDateSet = new Set(config.festivalDates);
	const lunchStart = parseTimeOfDayMinutes(config.lunchWindowStart);
	const lunchEnd = parseTimeOfDayMinutes(config.lunchWindowEnd);

	const blockingIssues: SchedulingDiagnosticIssue[] = [];
	const warnings: SchedulingDiagnosticIssue[] = [];

	if (config.festivalDates.length === 0) {
		warnings.push({
			code: "no-festival-dates",
			severity: "warning",
			message: "No festival scheduling dates configured yet.",
		});
	}

	if (
		config.wednesdayDeadlineDate &&
		!isWednesdayDate(config.wednesdayDeadlineDate)
	) {
		blockingIssues.push({
			code: "invalid-wednesday-deadline",
			severity: "error",
			message: `Concerto deadline ${config.wednesdayDeadlineDate} is not a Wednesday.`,
		});
	}

	const windowSummaries: RoomWindowPreview[] = config.roomWindows.map((win) => {
		const issues: SchedulingDiagnosticIssue[] = [];
		const room = win.roomId ? roomMap.get(win.roomId) : undefined;
		const adjudicator = win.adjudicatorId
			? adjudicatorMap.get(win.adjudicatorId)
			: undefined;
		const wStart = parseTimeOfDayMinutes(win.startTime);
		const wEnd = parseTimeOfDayMinutes(win.endTime);
		const rawMinutes =
			Number.isFinite(wStart) && Number.isFinite(wEnd) && wEnd > wStart
				? wEnd - wStart
				: 0;
		const blockedMinutes = mergeIntervals(
			win.blockedIntervals.map((b) => [
				parseTimeOfDayMinutes(b.startTime),
				parseTimeOfDayMinutes(b.endTime),
			]),
		);
		const breakAndLunchMinutes =
			win.dayType === "full"
				? FULL_DAY_OUTSIDE_BUDGET_MINUTES
				: HALF_DAY_OUTSIDE_BUDGET_MINUTES;
		const usableSchedulingMinutes = Math.min(
			ADJUDICATOR_DAY_BUDGET_MINUTES,
			Math.max(0, rawMinutes - blockedMinutes - breakAndLunchMinutes),
		);

		if (!win.roomId || !room) {
			issues.push({
				code: "missing-room-reference",
				severity: "error",
				targetId: win.id,
				message: `Window on ${win.festivalDate} (${win.startTime}–${win.endTime}) is missing a valid festival room.`,
			});
		}
		if (!win.adjudicatorId || !adjudicator) {
			issues.push({
				code: "missing-adjudicator-reference",
				severity: "error",
				targetId: win.id,
				message: `Window on ${win.festivalDate} (${win.startTime}–${win.endTime}) is missing a valid adjudicator.`,
			});
		} else if (
			win.eligibleDivisionIds.length > 0 &&
			adjudicator.eligibleDivisionIds.length > 0 &&
			win.eligibleDivisionIds.some(
				(divId) => !adjudicator.eligibleDivisionIds.includes(divId),
			)
		) {
			issues.push({
				code: "adjudicator-division-mismatch",
				severity: "error",
				targetId: win.id,
				message: `Adjudicator ${adjudicator.name} is not eligible for all divisions assigned to window ${win.festivalDate} (${win.startTime}–${win.endTime}).`,
			});
		}
		if (festivalDateSet.size > 0 && !festivalDateSet.has(win.festivalDate)) {
			issues.push({
				code: "window-outside-festival-dates",
				severity: "error",
				targetId: win.id,
				message: `Window date ${win.festivalDate} is not in the configured festival dates.`,
			});
		}
		if (
			win.dayType === "full" &&
			Math.max(wStart, lunchStart) >
				Math.min(lunchEnd, wEnd - FULL_DAY_LUNCH_MINUTES)
		) {
			issues.push({
				code: "full-day-lunch-window-unmet",
				severity: "error",
				targetId: win.id,
				message: `Full-day window ${win.festivalDate} (${win.startTime}–${win.endTime}) cannot fit a 30-minute lunch starting inside ${config.lunchWindowStart}–${config.lunchWindowEnd}.`,
			});
		}
		if (usableSchedulingMinutes <= 0) {
			issues.push({
				code: "zero-usable-window-minutes",
				severity: "error",
				targetId: win.id,
				message: `Window ${win.festivalDate} (${win.startTime}–${win.endTime}) has no usable scheduling minutes after breaks and blocks.`,
			});
		}

		return {
			windowId: win.id,
			festivalDate: win.festivalDate,
			roomId: win.roomId,
			roomName: room?.name ?? null,
			roomPianosSummary: formatRoomPianos(room),
			adjudicatorId: win.adjudicatorId,
			adjudicatorName: adjudicator?.name ?? null,
			dayType: win.dayType,
			rawMinutes,
			blockedMinutes,
			breakAndLunchMinutes,
			usableSchedulingMinutes,
			issues,
		};
	});

	for (let i = 0; i < config.roomWindows.length; i += 1) {
		const a = config.roomWindows[i];
		const aStart = parseTimeOfDayMinutes(a.startTime);
		const aEnd = parseTimeOfDayMinutes(a.endTime);
		for (let j = i + 1; j < config.roomWindows.length; j += 1) {
			const b = config.roomWindows[j];
			if (a.festivalDate !== b.festivalDate) continue;
			const bStart = parseTimeOfDayMinutes(b.startTime);
			const bEnd = parseTimeOfDayMinutes(b.endTime);
			if (!intervalsOverlap(aStart, aEnd, bStart, bEnd)) continue;
			if (a.roomId && a.roomId === b.roomId) {
				const roomName = roomMap.get(a.roomId)?.name ?? a.roomId;
				const issue: SchedulingDiagnosticIssue = {
					code: "room-window-overlap",
					severity: "error",
					targetId: a.id,
					message: `Room "${roomName}" has overlapping windows on ${a.festivalDate} (${a.startTime}–${a.endTime} and ${b.startTime}–${b.endTime}).`,
				};
				windowSummaries[i].issues.push(issue);
				windowSummaries[j].issues.push({ ...issue, targetId: b.id });
			}
			if (a.adjudicatorId && a.adjudicatorId === b.adjudicatorId) {
				const adjName =
					adjudicatorMap.get(a.adjudicatorId)?.name ?? a.adjudicatorId;
				const issue: SchedulingDiagnosticIssue = {
					code: "adjudicator-window-overlap",
					severity: "error",
					targetId: a.id,
					message: `Adjudicator "${adjName}" has overlapping windows on ${a.festivalDate} (${a.startTime}–${a.endTime} and ${b.startTime}–${b.endTime}).`,
				};
				windowSummaries[i].issues.push(issue);
				windowSummaries[j].issues.push({ ...issue, targetId: b.id });
			}
		}
	}

	for (const summary of windowSummaries) {
		for (const issue of summary.issues) {
			if (issue.severity === "error") blockingIssues.push(issue);
			else warnings.push(issue);
		}
	}

	const adjudicatorDayUsable = new Map<string, number>();
	for (const summary of windowSummaries) {
		const key = `${summary.adjudicatorId || summary.windowId}\0${summary.festivalDate}`;
		const prev = adjudicatorDayUsable.get(key) ?? 0;
		adjudicatorDayUsable.set(
			key,
			Math.min(
				ADJUDICATOR_DAY_BUDGET_MINUTES,
				prev + summary.usableSchedulingMinutes,
			),
		);
	}

	const wednesdayConcertoDayUsable = new Map<string, number>();
	for (let idx = 0; idx < config.roomWindows.length; idx += 1) {
		const win = config.roomWindows[idx];
		const beforeDeadline =
			config.wednesdayDeadlineDate !== null &&
			win.festivalDate <= config.wednesdayDeadlineDate;
		const allowsConcerto =
			win.concertoEligible &&
			(win.eligibleClassTypes.length === 0 ||
				win.eligibleClassTypes.includes("concerto"));
		if (!beforeDeadline || !allowsConcerto) continue;
		const key = `${win.adjudicatorId || win.id}\0${win.festivalDate}`;
		const prev = wednesdayConcertoDayUsable.get(key) ?? 0;
		wednesdayConcertoDayUsable.set(
			key,
			Math.min(
				ADJUDICATOR_DAY_BUDGET_MINUTES,
				prev + windowSummaries[idx].usableSchedulingMinutes,
			),
		);
	}

	const effectiveClassRules = evaluateEffectiveClassRules(
		config,
		windowSummaries,
		roomMap,
		adjudicatorMap,
		classMap,
	);

	for (const rule of effectiveClassRules) {
		for (const issue of rule.issues) {
			if (issue.severity === "error") blockingIssues.push(issue);
			else warnings.push(issue);
		}
	}

	const mappedIds = new Set(config.classRules.map((r) => r.classId));
	const unmappedActiveClassCount = context.catalogClasses.filter(
		(cls) => cls.isActive && !mappedIds.has(cls.id),
	).length;

	return {
		windowSummaries,
		effectiveClassRules,
		totals: {
			totalWindows: config.roomWindows.length,
			totalRawMinutes: windowSummaries.reduce(
				(sum, w) => sum + w.rawMinutes,
				0,
			),
			totalUsableMinutes: [...adjudicatorDayUsable.values()].reduce(
				(sum, m) => sum + m,
				0,
			),
			wednesdayConcertoUsableMinutes: [
				...wednesdayConcertoDayUsable.values(),
			].reduce((sum, m) => sum + m, 0),
			configuredClassCount: config.classRules.length,
			unmappedActiveClassCount,
		},
		blockingIssues,
		warnings,
	};
}
