import {
	ADJUDICATOR_DAY_BUDGET_MINUTES,
	inferClassTypeFromCode,
	isConcertoClassCode,
	isWednesdayDeadlineCode,
	SCHEDULING_CLASS_DEFAULTS,
	type SchedulingAdjudicator,
	type SchedulingClassRule,
	type SchedulingClassType,
	type SchedulingConfiguration,
	type SchedulingRoomCompatibilityRule,
	type SchedulingRoomWindow,
	schedulingSectionLimits,
	schedulingSectionSeconds,
} from "./scheduling.js";
import type { PianoType, Room } from "./tenant.js";

export interface SchedulingPreviewDivision {
	id: string;
	displayName: string;
}

export interface SchedulingPreviewCatalogClass {
	id: string;
	displayName: string;
	divisionId: string;
	performanceMinutes: number;
	capacity: number;
	isActive: boolean;
}

export interface SchedulingPreviewContext {
	rooms: readonly Room[];
	catalogClasses: readonly SchedulingPreviewCatalogClass[];
	divisions?: readonly SchedulingPreviewDivision[];
	/** Festival start (YYYY-MM-DD); festival dates are range-checked only when both bounds are set. */
	festivalStartDate?: string;
	/** Festival end (YYYY-MM-DD); festival dates are range-checked only when both bounds are set. */
	festivalEndDate?: string;
}

export interface SchedulingDiagnosticIssue {
	code: string;
	severity: "error" | "warning";
	message: string;
	targetId?: string;
	/** Configuration field path, e.g. "roomWindows[0].adjudicatorId". */
	path?: string;
}

export interface RoomWindowPreview {
	windowId: string;
	festivalDate: string;
	roomId: string;
	roomName: string | null;
	roomPianosSummary: string;
	adjudicatorId: string;
	adjudicatorName: string | null;
	dayType: "full" | "half";
	rawMinutes: number;
	blockedMinutes: number;
	breakAndLunchMinutes: number;
	usableSchedulingMinutes: number;
	issues: SchedulingDiagnosticIssue[];
}

export interface EffectiveClassRulePreview {
	classId: string;
	catalogName: string;
	catalogPerformanceMinutes: number;
	divisionId: string | null;
	capacity: number;
	code: string;
	classType: SchedulingClassType;
	isConcerto: boolean;
	isWednesdayDeadline: boolean;
	isAdditionalParticipant: boolean;
	playingMinutes: number;
	oralMinutes: number;
	transitionSeconds: number;
	perEntrySeconds: number;
	effectiveSectionLimits: { min: number; max: number; isOverride: boolean };
	minSectionSeconds: number;
	maxSectionSeconds: number;
	placementGroupLabel: string;
	maxSectionsPerGroup: number | null;
	allowTueWedSplit: boolean;
	estimatedTotalSecondsAtCapacity: number;
	exceedsSingleDayBudgetAtCapacity: boolean;
	compatibleWindowCount: number;
	eligibleWednesdayWindowCount: number;
	differsFromCatalogMinutes: boolean;
	issues: SchedulingDiagnosticIssue[];
}

const defaultCodeSet = new Set(
	SCHEDULING_CLASS_DEFAULTS.map((row) => row.code),
);

const additionalCodeSet = new Set(
	SCHEDULING_CLASS_DEFAULTS.filter((row) => row.additionalParticipant).map(
		(row) => row.code,
	),
);

function roomSatisfiesCompatibility(
	room: Room,
	requiredPianoType: PianoType | null,
	minimumPianoCount: number,
): boolean {
	if (minimumPianoCount <= 0 && !requiredPianoType) return true;
	const matchingCount = requiredPianoType
		? room.pianoConfigurations
				.filter((cfg) => cfg.pianoType === requiredPianoType)
				.reduce((sum, cfg) => sum + cfg.count, 0)
		: room.pianoConfigurations.reduce((sum, cfg) => sum + cfg.count, 0);
	const effectiveMin = requiredPianoType
		? Math.max(1, minimumPianoCount)
		: minimumPianoCount;
	return matchingCount >= effectiveMin;
}

function matchingCompatibilityRules(
	rules: readonly SchedulingRoomCompatibilityRule[],
	divisionId: string | null,
	classCode: string,
	classType: SchedulingClassType,
): SchedulingRoomCompatibilityRule[] {
	return rules.filter((rule) => {
		if (rule.scopeType === "class_code") {
			return rule.scopeValue.trim().toUpperCase() === classCode.toUpperCase();
		}
		if (rule.scopeType === "class_type") {
			return rule.scopeValue.trim().toLowerCase() === classType;
		}
		return divisionId !== null && rule.scopeValue === divisionId;
	});
}

