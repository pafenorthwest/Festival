import * as v from "valibot";
import {
	DEFAULT_ACCOMPANIST_GAP_MINUTES,
	DEFAULT_AFTERNOON_BREAK_WINDOW_END,
	DEFAULT_AFTERNOON_BREAK_WINDOW_START,
	DEFAULT_BETWEEN_CLASS_GAP_MINUTES,
	DEFAULT_LUNCH_WINDOW_END,
	DEFAULT_LUNCH_WINDOW_START,
	DEFAULT_MORNING_BREAK_WINDOW_END,
	DEFAULT_MORNING_BREAK_WINDOW_START,
	inferClassTypeFromCode,
	isWednesdayDate,
	parseTimeOfDayMinutes,
	SCHEDULING_CLASS_DEFAULTS,
	SCHEDULING_CLASS_TYPES,
	SCHEDULING_DAY_TYPES,
} from "./scheduling-defaults.js";
import { calendarDateSchema, nonEmptyText } from "./schema-utils.js";
import { PIANO_TYPES } from "./tenant.js";

export * from "./scheduling-config-checks.js";
export * from "./scheduling-defaults.js";

const schedulingMinutes = v.pipe(
	v.number(),
	v.minValue(0),
	v.check((minutes) => {
		const seconds = Math.round(minutes * 60);
		return Number.isSafeInteger(seconds) && seconds / 60 === minutes;
	}, "Scheduling times must be expressible in whole seconds."),
);

const sectionSize = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const sectionLimitsSchema = v.pipe(
	v.strictObject({ min: sectionSize, max: sectionSize }),
	v.check(
		({ min, max }) => min <= max,
		"Minimum section size exceeds maximum.",
	),
);

const additionalCodes = new Set(
	SCHEDULING_CLASS_DEFAULTS.filter((row) => row.additionalParticipant).map(
		(row) => row.code,
	),
);

const positiveWholeMinutes = v.pipe(
	v.number(),
	v.safeInteger(),
	v.minValue(1, "Minutes must be a positive whole number."),
);

const timeOfDaySchema = v.pipe(
	v.string("Time must use HH:MM (24-hour)."),
	v.trim(),
	v.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Time must use HH:MM (24-hour)."),
);

const placementGroupExceptionSchema = v.strictObject({
	maxSectionsPerGroup: v.nullable(
		v.pipe(
			v.number(),
			v.safeInteger(),
			v.minValue(1, "Max sections per group must be at least 1."),
		),
	),
	allowTueWedSplit: v.boolean(),
});

export type PlacementGroupException = v.InferOutput<
	typeof placementGroupExceptionSchema
>;

const schedulingRuleSchema = v.pipe(
	v.strictObject({
		classId: nonEmptyText("Catalog class ID", 200),
		code: v.pipe(nonEmptyText("Scheduling class code", 200), v.toUpperCase()),
		playingMinutes: schedulingMinutes,
		oralMinutes: schedulingMinutes,
		sectionLimits: v.nullable(sectionLimitsSchema),
		placementGroupException: v.optional(
			v.nullable(placementGroupExceptionSchema),
		),
	}),
	v.check((rule) => {
		if (additionalCodes.has(rule.code)) {
			return (
				rule.playingMinutes === 0 &&
				rule.oralMinutes === 0 &&
				rule.sectionLimits === null &&
				!rule.placementGroupException
			);
		}
		return rule.playingMinutes > 0;
	}, "Performers require positive Playing time. Additional participants have zero timing, no section limits, and no group exceptions."),
	v.check((rule) => {
		if (!rule.placementGroupException?.allowTueWedSplit) return true;
		return inferClassTypeFromCode(rule.code) === "concerto";
	}, "Tuesday/Wednesday split is only supported for Concerto class codes."),
);

export type SchedulingClassRule = v.InferOutput<typeof schedulingRuleSchema>;

const uniqueClassRulesSchema = v.pipe(
	v.array(schedulingRuleSchema),
	v.check(
		(rules) =>
			new Set(rules.map(({ classId }) => classId)).size === rules.length,
		"Each catalog class may be mapped only once.",
	),
	v.check(
		(rules) => new Set(rules.map(({ code }) => code)).size === rules.length,
		"Each scheduling class code may be mapped only once.",
	),
);

export const SchedulingAdjudicatorSchema = v.strictObject({
	id: nonEmptyText("Adjudicator ID", 200),
	name: nonEmptyText("Adjudicator name", 200),
	eligibleDivisionIds: v.pipe(
		v.array(nonEmptyText("Division ID", 200)),
		v.check(
			(ids) => new Set(ids).size === ids.length,
			"Duplicate eligible divisions are not allowed on an adjudicator.",
		),
	),
});
export type SchedulingAdjudicator = v.InferOutput<
	typeof SchedulingAdjudicatorSchema
