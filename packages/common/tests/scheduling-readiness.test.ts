import { describe, expect, it } from "bun:test";
import { safeParse } from "valibot";
import {
	createDefaultSchedulingConfiguration,
	type SchedulingClassRule,
	type SchedulingConfiguration,
	SchedulingConfigurationSchema,
	type SchedulingRoomWindow,
} from "../src/scheduling.js";
import type { SchedulingPreviewContext } from "../src/scheduling-preview.js";
import {
	evaluateSchedulingReadiness,
	primaryCodeForAdditionalCode,
	type SchedulingAvailabilityRecord,
	type SchedulingRosterEntry,
	schedulingSectionPartition,
} from "../src/scheduling-readiness.js";

const DATES = ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07"];

function rule(
	classId: string,
	code: string,
	playingMinutes: number,
	oralMinutes: number,
	sectionLimits: SchedulingClassRule["sectionLimits"] = null,
): SchedulingClassRule {
	return { classId, code, playingMinutes, oralMinutes, sectionLimits };
}

const RULES: SchedulingClassRule[] = [
	rule("cls-ps67", "PS.6-7", 5, 6),
	rule("cls-ps12", "PS.12-13", 10, 7),
	rule("cls-pc16", "PC.16-17", 15, 10),
	rule("cls-pep10", "PEP.10-13", 8, 6),
	rule("cls-pea10", "PEA.10-13", 0, 0),
];

function window(
	date: string,
	startTime = "08:00",
	endTime = "17:00",
	dayType: "full" | "half" = "full",
): SchedulingRoomWindow {
	return {
		id: `win-${date}`,
		festivalDate: date,
		roomId: "room-1",
		adjudicatorId: "adj-1",
		startTime,
		endTime,
		dayType,
		eligibleDivisionIds: [],
		eligibleClassTypes: [],
		concertoEligible: true,
		blockedIntervals: [],
	};
}

function config(
	overrides: Partial<SchedulingConfiguration> = {},
): SchedulingConfiguration {
	return {
		...createDefaultSchedulingConfiguration(DATES),
		adjudicators: [{ id: "adj-1", name: "Judge One", eligibleDivisionIds: [] }],
		roomWindows: DATES.map((date) => window(date)),
		classRules: RULES,
		...overrides,
	};
}

function context(rules: readonly SchedulingClassRule[] = RULES) {
	return {
		rooms: [
			{
				id: "room-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				name: "Main Hall",
				pianoConfigurations: [{ pianoType: "grand", count: 1 }],
				createdAtIso: "2026-01-01T00:00:00Z",
			},
		],
		catalogClasses: rules.map((r) => ({
			id: r.classId,
			displayName: r.code,
			divisionId: "piano",
			performanceMinutes: r.playingMinutes,
			capacity: 10,
			isActive: true,
		})),
	} satisfies SchedulingPreviewContext;
}

function entry(
	entitlementId: string,
	festivalClassId: string,
	overrides: Partial<SchedulingRosterEntry> = {},
): SchedulingRosterEntry {
	return {
		entitlementId,
		festivalClassId,
		childId: `child-${entitlementId}`,
		childName: `Child ${entitlementId}`,
		ageAtRegistration: 10,
		teacherMembershipId: "teacher-1",
		teacherName: "Teacher One",
		accompanist: null,
		repertoireSeconds: 60,
		registeredAtIso: "2026-02-01T00:00:00Z",
		...overrides,
	};
}

function cleanRoster(): SchedulingRosterEntry[] {
	return [
		entry("e-ps67-1", "cls-ps67", { ageAtRegistration: 6 }),
		entry("e-ps67-2", "cls-ps67", { ageAtRegistration: 7 }),
		entry("e-ps67-3", "cls-ps67", { ageAtRegistration: 7 }),
		entry("e-ps12-1", "cls-ps12", {
			ageAtRegistration: 12,
			accompanist: {
				membershipId: "acc-m-1",
				customerId: "acc-cust-1",
				name: "Accompanist One",
			},
		}),
		entry("e-ps12-2", "cls-ps12", { ageAtRegistration: 13 }),
		entry("e-pep-1", "cls-pep10", { ageAtRegistration: 11 }),
		entry("e-pep-2", "cls-pep10", { ageAtRegistration: 10 }),
		entry("e-pea-1", "cls-pea10", { ageAtRegistration: 12 }),
		entry("e-pea-2", "cls-pea10", { ageAtRegistration: 10 }),
	];
}