function windowMatchesClassRule(
	window: SchedulingRoomWindow,
	room: Room | undefined,
	adjudicatorEligibleDivisions: readonly string[] | undefined,
	divisionId: string | null,
	classType: SchedulingClassType,
	compatibilityRules: readonly SchedulingRoomCompatibilityRule[],
): boolean {
	if (!room) return false;
	if (
		window.eligibleClassTypes.length > 0 &&
		!window.eligibleClassTypes.includes(classType)
	) {
		return false;
	}
	if (classType === "concerto" && !window.concertoEligible) return false;
	if (
		divisionId &&
		window.eligibleDivisionIds.length > 0 &&
		!window.eligibleDivisionIds.includes(divisionId)
	) {
		return false;
	}
	if (
		divisionId &&
		adjudicatorEligibleDivisions &&
		adjudicatorEligibleDivisions.length > 0 &&
		!adjudicatorEligibleDivisions.includes(divisionId)
	) {
		return false;
	}
	for (const compat of compatibilityRules) {
		if (
			!roomSatisfiesCompatibility(
				room,
				compat.requiredPianoType,
				compat.minimumPianoCount,
			)
		) {
			return false;
		}
		if (
			compat.allowedAdjudicatorIds.length > 0 &&
			!compat.allowedAdjudicatorIds.includes(window.adjudicatorId)
		) {
			return false;
		}
	}
	return true;
}

function buildPlacementLabel(rule: SchedulingClassRule): {
	label: string;
	maxSectionsPerGroup: number | null;
	allowTueWedSplit: boolean;
} {
	const isConcerto = isConcertoClassCode(rule.code);
	const exception = rule.placementGroupException ?? null;
	const maxSections = exception?.maxSectionsPerGroup ?? (isConcerto ? null : 2);
	const allowTueWedSplit = Boolean(exception?.allowTueWedSplit && isConcerto);
	if (isConcerto) {
		if (allowTueWedSplit) {
			return {
				label:
					maxSections !== null
						? `Concerto Tue/Wed split (max ${maxSections} sections)`
						: "Concerto Tue/Wed split",
				maxSectionsPerGroup: maxSections,
				allowTueWedSplit: true,
			};
		}
		return {
			label:
				maxSections !== null
					? `Concerto single day (max ${maxSections} sections)`
					: "Concerto single day (all sections)",
			maxSectionsPerGroup: maxSections,
			allowTueWedSplit: false,
		};
	}
	return {
		label:
			exception?.maxSectionsPerGroup !== undefined &&
			exception?.maxSectionsPerGroup !== null
				? `Custom max ${exception.maxSectionsPerGroup} sections`
				: "Balanced (max 2 sections)",
		maxSectionsPerGroup: maxSections,
		allowTueWedSplit: false,
	};
}