>;

export const SchedulingBlockedIntervalSchema = v.pipe(
	v.strictObject({
		startTime: timeOfDaySchema,
		endTime: timeOfDaySchema,
		label: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120)), ""),
	}),
	v.check(
		(b) =>
			parseTimeOfDayMinutes(b.startTime) < parseTimeOfDayMinutes(b.endTime),
		"Blocked interval start time must be earlier than end time.",
	),
);
export type SchedulingBlockedInterval = v.InferOutput<
	typeof SchedulingBlockedIntervalSchema
>;

export const SchedulingRoomWindowSchema = v.pipe(
	v.strictObject({
		id: nonEmptyText("Room window ID", 200),
		festivalDate: calendarDateSchema,
		roomId: v.pipe(v.string(), v.trim(), v.maxLength(200)),
		adjudicatorId: v.pipe(v.string(), v.trim(), v.maxLength(200)),
		startTime: timeOfDaySchema,
		endTime: timeOfDaySchema,
		dayType: v.picklist(SCHEDULING_DAY_TYPES),
		eligibleDivisionIds: v.pipe(
			v.array(nonEmptyText("Division ID", 200)),
			v.check(
				(ids) => new Set(ids).size === ids.length,
				"Duplicate eligible divisions are not allowed on a room window.",
			),
		),
		eligibleClassTypes: v.pipe(
			v.array(v.picklist(SCHEDULING_CLASS_TYPES)),
			v.check(
				(types) => new Set(types).size === types.length,
				"Duplicate class types are not allowed on a room window.",
			),
		),
		concertoEligible: v.boolean(),
		blockedIntervals: v.array(SchedulingBlockedIntervalSchema),
	}),
	v.check(
		(w) =>
			parseTimeOfDayMinutes(w.startTime) < parseTimeOfDayMinutes(w.endTime),
		"Room window start time must be earlier than end time.",
	),
	v.check((w) => {
		const wStart = parseTimeOfDayMinutes(w.startTime);
		const wEnd = parseTimeOfDayMinutes(w.endTime);
		return w.blockedIntervals.every(
			(b) =>
				parseTimeOfDayMinutes(b.startTime) >= wStart &&
				parseTimeOfDayMinutes(b.endTime) <= wEnd,
		);
	}, "Blocked intervals must stay within the room window start and end times."),
);
export type SchedulingRoomWindow = v.InferOutput<
	typeof SchedulingRoomWindowSchema
>;

const schedulingClassTypeSet = new Set<string>(SCHEDULING_CLASS_TYPES);

export const SchedulingRoomCompatibilityRuleSchema = v.pipe(
	v.strictObject({
		id: nonEmptyText("Compatibility rule ID", 200),
		scopeType: v.picklist(["division", "class_code", "class_type"]),
		scopeValue: nonEmptyText("Compatibility scope value", 200),
		requiredPianoType: v.nullable(v.picklist(PIANO_TYPES)),
		minimumPianoCount: v.pipe(
			v.number(),
			v.safeInteger(),
			v.minValue(0),
			v.maxValue(3),
		),
		allowedAdjudicatorIds: v.pipe(
			v.array(nonEmptyText("Adjudicator ID", 200)),
			v.check(
				(ids) => new Set(ids).size === ids.length,
				"Duplicate adjudicator IDs are not allowed in compatibility mapping.",
			),
		),
	}),
	v.forward(
		v.check(
			(rule) =>
				rule.scopeType !== "class_type" ||
				schedulingClassTypeSet.has(rule.scopeValue),
			`Compatibility class_type scope must be one of: ${SCHEDULING_CLASS_TYPES.join(", ")}.`,
		),
		["scopeValue"],
	),
);
export type SchedulingRoomCompatibilityRule = v.InferOutput<
	typeof SchedulingRoomCompatibilityRuleSchema
>;

export const SchedulingEnsemblePairingSchema = v.pipe(
	v.strictObject({
		additionalEntitlementId: nonEmptyText("Additional entitlement ID", 200),
		primaryEntitlementId: nonEmptyText("Primary entitlement ID", 200),
	}),
	v.check(
		(pairing) =>
			pairing.additionalEntitlementId !== pairing.primaryEntitlementId,
		"An additional ensemble participant cannot be paired with itself.",
	),
);
export type SchedulingEnsemblePairing = v.InferOutput<
	typeof SchedulingEnsemblePairingSchema
>;

const ensemblePairingsSchema = v.optional(
	v.pipe(
		v.array(SchedulingEnsemblePairingSchema),
		v.check(
			(items) =>
				new Set(items.map((p) => p.additionalEntitlementId)).size ===
				items.length,
			"Each additional ensemble participant may be paired only once.",
		),
	),
	() => [],
);

