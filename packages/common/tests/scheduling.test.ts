import { describe, expect, it } from "bun:test";
import { safeParse } from "valibot";
import {
	createDefaultSchedulingConfiguration,
	enumerateDateRange,
	findSchedulingDateIssues,
	findSchedulingReferenceIssues,
	MAX_SCHEDULING_DATE_RANGE_DAYS,
	SCHEDULING_CLASS_DEFAULTS,
	type SchedulingClassRule,
	type SchedulingConfiguration,
	schedulingSectionLimits,
	schedulingSectionSeconds,
	UpdateSchedulingConfigurationSchema,
} from "../src/scheduling.js";
import { evaluateSchedulingConfigPreview } from "../src/scheduling-preview.js";

const baseRule: SchedulingClassRule = {
	classId: "catalog-class-1",
	code: "PS.6-7",
	playingMinutes: 5,
	oralMinutes: 6,
	sectionLimits: null,
};

function validateRules(...rules: SchedulingClassRule[]) {
	return safeParse(UpdateSchedulingConfigurationSchema, {
		expectedRevision: 0,
		config: { ...createDefaultSchedulingConfiguration(), classRules: rules },
	});
}

describe("scheduling class rules", () => {
	it("accepts every Appendix A row with a unique mapping", () => {
		expect(SCHEDULING_CLASS_DEFAULTS).toHaveLength(53);
		const rules = SCHEDULING_CLASS_DEFAULTS.map(
			({ code, playingMinutes, oralMinutes }, index) => ({
				classId: String(index),
				code,
				playingMinutes,
				oralMinutes,
				sectionLimits: null,
			}),
		);
		expect(validateRules(...rules).success).toBe(true);
		expect(
			SCHEDULING_CLASS_DEFAULTS.filter((row) => row.additionalParticipant),
		).toHaveLength(7);
	});

	it("switches section limits at the inclusive 8 and 10 minute boundaries", () => {
		expect(schedulingSectionLimits(7.5)).toEqual({ min: 3, max: 5 });
		expect(schedulingSectionLimits(8)).toEqual({ min: 2, max: 4 });
		expect(schedulingSectionLimits(10)).toEqual({ min: 2, max: 4 });
		expect(schedulingSectionLimits(10.5)).toEqual({ min: 2, max: 3 });
	});

	it("preserves valid overrides independent of Playing time", () => {
		const sectionLimits = { min: 2, max: 5 };
		for (const playingMinutes of [7, 10, 12]) {
			const result = validateRules({
				...baseRule,
				playingMinutes,
				sectionLimits,
			});
			expect(result.output?.config.classRules[0]?.sectionLimits).toEqual(
				sectionLimits,
			);
		}
		for (const invalid of [
			{ min: 0, max: 1 },
			{ min: 2.5, max: 3 },
			{ min: 3, max: 2 },
		]) {
			expect(
				validateRules({ ...baseRule, sectionLimits: invalid }).success,
			).toBe(false);
		}
	});

	it("charges Playing, pooled Oral and a full transition even for the last entry", () => {
		expect(schedulingSectionSeconds(4.1, 2, 3)).toBe(3 * (246 + 90) + 360);
		expect(schedulingSectionSeconds(15, 10, 26)).toBe(689 * 60);
		expect(schedulingSectionSeconds(0, 0, 5)).toBe(0);
	});

	it("requires whole-second timings and no independent timing or limits for additional participants", () => {
		expect(validateRules({ ...baseRule, oralMinutes: 0 }).success).toBe(true);
		expect(validateRules({ ...baseRule, oralMinutes: -1 }).success).toBe(false);
		expect(validateRules({ ...baseRule, playingMinutes: 4.1 }).success).toBe(
			true,
		);
		for (const playingMinutes of [0, -1, 1.001, Infinity]) {
			expect(validateRules({ ...baseRule, playingMinutes }).success).toBe(
				false,
			);
		}
		const additional = {
			...baseRule,
			code: "PEA.6-9",
			playingMinutes: 0,
			oralMinutes: 0,
		};
		expect(validateRules(additional).success).toBe(true);
		expect(validateRules({ ...additional, oralMinutes: 1 }).success).toBe(
			false,
		);
		expect(
			validateRules({ ...additional, sectionLimits: { min: 1, max: 1 } })
				.success,
		).toBe(false);
	});

	it("allows custom codes and rejects duplicate catalog IDs or normalized codes", () => {
		expect(validateRules({ ...baseRule, code: "CX.18-20" }).success).toBe(true);
		expect(
			validateRules(baseRule, { ...baseRule, code: "CX.18-20" }).success,
		).toBe(false);
		expect(
			validateRules(baseRule, {
				...baseRule,
				classId: "other",
				code: " ps.6-7 ",
			}).success,
		).toBe(false);
	});

	it("validates unified scheduling configuration, wednesday deadline, breaks, and concerto splits", () => {
		const baseConfig: SchedulingConfiguration = {
			...createDefaultSchedulingConfiguration(["2027-04-06", "2027-04-07"]),
			adjudicators: [
				{ id: "adj-1", name: "Dr. Chen", eligibleDivisionIds: ["piano"] },
			],
			roomWindows: [
				{
					id: "win-1",
					festivalDate: "2027-04-07",
					roomId: "room-1",
					adjudicatorId: "adj-1",
					startTime: "08:30",
					endTime: "17:00",
					dayType: "full",
					eligibleDivisionIds: ["piano"],
					eligibleClassTypes: ["solo", "concerto"],
					concertoEligible: true,
					blockedIntervals: [
						{ startTime: "16:30", endTime: "17:00", label: "Setup" },
					],
				},
			],
			classRules: [
				{
					classId: "cls-pc",
					code: "PC.16-17",
					playingMinutes: 15,
					oralMinutes: 10,
					sectionLimits: null,
					placementGroupException: {
						maxSectionsPerGroup: null,
						allowTueWedSplit: true,
					},
				},
			],
		};

		expect(
			safeParse(UpdateSchedulingConfigurationSchema, {
				expectedRevision: 0,
				config: baseConfig,
			}).success,
		).toBe(true);

		// Non-Wednesday deadline rejected
		expect(
			safeParse(UpdateSchedulingConfigurationSchema, {
				expectedRevision: 0,
				config: { ...baseConfig, wednesdayDeadlineDate: "2027-04-06" },
			}).success,
		).toBe(false);

		// Tue/Wed split rejected on non-Concerto code
		expect(
			safeParse(UpdateSchedulingConfigurationSchema, {
				expectedRevision: 0,
				config: {
					...baseConfig,
					classRules: [
						{
							...baseRule,
							placementGroupException: {
								maxSectionsPerGroup: 2,
								allowTueWedSplit: true,
							},
						},
					],
				},
			}).success,
		).toBe(false);

		// Invalid lunch/break ordering rejected
		expect(
			safeParse(UpdateSchedulingConfigurationSchema, {
				expectedRevision: 0,
				config: {
					...baseConfig,
					morningBreakWindowEnd: "12:00",
					lunchWindowStart: "11:45",
				},
			}).success,
		).toBe(false);
	});

	it("evaluates room/adjudicator overlaps, missing references, 440-min budget, and concerto capacity warnings", () => {
		const cfg: SchedulingConfiguration = {
			...createDefaultSchedulingConfiguration([
				"2027-04-06",
				"2027-04-07",
				"2027-04-08",
			]),
			wednesdayDeadlineDate: "2027-04-07",
			adjudicators: [
				{ id: "adj-1", name: "Dr. Chen", eligibleDivisionIds: ["piano"] },
			],
			roomWindows: [
				{
					id: "win-1",
					festivalDate: "2027-04-07",
					roomId: "room-1",
					adjudicatorId: "adj-1",
					startTime: "08:00",
					endTime: "17:00", // 540 raw - 50 full-day break/lunch = 490 -> capped to 440
					dayType: "full",
					eligibleDivisionIds: ["piano"],
					eligibleClassTypes: ["solo", "concerto"],
					concertoEligible: true,
					blockedIntervals: [],
				},
				{
					id: "win-2",
					festivalDate: "2027-04-07",
					roomId: "room-1", // overlaps win-1
					adjudicatorId: "", // missing adjudicator
					startTime: "13:00",
					endTime: "16:00", // 180 raw - 10 half-day break = 170
					dayType: "half",
					eligibleDivisionIds: ["piano"],
					eligibleClassTypes: ["solo"],
					concertoEligible: false,
					blockedIntervals: [],
				},
			],
			classRules: [
				{
					classId: "cls-pc16",
					code: "PC.16-17",
					playingMinutes: 15,
					oralMinutes: 10,
					sectionLimits: null,
				},
			],
			roomCompatibilityRules: [
				{
					id: "compat-1",
					scopeType: "class_code",
					scopeValue: "PC.16-17",
					requiredPianoType: "grand",
					minimumPianoCount: 2,
					allowedAdjudicatorIds: ["adj-1"],
				},
			],
		};

		const preview = evaluateSchedulingConfigPreview(cfg, {
			rooms: [
				{
					id: "room-1",
					organizationId: "org-1",
					festivalId: "fest-1",
					name: "Main Hall",
					pianoConfigurations: [{ pianoType: "grand", count: 2 }],
					createdAtIso: "2026-01-01T00:00:00Z",
				},
			],
			catalogClasses: [
				{
					id: "cls-pc16",
					organizationId: "org-1",
					festivalId: "fest-1",
					displayName: "Piano Concerto 16-17",
					classSubtypeId: "concerto",
					divisionId: "piano",
					minimumAge: 16,
					maximumAge: 17,
					price: "50",
					maximumPerformancePieces: 1,
					performanceMinutes: 15,
					capacity: 26,
					isActive: true,
					shopifyProductGid: "p1",
					shopifyVariantGid: "v1",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			],
		});

		expect(preview.windowSummaries[0].usableSchedulingMinutes).toBe(440);
		expect(preview.windowSummaries[1].usableSchedulingMinutes).toBe(170);
		expect(preview.totals.wednesdayConcertoUsableMinutes).toBe(440);
		expect(
			preview.blockingIssues.some((i) => i.code === "room-window-overlap"),
		).toBe(true);
		expect(
			preview.blockingIssues.some(
				(i) => i.code === "missing-adjudicator-reference",
			),
		).toBe(true);
		expect(preview.effectiveClassRules[0].estimatedTotalSecondsAtCapacity).toBe(
			689 * 60,
		);
		expect(
			preview.effectiveClassRules[0].exceedsSingleDayBudgetAtCapacity,
		).toBe(true);
		expect(preview.effectiveClassRules[0].compatibleWindowCount).toBe(1);
		expect(
			preview.warnings.some(
				(w) => w.code === "concerto-capacity-exceeds-single-day",
			),
		).toBe(true);
	});
});

describe("scheduling config dates and references", () => {
	const refConfig: SchedulingConfiguration = {
		...createDefaultSchedulingConfiguration(["2027-04-06", "2027-04-07"]),
		adjudicators: [{ id: "adj-1", name: "Dr. Chen", eligibleDivisionIds: [] }],
		roomWindows: [
			{
				id: "win-1",
				festivalDate: "2027-04-07",
				roomId: "room-1",
				adjudicatorId: "adj-1",
				startTime: "08:00",
				endTime: "12:00",
				dayType: "half",
				eligibleDivisionIds: [],
				eligibleClassTypes: [],
				concertoEligible: true,
				blockedIntervals: [],
			},
		],
		classRules: [{ ...baseRule }],
		roomCompatibilityRules: [
			{
				id: "compat-1",
				scopeType: "class_code",
				scopeValue: "PS.6-7",
				requiredPianoType: null,
				minimumPianoCount: 1,
				allowedAdjudicatorIds: ["adj-1"],
			},
		],
	};
	const range = {
		festivalStartDate: "2027-04-05",
		festivalEndDate: "2027-04-09",
	};
	const previewContext = { rooms: [], catalogClasses: [], ...range };
	const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

	it("accepts a consistent configuration", () => {
		expect(findSchedulingDateIssues(refConfig, range)).toEqual([]);
		expect(findSchedulingReferenceIssues(refConfig)).toEqual([]);
	});

	it("flags festival dates outside the festival only when the range is known", () => {
		const cfg = { ...refConfig, festivalDates: ["2027-04-07", "2027-04-12"] };
		expect(findSchedulingDateIssues(cfg, range)).toEqual([
			expect.objectContaining({
				code: "festival-date-outside-festival",
				path: "festivalDates[1]",
			}),
		]);
		expect(findSchedulingDateIssues(cfg)).toEqual([]);
		expect(
			codes(
				evaluateSchedulingConfigPreview(cfg, previewContext).blockingIssues,
			),
		).toContain("festival-date-outside-festival");
		expect(
			codes(
				evaluateSchedulingConfigPreview(cfg, { rooms: [], catalogClasses: [] })
					.blockingIssues,
			),
		).not.toContain("festival-date-outside-festival");
	});

	it("flags a Wednesday deadline that is not a selected festival date", () => {
		const cfg = { ...refConfig, festivalDates: ["2027-04-06"] };
		expect(findSchedulingDateIssues(cfg, range)).toEqual([
			expect.objectContaining({
				code: "wednesday-deadline-not-in-festival-dates",
				path: "wednesdayDeadlineDate",
			}),
		]);
		expect(
			codes(
				evaluateSchedulingConfigPreview(cfg, previewContext).blockingIssues,
			),
		).toContain("wednesday-deadline-not-in-festival-dates");
	});

	it("flags unknown adjudicators in room windows and compatibility rules", () => {
		const cfg: SchedulingConfiguration = {
			...refConfig,
			roomWindows: [{ ...refConfig.roomWindows[0], adjudicatorId: "ghost" }],
			roomCompatibilityRules: [
				{
					...refConfig.roomCompatibilityRules[0],
					allowedAdjudicatorIds: ["adj-1", "phantom"],
				},
			],
		};
		expect(findSchedulingReferenceIssues(cfg)).toEqual([
			expect.objectContaining({
				code: "unknown-window-adjudicator",
				path: "roomWindows[0].adjudicatorId",
			}),
			expect.objectContaining({
				code: "unknown-compatibility-adjudicator",
				path: "roomCompatibilityRules[0].allowedAdjudicatorIds[1]",
			}),
		]);
		const blocking = codes(
			evaluateSchedulingConfigPreview(cfg, previewContext).blockingIssues,
		);
		expect(blocking).toContain("unknown-compatibility-adjudicator");
		expect(blocking).toContain("missing-adjudicator-reference");
		expect(blocking).not.toContain("unknown-window-adjudicator");
	});

	it("flags class_code scopes without a matching class rule", () => {
		const cfg: SchedulingConfiguration = {
			...refConfig,
			roomCompatibilityRules: [
				{ ...refConfig.roomCompatibilityRules[0], scopeValue: "PC.16-17" },
			],
		};
		expect(findSchedulingReferenceIssues(cfg)).toEqual([
			expect.objectContaining({
				code: "unknown-compatibility-class-code",
				path: "roomCompatibilityRules[0].scopeValue",
			}),
		]);
		expect(
			findSchedulingReferenceIssues({
				...cfg,
				roomCompatibilityRules: [
					{ ...cfg.roomCompatibilityRules[0], scopeValue: " ps.6-7 " },
				],
			}),
		).toEqual([]);
	});

	it("restricts class_type scopes to the inferred class types", () => {
		const parse = (scopeValue: string) =>
			safeParse(UpdateSchedulingConfigurationSchema, {
				expectedRevision: 0,
				config: {
					...refConfig,
					roomCompatibilityRules: [
						{
							...refConfig.roomCompatibilityRules[0],
							scopeType: "class_type",
							scopeValue,
						},
					],
				},
			});
		for (const value of ["solo", "concerto", "ensemble"]) {
			expect(parse(value).success).toBe(true);
		}
		const invalid = parse("chamber");
		expect(invalid.success).toBe(false);
		expect(invalid.issues?.[0]?.path?.map((p) => p.key)).toEqual([
			"config",
			"roomCompatibilityRules",
			0,
			"scopeValue",
		]);
	});

	it("warns when a class rule uses a code outside the default table", () => {
		const cfg: SchedulingConfiguration = {
			...refConfig,
			classRules: [{ ...baseRule, code: "CX.18-20" }],
			roomCompatibilityRules: [],
		};
		const preview = evaluateSchedulingConfigPreview(cfg, previewContext);
		const warning = preview.warnings.find(
			(w) => w.code === "custom-class-code",
		);
		expect(warning?.message).toContain("custom code");
		expect(
			codes(
				evaluateSchedulingConfigPreview(refConfig, previewContext).warnings,
			),
		).not.toContain("custom-class-code");
	});

	it("enumerates long date ranges without truncation and rejects oversized ones", () => {
		const dates = enumerateDateRange("2027-03-01", "2027-04-15");
		expect(dates).toHaveLength(46);
		expect(dates.at(-1)).toBe("2027-04-15");
		expect(enumerateDateRange("2027-01-01", "2027-12-31")).toHaveLength(365);
		expect(MAX_SCHEDULING_DATE_RANGE_DAYS).toBe(366);
		expect(() => enumerateDateRange("2027-01-01", "2028-01-02")).toThrow(
			RangeError,
		);
		expect(enumerateDateRange("2027-04-09", "2027-04-05")).toEqual([]);
	});
});
