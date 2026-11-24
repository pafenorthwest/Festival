import { describe, expect, it } from "bun:test";
import type { SchedulingReadinessEntry } from "@festival/common";
import { ApiError } from "../src/lib/api.js";
import {
	availabilityEnforcementLabel,
	buildPairingOptions,
	formatAvailabilityDay,
	formatAvailabilityHours,
	readinessErrorMessage,
	updateEnsemblePairings,
} from "../src/pages/schedulingReviewHelpers.js";

function entry(
	id: string,
	code: string | null,
	role: "entry" | "additional" = "entry",
): SchedulingReadinessEntry {
	return {
		entitlementId: id,
		festivalClassId: `class-${code}`,
		code,
		childId: `child-${id}`,
		childName: `Child ${id}`,
		age: 10,
		teacher: null,
		accompanist: null,
		role,
		primaryEntitlementId: null,
		participantEntitlementIds: [],
		hasAge12Plus: false,
		repertoireSeconds: 0,
		registeredAtIso: "2026-01-01T00:00:00.000Z",
	};
}

describe("buildPairingOptions", () => {
	const additional = entry("ent-a", "PEA.1", "additional");
	const entries = [
		entry("ent-1", "PEP.1"),
		entry("ent-2", "PEP.2"),
		entry("ent-3", "PEA.1", "additional"),
		entry("ent-4", "PEP.1"),
		entry("ent-5", "P1"),
		additional,
	];

	it("offers only confirmed primary entries in the matching primary code", () => {
		expect(
			buildPairingOptions(additional, entries, null).map((o) => o.value),
		).toEqual(["ent-1", "ent-4"]);
	});

	it("keeps a configured primary that is no longer valid as an invalid option", () => {
		const [first, ...rest] = buildPairingOptions(additional, entries, "ent-2");
		expect(first).toEqual({
			value: "ent-2",
			label: "ent-2 (invalid pairing)",
			invalid: true,
		});
		expect(rest.map((o) => o.value)).toEqual(["ent-1", "ent-4"]);
	});

	it("offers nothing for a code without a primary counterpart", () => {
		expect(
			buildPairingOptions(entry("x", null, "additional"), entries, null),
		).toEqual([]);
	});
});

describe("updateEnsemblePairings", () => {
	const pairings = [
		{ additionalEntitlementId: "b", primaryEntitlementId: "p1" },
		{ additionalEntitlementId: "a", primaryEntitlementId: "p2" },
	];

	it("replaces the existing pairing for the additional participant", () => {
		expect(updateEnsemblePairings(pairings, "b", "p3")).toEqual([
			{ additionalEntitlementId: "a", primaryEntitlementId: "p2" },
			{ additionalEntitlementId: "b", primaryEntitlementId: "p3" },
		]);
	});

	it("adds a new pairing and clears one with null", () => {
		expect(updateEnsemblePairings([], "c", "p1")).toEqual([
			{ additionalEntitlementId: "c", primaryEntitlementId: "p1" },
		]);
		expect(updateEnsemblePairings(pairings, "a", null)).toEqual([
			{ additionalEntitlementId: "b", primaryEntitlementId: "p1" },
		]);
		expect(pairings).toHaveLength(2);
	});
});

describe("availability labels", () => {
	it("labels the three-day rule outcome", () => {
		expect(availabilityEnforcementLabel({ enforced: true })).toBe(
			"Enforced (≥3 days)",
		);
		expect(availabilityEnforcementLabel({ enforced: false })).toBe(
			"Not enforced",
		);
	});

	it("merges consecutive hour blocks and marks provenance", () => {
		expect(formatAvailabilityHours([])).toBe("Unavailable");
		expect(formatAvailabilityHours([14, 9, 10, 11])).toBe(
			"9:00 a.m. - 12:00 p.m., 2:00 p.m. - 3:00 p.m.",
		);
		expect(
			formatAvailabilityDay({
				date: "2026-03-10",
				availableHours: [9],
				provenance: "default",
			}),
		).toBe("2026-03-10: 9:00 a.m. - 10:00 a.m. (default)");
	});
});

describe("readinessErrorMessage", () => {
	it("explains a 503 readiness-unavailable response", () => {
		const message = readinessErrorMessage(
			new ApiError("Missing deps.", 503, "scheduling-readiness-unavailable"),
		);
		expect(message).toContain("not available on this server");
		expect(message).toContain("Missing deps.");
	});
});