export const SchedulingConfigurationSchema = v.pipe(
	v.strictObject({
		festivalDates: v.pipe(
			v.array(calendarDateSchema),
			v.check(
				(dates) => new Set(dates).size === dates.length,
				"Duplicate festival dates are not allowed.",
			),
		),
		wednesdayDeadlineDate: v.nullable(calendarDateSchema),
		adjudicators: v.pipe(
			v.array(SchedulingAdjudicatorSchema),
			v.check(
				(items) => new Set(items.map((a) => a.id)).size === items.length,
				"Adjudicator IDs must be unique.",
			),
		),
		roomWindows: v.pipe(
			v.array(SchedulingRoomWindowSchema),
			v.check(
				(items) => new Set(items.map((w) => w.id)).size === items.length,
				"Room window IDs must be unique.",
			),
		),
		classRules: uniqueClassRulesSchema,
		roomCompatibilityRules: v.pipe(
			v.array(SchedulingRoomCompatibilityRuleSchema),
			v.check(
				(items) => new Set(items.map((r) => r.id)).size === items.length,
				"Compatibility rule IDs must be unique.",
			),
		),
		betweenClassGapMinutes: positiveWholeMinutes,
		accompanistGapMinutes: positiveWholeMinutes,
		lunchWindowStart: timeOfDaySchema,
		lunchWindowEnd: timeOfDaySchema,
		morningBreakWindowStart: timeOfDaySchema,
		morningBreakWindowEnd: timeOfDaySchema,
		afternoonBreakWindowStart: timeOfDaySchema,
		afternoonBreakWindowEnd: timeOfDaySchema,
		ensemblePairings: ensemblePairingsSchema,
	}),
	v.check(
		(cfg) =>
			cfg.wednesdayDeadlineDate === null ||
			isWednesdayDate(cfg.wednesdayDeadlineDate),
		"Concerto Wednesday deadline date must be a Wednesday.",
	),
	v.check(
		(cfg) =>
			parseTimeOfDayMinutes(cfg.lunchWindowStart) <
			parseTimeOfDayMinutes(cfg.lunchWindowEnd),
		"Lunch window start must be earlier than end.",
	),
	v.check(
		(cfg) =>
			parseTimeOfDayMinutes(cfg.morningBreakWindowStart) <
			parseTimeOfDayMinutes(cfg.morningBreakWindowEnd),
		"Morning break window start must be earlier than end.",
	),
	v.check(
		(cfg) =>
			parseTimeOfDayMinutes(cfg.afternoonBreakWindowStart) <
			parseTimeOfDayMinutes(cfg.afternoonBreakWindowEnd),
		"Afternoon break window start must be earlier than end.",
	),
	v.check(
		(cfg) =>
			parseTimeOfDayMinutes(cfg.morningBreakWindowEnd) <=
				parseTimeOfDayMinutes(cfg.lunchWindowStart) &&
			parseTimeOfDayMinutes(cfg.lunchWindowEnd) <=
				parseTimeOfDayMinutes(cfg.afternoonBreakWindowStart),
		"Morning break must finish before the lunch window, and afternoon break must start after it.",
	),
);
export type SchedulingConfiguration = v.InferOutput<
	typeof SchedulingConfigurationSchema
>;

export const UpdateSchedulingConfigurationSchema = v.strictObject({
	expectedRevision: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
	config: SchedulingConfigurationSchema,
});

export interface SchedulingConfigurationRevision {
	revision: number;
	config: SchedulingConfiguration;
}

export function createDefaultSchedulingConfiguration(
	festivalDates: string[] = [],
): SchedulingConfiguration {
	const sortedDates = [...new Set(festivalDates)].sort();
	const wednesday = sortedDates.find((d) => isWednesdayDate(d)) ?? null;
	return {
		festivalDates: sortedDates,
		wednesdayDeadlineDate: wednesday,
		adjudicators: [],
		roomWindows: [],
		classRules: [],
		roomCompatibilityRules: [],
		betweenClassGapMinutes: DEFAULT_BETWEEN_CLASS_GAP_MINUTES,
		accompanistGapMinutes: DEFAULT_ACCOMPANIST_GAP_MINUTES,
		lunchWindowStart: DEFAULT_LUNCH_WINDOW_START,
		lunchWindowEnd: DEFAULT_LUNCH_WINDOW_END,
		morningBreakWindowStart: DEFAULT_MORNING_BREAK_WINDOW_START,
		morningBreakWindowEnd: DEFAULT_MORNING_BREAK_WINDOW_END,
		afternoonBreakWindowStart: DEFAULT_AFTERNOON_BREAK_WINDOW_START,
		afternoonBreakWindowEnd: DEFAULT_AFTERNOON_BREAK_WINDOW_END,
		ensemblePairings: [],
	};
}
