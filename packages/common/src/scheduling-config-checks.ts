import type { SchedulingConfiguration } from "./scheduling.js";

/** A config-level validation issue with a path relative to the configuration object. */
export interface SchedulingConfigIssue {
	code: string;
	path: string;
	message: string;
	targetId?: string;
}

export interface SchedulingFestivalRange {
	festivalStartDate?: string;
	festivalEndDate?: string;
}

/**
 * Festival dates must fall inside the festival's start/end range (checked only
 * when the range is provided), and a configured Wednesday deadline must be one
 * of the selected festival dates.
 */
export function findSchedulingDateIssues(
	config: Pick<
		SchedulingConfiguration,
		"festivalDates" | "wednesdayDeadlineDate"
	>,
	range: SchedulingFestivalRange = {},
): SchedulingConfigIssue[] {
	const issues: SchedulingConfigIssue[] = [];
	const { festivalStartDate: start, festivalEndDate: end } = range;
	if (start && end) {
		config.festivalDates.forEach((date, index) => {
			if (date < start || date > end) {
				issues.push({
					code: "festival-date-outside-festival",
					path: `festivalDates[${index}]`,
					message: `Scheduling date ${date} is outside the festival dates ${start} to ${end}.`,
				});
			}
		});
	}
	const deadline = config.wednesdayDeadlineDate;
	if (deadline && !config.festivalDates.includes(deadline)) {
		issues.push({
			code: "wednesday-deadline-not-in-festival-dates",
			path: "wednesdayDeadlineDate",
			message: `Concerto Wednesday deadline ${deadline} is not one of the selected festival dates.`,
		});
	}
	return issues;
}

/**
 * Adjudicator and class-code references inside the configuration must resolve
 * to records in the same configuration.
 */
export function findSchedulingReferenceIssues(
	config: Pick<
		SchedulingConfiguration,
		"adjudicators" | "roomWindows" | "roomCompatibilityRules" | "classRules"
	>,
): SchedulingConfigIssue[] {
	const issues: SchedulingConfigIssue[] = [];
	const adjudicatorIds = new Set(config.adjudicators.map((adj) => adj.id));
	const classCodes = new Set(
		config.classRules.map((rule) => rule.code.trim().toUpperCase()),
	);
	config.roomWindows.forEach((win, index) => {
		if (win.adjudicatorId && !adjudicatorIds.has(win.adjudicatorId)) {
			issues.push({
				code: "unknown-window-adjudicator",
				path: `roomWindows[${index}].adjudicatorId`,
				targetId: win.id,
				message: `Room window on ${win.festivalDate} references unknown adjudicator ${win.adjudicatorId}.`,
			});
		}
	});
	config.roomCompatibilityRules.forEach((rule, index) => {
		rule.allowedAdjudicatorIds.forEach((adjId, adjIndex) => {
			if (!adjudicatorIds.has(adjId)) {
				issues.push({
					code: "unknown-compatibility-adjudicator",
					path: `roomCompatibilityRules[${index}].allowedAdjudicatorIds[${adjIndex}]`,
					targetId: rule.id,
					message: `Compatibility rule ${rule.id} references unknown adjudicator ${adjId}.`,
				});
			}
		});
		if (
			rule.scopeType === "class_code" &&
			!classCodes.has(rule.scopeValue.trim().toUpperCase())
		) {
			issues.push({
				code: "unknown-compatibility-class-code",
				path: `roomCompatibilityRules[${index}].scopeValue`,
				targetId: rule.id,
				message: `Compatibility rule ${rule.id} references class code ${rule.scopeValue}, which has no class rule.`,
			});
		}
	});
	return issues;
}