const CLEAN_PAIRINGS = [
	{ additionalEntitlementId: "e-pea-1", primaryEntitlementId: "e-pep-1" },
	{ additionalEntitlementId: "e-pea-2", primaryEntitlementId: "e-pep-2" },
];

function evaluate(
	options: {
		config?: Partial<SchedulingConfiguration>;
		roster?: SchedulingRosterEntry[];
		availability?: SchedulingAvailabilityRecord[];
	} = {},
) {
	const cfg = config({ ensemblePairings: CLEAN_PAIRINGS, ...options.config });
	return evaluateSchedulingReadiness({
		config: cfg,
		context: context(cfg.classRules),
		roster: options.roster ?? cleanRoster(),
		availability: options.availability ?? [],
	});
}

function codes(issues: readonly { code: string }[]): string[] {
	return issues.map((issue) => issue.code);
}

describe("scheduling ensemble pairings config", () => {
	it("defaults missing pairings to [] and validates uniqueness and self-pairing", () => {
		const { ensemblePairings: _omit, ...legacy } =
			createDefaultSchedulingConfiguration();
		const parsed = safeParse(SchedulingConfigurationSchema, legacy);
		expect(parsed.success).toBe(true);
		expect(parsed.output?.ensemblePairings).toEqual([]);
		expect(createDefaultSchedulingConfiguration().ensemblePairings).toEqual([]);

		const withPairings = (
			ensemblePairings: SchedulingConfiguration["ensemblePairings"],
		) =>
			safeParse(SchedulingConfigurationSchema, {
				...createDefaultSchedulingConfiguration(),
				ensemblePairings,
			}).success;
		expect(withPairings(CLEAN_PAIRINGS)).toBe(true);
		expect(
			withPairings([
				{ additionalEntitlementId: "a", primaryEntitlementId: "p1" },
				{ additionalEntitlementId: "a", primaryEntitlementId: "p2" },
			]),
		).toBe(false);
		expect(
			withPairings([
				{ additionalEntitlementId: "a", primaryEntitlementId: "a" },
			]),
		).toBe(false);
	});

	it("maps additional codes to their primary codes", () => {
		expect(primaryCodeForAdditionalCode("PEA.6-9")).toBe("PEP.6-9");
		expect(primaryCodeForAdditionalCode("SEA.14-17")).toBe("SEP.14-17");
		expect(primaryCodeForAdditionalCode("WEA.9-13")).toBe("WEP.9-13");
		expect(primaryCodeForAdditionalCode("PS.6-7")).toBeNull();
	});
});

describe("evaluateSchedulingReadiness on a clean roster", () => {
	it("allows generation and reports per-code demand, entries, and people", () => {
		const result = evaluate();
		expect(result.blockingIssues).toEqual([]);
		expect(result.warnings).toEqual([]);
		expect(result.canGenerate).toBe(true);

		expect(result.perCode.map((d) => d.code)).toEqual([
			"PC.16-17",
			"PEP.10-13",
			"PS.12-13",
			"PS.6-7",
		]);
		const ps67 = result.perCode.find((d) => d.code === "PS.6-7");
		expect(ps67).toEqual({
			code: "PS.6-7",
			classIds: ["cls-ps67"],
			entryCount: 3,
			participantCount: 0,
			limits: { min: 3, max: 5 },
			minSections: 1,
			maxSections: 1,
			feasible: true,
			// 3 × (5 min + 90 s + 6 min) + one 7-minute gap.
			estimatedSeconds: 3 * (300 + 90 + 360) + 420,
		});
		const pep = result.perCode.find((d) => d.code === "PEP.10-13");
		expect(pep?.entryCount).toBe(2);
		expect(pep?.participantCount).toBe(2);
		const pc = result.perCode.find((d) => d.code === "PC.16-17");
		expect(pc).toMatchObject({
			entryCount: 0,
			feasible: true,
			minSections: 0,
			estimatedSeconds: 0,
		});
		expect(result.totals).toMatchObject({ entryCount: 7, participantCount: 2 });

		const byId = new Map(result.entries.map((e) => [e.entitlementId, e]));
		expect(byId.get("e-pep-1")).toMatchObject({
			role: "entry",
			participantEntitlementIds: ["e-pea-1"],
			hasAge12Plus: true,
		});
		expect(byId.get("e-pep-2")?.hasAge12Plus).toBe(false);
		expect(byId.get("e-pea-1")).toMatchObject({
			role: "additional",
			primaryEntitlementId: "e-pep-1",
			hasAge12Plus: true,
		});
		expect(result.entries[0].code).toBe("PEA.10-13");

		expect(result.people.filter((p) => p.role === "student")).toHaveLength(9);
		const accompanist = result.people.find((p) => p.role === "accompanist");
		expect(accompanist).toMatchObject({
			subjectId: "acc-cust-1",
			name: "Accompanist One",
			entitlementIds: ["e-ps12-1"],
			availableDayCount: 4,
			enforced: true,
		});
	});
});