export function evaluateEffectiveClassRules(
	config: SchedulingConfiguration,
	windowSummaries: readonly RoomWindowPreview[],
	roomMap: ReadonlyMap<string, Room>,
	adjudicatorMap: ReadonlyMap<string, SchedulingAdjudicator>,
	classMap: ReadonlyMap<string, SchedulingPreviewCatalogClass>,
): EffectiveClassRulePreview[] {
	return config.classRules.map((rule) => {
		const catalog = classMap.get(rule.classId);
		const isAdditional = additionalCodeSet.has(rule.code);
		const classType = inferClassTypeFromCode(rule.code);
		const isConcerto = isConcertoClassCode(rule.code);
		const isWedDeadline = isWednesdayDeadlineCode(rule.code);
		const limits =
			rule.sectionLimits ?? schedulingSectionLimits(rule.playingMinutes);
		const placement = buildPlacementLabel(rule);
		const perEntrySeconds = isAdditional
			? 0
			: schedulingSectionSeconds(rule.playingMinutes, rule.oralMinutes, 1);
		const minSectionSeconds = isAdditional
			? 0
			: schedulingSectionSeconds(
					rule.playingMinutes,
					rule.oralMinutes,
					limits.min,
				);
		const maxSectionSeconds = isAdditional
			? 0
			: schedulingSectionSeconds(
					rule.playingMinutes,
					rule.oralMinutes,
					limits.max,
				);
		const capacity = catalog?.capacity ?? 0;
		const estimatedTotalSecondsAtCapacity = isAdditional
			? 0
			: schedulingSectionSeconds(
					rule.playingMinutes,
					rule.oralMinutes,
					capacity,
				);
		const exceedsSingleDayBudgetAtCapacity =
			estimatedTotalSecondsAtCapacity > ADJUDICATOR_DAY_BUDGET_MINUTES * 60;

		const compatRules = matchingCompatibilityRules(
			config.roomCompatibilityRules,
			catalog?.divisionId ?? null,
			rule.code,
			classType,
		);
		const compatibleWindows = config.roomWindows.filter((win, idx) => {
			if (windowSummaries[idx].usableSchedulingMinutes <= 0) return false;
			const room = win.roomId ? roomMap.get(win.roomId) : undefined;
			const adj = win.adjudicatorId
				? adjudicatorMap.get(win.adjudicatorId)
				: undefined;
			return windowMatchesClassRule(
				win,
				room,
				adj?.eligibleDivisionIds,
				catalog?.divisionId ?? null,
				classType,
				compatRules,
			);
		});
		const wedWindows = isWedDeadline
			? compatibleWindows.filter(
					(win) =>
						config.wednesdayDeadlineDate !== null &&
						win.festivalDate <= config.wednesdayDeadlineDate,
				)
			: compatibleWindows;

		const issues: SchedulingDiagnosticIssue[] = [];
		if (!isAdditional && config.roomWindows.length > 0) {
			if (compatibleWindows.length === 0) {
				issues.push({
					code: "no-compatible-room-window",
					severity: "error",
					targetId: rule.classId,
					message: `Class ${rule.code} (${catalog?.displayName ?? rule.classId}) has no compatible room/adjudicator window.`,
				});
			} else if (isWedDeadline && !config.wednesdayDeadlineDate) {
				issues.push({
					code: "missing-wednesday-deadline",
					severity: "error",
					targetId: rule.classId,
					message: `Concerto deadline class ${rule.code} requires a configured Wednesday deadline date.`,
				});
			} else if (isWedDeadline && wedWindows.length === 0) {
				issues.push({
					code: "no-wednesday-concerto-window",
					severity: "error",
					targetId: rule.classId,
					message: `Concerto class ${rule.code} has no eligible room window finishing on or before ${config.wednesdayDeadlineDate}.`,
				});
			}
		}
		if (!defaultCodeSet.has(rule.code.trim().toUpperCase())) {
			issues.push({
				code: "custom-class-code",
				severity: "warning",
				targetId: rule.classId,
				message: `${rule.code} is a custom code; concerto/Wednesday-deadline rules are inferred from the code name and may not apply.`,
			});
		}
		if (
			isConcerto &&
			exceedsSingleDayBudgetAtCapacity &&
			!placement.allowTueWedSplit
		) {
			issues.push({
				code: "concerto-capacity-exceeds-single-day",
				severity: "warning",
				targetId: rule.classId,
				message: `${rule.code} at capacity (${capacity} entries) estimates ${Math.round(estimatedTotalSecondsAtCapacity / 60)} min (> ${ADJUDICATOR_DAY_BUDGET_MINUTES} min single-day budget) without Tuesday/Wednesday split enabled.`,
			});
		}

		return {
			classId: rule.classId,
			catalogName: catalog?.displayName ?? rule.classId,
			catalogPerformanceMinutes: catalog?.performanceMinutes ?? 0,
			divisionId: catalog?.divisionId ?? null,
			capacity,
			code: rule.code,
			classType,
			isConcerto,
			isWednesdayDeadline: isWedDeadline,
			isAdditionalParticipant: isAdditional,
			playingMinutes: rule.playingMinutes,
			oralMinutes: rule.oralMinutes,
			transitionSeconds: isAdditional ? 0 : 90,
			perEntrySeconds,
			effectiveSectionLimits: {
				...limits,
				isOverride: rule.sectionLimits !== null,
			},
			minSectionSeconds,
			maxSectionSeconds,
			placementGroupLabel: placement.label,
			maxSectionsPerGroup: placement.maxSectionsPerGroup,
			allowTueWedSplit: placement.allowTueWedSplit,
			estimatedTotalSecondsAtCapacity,
			exceedsSingleDayBudgetAtCapacity,
			compatibleWindowCount: compatibleWindows.length,
			eligibleWednesdayWindowCount: wedWindows.length,
			differsFromCatalogMinutes:
				catalog !== undefined &&
				rule.playingMinutes !== catalog.performanceMinutes,
			issues,
		};
	});
}
