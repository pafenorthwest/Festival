import { describe, expect, it } from "bun:test";
import { safeParse } from "valibot";
import {
	createDefaultSchedulingConfiguration,
	SCHEDULING_CLASS_DEFAULTS,
	type SchedulingClassRule,
	type SchedulingConfiguration,
	schedulingSectionLimits,
	schedulingSectionSeconds,
	UpdateSchedulingClassRulesSchema,
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
	return safeParse(UpdateSchedulingClassRulesSchema, {
		expectedRevision: 0,
		rules,
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
			expect(result.output?.rules[0]?.sectionLimits).toEqual(sectionLimits);
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