describe("three-day availability rule", () => {
	const roster = [
		entry("e-1", "cls-ps67", {
			childId: "kid-a",
			accompanist: {
				membershipId: "m-acc",
				customerId: "acc-1",
				name: "Acc",
			},
		}),
		entry("e-2", "cls-ps67", { childId: "kid-b" }),
		entry("e-3", "cls-ps67", { childId: "kid-c" }),
	];
	const empty = (
		subjectType: "child" | "accompanist",
		subjectId: string,
		festivalDate: string,
	): SchedulingAvailabilityRecord => ({
		subjectType,
		subjectId,
		festivalDate,
		availableHours: [],
	});

	it("enforces at exactly three days, not at two, independently per person", () => {
		const result = evaluate({
			roster,
			config: { ensemblePairings: [] },
			availability: [
				empty("child", "kid-a", DATES[0]),
				empty("child", "kid-b", DATES[0]),
				empty("child", "kid-b", DATES[1]),
				empty("accompanist", "acc-1", DATES[2]),
				empty("accompanist", "acc-1", DATES[3]),
				{
					subjectType: "child",
					subjectId: "kid-c",
					festivalDate: DATES[1],
					availableHours: [9, 10],
				},
			],
		});
		const person = (id: string) =>
			result.people.find((p) => p.subjectId === id);
		expect(person("kid-a")).toMatchObject({
			availableDayCount: 3,
			enforced: true,
		});
		expect(person("kid-b")).toMatchObject({
			availableDayCount: 2,
			enforced: false,
		});
		expect(person("acc-1")).toMatchObject({
			role: "accompanist",
			availableDayCount: 2,
			enforced: false,
		});
		expect(person("kid-c")?.days.map((d) => d.provenance)).toEqual([
			"default",
			"saved",
			"default",
			"default",
		]);
		expect(person("kid-c")?.days[1].availableHours).toEqual([9, 10]);
		expect(person("kid-c")?.days[0].availableHours).toEqual([
			8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		expect(person("kid-c")).toMatchObject({
			availableDayCount: 4,
			enforced: true,
		});
		expect(result.canGenerate).toBe(true);
	});

	it("warns about saved dates outside the festival and all-empty availability", () => {
		const result = evaluate({
			roster,
			config: { ensemblePairings: [] },
			availability: [
				...DATES.map((date) => empty("child", "kid-a", date)),
				{
					subjectType: "child",
					subjectId: "kid-b",
					festivalDate: "2026-06-01",
					availableHours: [9],
				},
			],
		});
		expect(result.warnings).toEqual([
			expect.objectContaining({
				code: "availability-all-days-empty",
				targetId: "kid-a",
			}),
			expect.objectContaining({
				code: "availability-saved-outside-festival-dates",
				targetId: "kid-b",
			}),
		]);
		expect(result.canGenerate).toBe(true);
	});
});

describe("section partition feasibility", () => {
	it("finds a whole section count within min..max", () => {
		for (const n of [1, 2]) {
			expect(schedulingSectionPartition(n, { min: 3, max: 5 }).feasible).toBe(
				false,
			);
		}
		for (let n = 3; n <= 12; n += 1) {
			expect(schedulingSectionPartition(n, { min: 3, max: 5 }).feasible).toBe(
				true,
			);
		}
		expect(schedulingSectionPartition(2, { min: 2, max: 3 })).toEqual({
			minSections: 1,
			maxSections: 1,
			feasible: true,
		});
		expect(schedulingSectionPartition(0, { min: 3, max: 5 }).feasible).toBe(
			true,
		);
		expect(schedulingSectionPartition(6, { min: 4, max: 4 }).feasible).toBe(
			false,
		);
	});

	function twoEntryResult(
		playingMinutes: number,
		sectionLimits: SchedulingClassRule["sectionLimits"] = null,
	) {
		return evaluate({
			config: {
				classRules: [
					rule("cls-x", "PS.12-13", playingMinutes, 6, sectionLimits),
				],
				ensemblePairings: [],
			},
			roster: [entry("x-1", "cls-x"), entry("x-2", "cls-x")],
		});
	}

	it("applies the default Playing-time bands at 7.9, 8, 10, and 10.1 minutes", () => {
		const below = twoEntryResult(7.9);
		expect(below.perCode[0]).toMatchObject({
			limits: { min: 3, max: 5 },
			feasible: false,
		});
		expect(below.blockingIssues).toContainEqual(
			expect.objectContaining({
				code: "section-partition-infeasible",
				targetId: "PS.12-13",
			}),
		);
		expect(below.canGenerate).toBe(false);
		// Infeasible codes still report entry time but no section gaps.
		expect(below.perCode[0].estimatedSeconds).toBe(
			2 * (Math.round(7.9 * 60) + 90 + 360),
		);

		for (const [playing, limits] of [
			[8, { min: 2, max: 4 }],
			[10, { min: 2, max: 4 }],
			[10.1, { min: 2, max: 3 }],
		] as const) {
			const result = twoEntryResult(playing);
			expect(result.perCode[0]).toMatchObject({ limits, feasible: true });
			expect(result.canGenerate).toBe(true);
		}
	});

	it("uses per-code overrides instead of the default band", () => {
		expect(twoEntryResult(7.9, { min: 2, max: 5 }).canGenerate).toBe(true);
		const tooFew = twoEntryResult(12, { min: 3, max: 3 });
		expect(tooFew.canGenerate).toBe(false);
		expect(
			tooFew.blockingIssues.find(
				(i) => i.code === "section-partition-infeasible",
			)?.message,
		).toContain("below its section minimum of 3");
	});
});

describe("readiness blocking issues", () => {
	it("blocks unmapped classes, missing age snapshots, and unresolved accompanists", () => {
		const roster = [
			...cleanRoster(),
			entry("e-unmapped", "cls-unknown"),
			entry("e-ps67-4", "cls-ps67", {
				ageAtRegistration: null,
				accompanist: { membershipId: "m-x", customerId: null, name: "X" },
			}),
		];
		const result = evaluate({ roster });
		expect(result.canGenerate).toBe(false);
		expect(result.blockingIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "unmapped-class",
					targetId: "e-unmapped",
				}),
				expect.objectContaining({
					code: "missing-age-snapshot",
					targetId: "e-ps67-4",
				}),
				expect.objectContaining({
					code: "unresolved-accompanist",
					targetId: "e-ps67-4",
				}),
			]),
		);
		expect(result.entries.at(-1)).toMatchObject({
			entitlementId: "e-unmapped",
			code: null,
		});
		expect(
			result.people.some(
				(p) => p.role === "accompanist" && p.subjectId === "m-x",
			),
		).toBe(false);
	});

	it("reports unpaired, mismatched, and stale ensemble pairings", () => {
		const unpaired = evaluate({
			config: { ensemblePairings: [CLEAN_PAIRINGS[0]] },
		});
		expect(unpaired.blockingIssues).toEqual([
			expect.objectContaining({
				code: "unpaired-ensemble-participant",
				targetId: "e-pea-2",
			}),
		]);
		expect(
			unpaired.entries.find((e) => e.entitlementId === "e-pea-2")
				?.primaryEntitlementId,
		).toBeNull();

		const mismatch = evaluate({
			config: {
				ensemblePairings: [
					CLEAN_PAIRINGS[0],
					{
						additionalEntitlementId: "e-pea-2",
						primaryEntitlementId: "e-ps12-1",
					},
				],
			},
		});
		expect(codes(mismatch.blockingIssues)).toEqual([
			"ensemble-pairing-code-mismatch",
		]);
		expect(mismatch.blockingIssues[0].message).toContain("PEP.10-13");

		const stale = evaluate({
			config: {
				ensemblePairings: [
					{ additionalEntitlementId: "e-pea-1", primaryEntitlementId: "gone" },
					{
						additionalEntitlementId: "e-pea-2",
						primaryEntitlementId: "e-pea-1",
					},
					{
						additionalEntitlementId: "e-missing",
						primaryEntitlementId: "e-pep-1",
					},
					{
						additionalEntitlementId: "e-ps12-2",
						primaryEntitlementId: "e-pep-2",
					},
				],
			},
		});
		expect(stale.blockingIssues.map((i) => [i.code, i.targetId])).toEqual([
			["stale-ensemble-pairing", "e-missing"],
			["stale-ensemble-pairing", "e-ps12-2"],
			["stale-ensemble-pairing", "e-pea-1"],
			["stale-ensemble-pairing", "e-pea-2"],
		]);
		expect(stale.canGenerate).toBe(false);
	});

	it("blocks Wednesday concerto demand beyond deadline capacity", () => {
		const roster = Array.from({ length: 6 }, (_, i) =>
			entry(`e-pc-${i}`, "cls-pc16", { ageAtRegistration: 16 }),
		);
		const result = evaluate({
			roster,
			config: {
				ensemblePairings: [],
				roomWindows: [
					window(DATES[0], "09:00", "10:00", "half"),
					window(DATES[1], "09:00", "10:00", "half"),
					window(DATES[2], "09:00", "10:00", "half"),
					window(DATES[3]),
				],
			},
		});
		expect(result.preview.totals.wednesdayConcertoUsableMinutes).toBe(150);
		// 6 × (15 min + 90 s + 10 min) + two 7-minute gaps = 173 min.
		expect(result.totals.wednesdayConcertoEstimatedSeconds).toBe(
			6 * (900 + 90 + 600) + 2 * 420,
		);
		expect(codes(result.blockingIssues)).toEqual([
			"wednesday-concerto-capacity-exceeded",
		]);
		expect(result.canGenerate).toBe(false);
	});

	it("blocks total demand beyond the adjudicator-day budget", () => {
		const roster = Array.from({ length: 5 }, (_, i) =>
			entry(`e-ps-${i}`, "cls-ps67"),
		);
		const result = evaluate({
			roster,
			config: {
				ensemblePairings: [],
				roomWindows: [window(DATES[2], "09:00", "10:00", "half")],
			},
		});
		expect(result.preview.totals.totalUsableMinutes).toBe(50);
		expect(codes(result.blockingIssues)).toEqual([
			"adjudicator-budget-exceeded",
		]);
	});
});

describe("readiness warnings", () => {
	it("warns when repertoire exceeds Scheduling Playing without changing estimates", () => {
		const roster = cleanRoster().map((row) =>
			row.entitlementId === "e-ps12-2"
				? { ...row, repertoireSeconds: 630 }
				: row,
		);
		const baseline = evaluate();
		const result = evaluate({ roster });
		expect(result.canGenerate).toBe(true);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatchObject({
			code: "repertoire-exceeds-scheduling-playing",
			targetId: "e-ps12-2",
		});
		expect(result.warnings[0].message).toContain("e-ps12-2");
		expect(result.warnings[0].message).toContain("10 min 30 s");
		expect(result.warnings[0].message).toContain("Scheduling Playing 10 min");
		expect(result.perCode).toEqual(baseline.perCode);
	});
});
