import {
	isWednesdayDeadlineCode,
	schedulingSectionSeconds,
} from "./scheduling.js";
import {
	type EffectiveClassRulePreview,
	evaluateSchedulingConfigPreview,
	type SchedulingDiagnosticIssue,
} from "./scheduling-preview.js";
import {
	buildReadinessPeople,
	compareText,
	formatDurationSeconds,
	linkEnsemblePairings,
	schedulingSectionPartition,
} from "./scheduling-readiness-helpers.js";
import type {
	SchedulingReadiness,
	SchedulingReadinessCodeDemand,
	SchedulingReadinessEntry,
	SchedulingReadinessInput,
	SchedulingRosterEntry,
} from "./scheduling-readiness-types.js";

export {
	formatDurationSeconds,
	primaryCodeForAdditionalCode,
	type SchedulingSectionPartition,
	schedulingSectionPartition,
} from "./scheduling-readiness-helpers.js";
export * from "./scheduling-readiness-types.js";

function compareEntries(
	a: SchedulingReadinessEntry,
	b: SchedulingReadinessEntry,
): number {
	if (a.code !== b.code) {
		if (a.code === null) return 1;
		if (b.code === null) return -1;
		return compareText(a.code, b.code);
	}
	return compareText(a.entitlementId, b.entitlementId);
}

function toReadinessEntry(
	row: SchedulingRosterEntry,
	rule: EffectiveClassRulePreview | undefined,
): SchedulingReadinessEntry {
	const hasTeacher =
		row.teacherMembershipId !== null || row.teacherName !== null;
	return {
		entitlementId: row.entitlementId,
		festivalClassId: row.festivalClassId,
		code: rule?.code ?? null,
		childId: row.childId,
		childName: row.childName,
		age: row.ageAtRegistration,
		teacher: hasTeacher
			? { membershipId: row.teacherMembershipId, name: row.teacherName }
			: null,
		accompanist: row.accompanist ? { ...row.accompanist } : null,
		role: rule?.isAdditionalParticipant ? "additional" : "entry",
		primaryEntitlementId: null,
		participantEntitlementIds: [],
		hasAge12Plus: (row.ageAtRegistration ?? 0) >= 12,
		repertoireSeconds: row.repertoireSeconds,
		registeredAtIso: row.registeredAtIso,
	};
}

function checkRosterEntry(
	row: SchedulingRosterEntry,
	rule: EffectiveClassRulePreview | undefined,
	blocking: SchedulingDiagnosticIssue[],
	warnings: SchedulingDiagnosticIssue[],
): void {
	const who = `${row.childName} (registration ${row.entitlementId})`;
	if (!rule) {
		blocking.push({
			code: "unmapped-class",
			severity: "error",
			targetId: row.entitlementId,
			message: `${who} is in catalog class ${row.festivalClassId}, which has no scheduling class-code mapping.`,
		});
	}
	if (row.ageAtRegistration === null) {
		blocking.push({
			code: "missing-age-snapshot",
			severity: "error",
			targetId: row.entitlementId,
			message: `${who} has no registration-age snapshot.`,
		});
	}
	if (row.accompanist && row.accompanist.customerId === null) {
		blocking.push({
			code: "unresolved-accompanist",
			severity: "error",
			targetId: row.entitlementId,
			message: `${who} lists accompanist membership ${row.accompanist.membershipId}, which does not resolve to an accompanist account.`,
		});
	}
	if (
		rule &&
		!rule.isAdditionalParticipant &&
		row.repertoireSeconds > Math.round(rule.playingMinutes * 60)
	) {
		warnings.push({
			code: "repertoire-exceeds-scheduling-playing",
			severity: "warning",
			targetId: row.entitlementId,
			message: `${who} in ${rule.code}: repertoire total ${formatDurationSeconds(row.repertoireSeconds)} exceeds Scheduling Playing ${formatDurationSeconds(Math.round(rule.playingMinutes * 60))}. Scheduling still uses Scheduling Playing.`,
		});
	}
}

function buildCodeDemand(
	rule: EffectiveClassRulePreview,
	entries: readonly SchedulingReadinessEntry[],
	betweenClassGapMinutes: number,
): SchedulingReadinessCodeDemand {
	const codeEntries = entries.filter(
		(entry) => entry.role === "entry" && entry.code === rule.code,
	);
	const entryCount = codeEntries.length;
	const limits = {
		min: rule.effectiveSectionLimits.min,
		max: rule.effectiveSectionLimits.max,
	};
	const partition = schedulingSectionPartition(entryCount, limits);
	const gapSeconds =
		partition.feasible && entryCount > 0
			? partition.minSections * betweenClassGapMinutes * 60
			: 0;
	return {
		code: rule.code,
		classIds: [rule.classId],
		entryCount,
		participantCount: codeEntries.reduce(
			(sum, entry) => sum + entry.participantEntitlementIds.length,
			0,
		),
		limits,
		minSections: partition.minSections,
		maxSections: partition.maxSections,
		feasible: partition.feasible,
		estimatedSeconds:
			schedulingSectionSeconds(
				rule.playingMinutes,
				rule.oralMinutes,
				entryCount,
			) + gapSeconds,
	};
}

/**
 * Input review for §4.2: combines the configuration preview with the confirmed
 * roster, ensemble pairings, and availability. Generation is allowed only when
 * no blocking issue remains.
 */
export function evaluateSchedulingReadiness(
	input: SchedulingReadinessInput,
): SchedulingReadiness {
	const { config, context, roster, availability } = input;
	const preview = evaluateSchedulingConfigPreview(config, context);
	const blockingIssues: SchedulingDiagnosticIssue[] = [
		...preview.blockingIssues,
	];
	const warnings: SchedulingDiagnosticIssue[] = [...preview.warnings];

	const ruleByClassId = new Map(
		preview.effectiveClassRules.map((rule) => [rule.classId, rule]),
	);
	const sortedRoster = [...roster].sort((a, b) =>
		compareText(a.entitlementId, b.entitlementId),
	);
	const entryMap = new Map<string, SchedulingReadinessEntry>();
	for (const row of sortedRoster) {
		const rule = ruleByClassId.get(row.festivalClassId);
		checkRosterEntry(row, rule, blockingIssues, warnings);
		entryMap.set(row.entitlementId, toReadinessEntry(row, rule));
	}
	linkEnsemblePairings(entryMap, config.ensemblePairings, blockingIssues);

	const entries = [...entryMap.values()].sort(compareEntries);
	const perCode = preview.effectiveClassRules
		.filter((rule) => !rule.isAdditionalParticipant)
		.map((rule) =>
			buildCodeDemand(rule, entries, config.betweenClassGapMinutes),
		)
		.sort((a, b) => compareText(a.code, b.code));

	for (const demand of perCode) {
		if (demand.feasible) continue;
		const { min, max } = demand.limits;
		blockingIssues.push({
			code: "section-partition-infeasible",
			severity: "error",
			targetId: demand.code,
			message:
				demand.entryCount < min
					? `${demand.code} has ${demand.entryCount} confirmed entr${demand.entryCount === 1 ? "y" : "ies"}, below its section minimum of ${min}; these entries would be held.`
					: `${demand.code} has ${demand.entryCount} confirmed entries, which cannot be split into sections of ${min}–${max} entries.`,
		});
	}

	const estimatedSeconds = perCode.reduce(
		(sum, demand) => sum + demand.estimatedSeconds,
		0,
	);
	const wednesdayDemand = perCode.filter(
		(demand) => demand.entryCount > 0 && isWednesdayDeadlineCode(demand.code),
	);
	const wednesdayConcertoEstimatedSeconds = wednesdayDemand.reduce(
		(sum, demand) => sum + demand.estimatedSeconds,
		0,
	);
	const wednesdayCapacitySeconds =
		preview.totals.wednesdayConcertoUsableMinutes * 60;
	if (wednesdayConcertoEstimatedSeconds > wednesdayCapacitySeconds) {
		blockingIssues.push({
			code: "wednesday-concerto-capacity-exceeded",
			severity: "error",
			message: `Wednesday-deadline concerto codes (${wednesdayDemand.map((d) => d.code).join(", ")}) need an estimated ${formatDurationSeconds(wednesdayConcertoEstimatedSeconds)}, but eligible windows through the deadline provide ${formatDurationSeconds(wednesdayCapacitySeconds)}.`,
		});
	}
	const totalCapacitySeconds = preview.totals.totalUsableMinutes * 60;
	if (estimatedSeconds > totalCapacitySeconds) {
		blockingIssues.push({
			code: "adjudicator-budget-exceeded",
			severity: "error",
			message: `Confirmed demand needs an estimated ${formatDurationSeconds(estimatedSeconds)}, but room/adjudicator windows provide ${formatDurationSeconds(totalCapacitySeconds)} within the adjudicator-day budget.`,
		});
	}

	const people = buildReadinessPeople(
		sortedRoster,
		availability,
		config.festivalDates,
		warnings,
	);

	return {
		canGenerate: blockingIssues.length === 0,
		preview,
		blockingIssues,
		warnings,
		perCode,
		entries,
		people,
		totals: {
			entryCount: entries.filter((entry) => entry.role === "entry").length,
			participantCount: entries.filter((entry) => entry.role === "additional")
				.length,
			estimatedSeconds,
			wednesdayConcertoEstimatedSeconds,
		},
	};
}
