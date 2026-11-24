import {
	buildEffectiveAvailabilityDays,
	countAvailableDays,
	isAvailabilityEnforced,
} from "./availability.js";
import type { SchedulingEnsemblePairing } from "./scheduling.js";
import type { SchedulingDiagnosticIssue } from "./scheduling-preview.js";
import type {
	SchedulingAvailabilityRecord,
	SchedulingReadinessEntry,
	SchedulingReadinessPerson,
	SchedulingRosterEntry,
} from "./scheduling-readiness-types.js";

export function compareText(a: string, b: string): number {
	if (a < b) return -1;
	return a > b ? 1 : 0;
}

/** PEA.x -> PEP.x, SEA.x -> SEP.x, WEA.x -> WEP.x; null for other codes. */
export function primaryCodeForAdditionalCode(code: string): string | null {
	const match = /^([A-Z]+E)A\.(.+)$/.exec(code.trim().toUpperCase());
	return match ? `${match[1]}P.${match[2]}` : null;
}

export interface SchedulingSectionPartition {
	minSections: number;
	maxSections: number;
	feasible: boolean;
}

/**
 * Whether n entries can be split into whole sections each holding min..max
 * entries: some integer k with k*min <= n <= k*max. Zero demand is feasible.
 */
export function schedulingSectionPartition(
	entryCount: number,
	limits: { min: number; max: number },
): SchedulingSectionPartition {
	if (entryCount <= 0)
		return { minSections: 0, maxSections: 0, feasible: true };
	const minSections = Math.ceil(entryCount / limits.max);
	const maxSections = Math.floor(entryCount / limits.min);
	return { minSections, maxSections, feasible: minSections <= maxSections };
}

export function formatDurationSeconds(totalSeconds: number): string {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.round(totalSeconds - minutes * 60);
	return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/**
 * Applies configured ensemble pairings to the readiness entries in place:
 * valid pairings link the additional participant to its primary; invalid or
 * stale pairings and unpaired participants produce blocking issues.
 */
export function linkEnsemblePairings(
	entries: ReadonlyMap<string, SchedulingReadinessEntry>,
	pairings: readonly SchedulingEnsemblePairing[],
	blocking: SchedulingDiagnosticIssue[],
): void {
	const pairingByAdditional = new Map<string, SchedulingEnsemblePairing>();
	const sortedPairings = [...pairings].sort((a, b) =>
		compareText(a.additionalEntitlementId, b.additionalEntitlementId),
	);
	for (const pairing of sortedPairings) {
		const additional = entries.get(pairing.additionalEntitlementId);
		if (!additional) {
			blocking.push({
				code: "stale-ensemble-pairing",
				severity: "error",
				targetId: pairing.additionalEntitlementId,
				message: `Ensemble pairing references registration ${pairing.additionalEntitlementId}, which is not a confirmed registration.`,
			});
			continue;
		}
		if (additional.role !== "additional") {
			blocking.push({
				code: "stale-ensemble-pairing",
				severity: "error",
				targetId: pairing.additionalEntitlementId,
				message: `Ensemble pairing lists registration ${pairing.additionalEntitlementId} (${additional.code ?? "unmapped"}) as an additional participant, but its class is not an additional-participant code.`,
			});
			continue;
		}
		pairingByAdditional.set(pairing.additionalEntitlementId, pairing);
	}

	const additionals = [...entries.values()]
		.filter((entry) => entry.role === "additional")
		.sort((a, b) => compareText(a.entitlementId, b.entitlementId));
	for (const additional of additionals) {
		const pairing = pairingByAdditional.get(additional.entitlementId);
		if (!pairing) {
			blocking.push({
				code: "unpaired-ensemble-participant",
				severity: "error",
				targetId: additional.entitlementId,
				message: `Additional ensemble participant ${additional.childName} (registration ${additional.entitlementId}, ${additional.code}) is not paired with a primary ensemble registration.`,
			});
			continue;
		}
		const primary = entries.get(pairing.primaryEntitlementId);
		if (!primary || primary.role !== "entry") {
			blocking.push({
				code: "stale-ensemble-pairing",
				severity: "error",
				targetId: additional.entitlementId,
				message: primary
					? `Registration ${additional.entitlementId} is paired with ${pairing.primaryEntitlementId}, which is itself an additional participant.`
					: `Registration ${additional.entitlementId} is paired with ${pairing.primaryEntitlementId}, which is not a confirmed registration.`,
			});
			continue;
		}
		const expected = primaryCodeForAdditionalCode(additional.code ?? "");
		if (expected === null || primary.code !== expected) {
			blocking.push({
				code: "ensemble-pairing-code-mismatch",
				severity: "error",
				targetId: additional.entitlementId,
				message: `Registration ${additional.entitlementId} (${additional.code}) is paired with ${primary.entitlementId} (${primary.code ?? "unmapped"}); its primary must be in ${expected ?? "the matching primary code"}.`,
			});
			continue;
		}
		additional.primaryEntitlementId = primary.entitlementId;
		primary.participantEntitlementIds.push(additional.entitlementId);
	}

	for (const entry of entries.values()) {
		if (entry.role !== "entry") continue;
		entry.participantEntitlementIds.sort(compareText);
		entry.hasAge12Plus =
			entry.hasAge12Plus ||
			entry.participantEntitlementIds.some(
				(id) => (entries.get(id)?.age ?? 0) >= 12,
			);
	}
	for (const entry of entries.values()) {
		if (entry.role !== "additional" || !entry.primaryEntitlementId) continue;
		const primary = entries.get(entry.primaryEntitlementId);
		if (primary) entry.hasAge12Plus = primary.hasAge12Plus;
	}
}

interface PersonSeed {
	role: "student" | "accompanist";
	subjectType: "child" | "accompanist";
	subjectId: string;
	name: string | null;
	entitlementIds: string[];
}

function collectPeople(
	roster: readonly SchedulingRosterEntry[],
): Map<string, PersonSeed> {
	const people = new Map<string, PersonSeed>();
	const add = (
		subjectType: "child" | "accompanist",
		subjectId: string,
		name: string | null,
		entitlementId: string,
	) => {
		const key = `${subjectType}\0${subjectId}`;
		const existing = people.get(key);
		if (existing) {
			existing.entitlementIds.push(entitlementId);
			existing.name ??= name;
			return;
		}
		people.set(key, {
			role: subjectType === "child" ? "student" : "accompanist",
			subjectType,
			subjectId,
			name,
			entitlementIds: [entitlementId],
		});
	};
	const sorted = [...roster].sort((a, b) =>
		compareText(a.entitlementId, b.entitlementId),
	);
	for (const entry of sorted) {
		add("child", entry.childId, entry.childName || null, entry.entitlementId);
		const customerId = entry.accompanist?.customerId;
		if (customerId) {
			add(
				"accompanist",
				customerId,
				entry.accompanist?.name ?? null,
				entry.entitlementId,
			);
		}
	}
	return people;
}

/**
 * One row per distinct student (including additional participants) and per
 * resolved accompanist, with effective festival-date availability and the
 * three-day enforcement result. Also reports contradictory saved availability.
 */
export function buildReadinessPeople(
	roster: readonly SchedulingRosterEntry[],
	availability: readonly SchedulingAvailabilityRecord[],
	festivalDates: readonly string[],
	warnings: SchedulingDiagnosticIssue[],
): SchedulingReadinessPerson[] {
	const dates = [...new Set(festivalDates)].sort(compareText);
	const dateSet = new Set(dates);
	const recordsByPerson = new Map<string, SchedulingAvailabilityRecord[]>();
	for (const record of availability) {
		const key = `${record.subjectType}\0${record.subjectId}`;
		const list = recordsByPerson.get(key) ?? [];
		list.push(record);
		recordsByPerson.set(key, list);
	}

	const rows = [...collectPeople(roster).values()].map((seed) => {
		const records =
			recordsByPerson.get(`${seed.subjectType}\0${seed.subjectId}`) ?? [];
		const days = buildEffectiveAvailabilityDays(dates, records);
		const availableDayCount = countAvailableDays(days);
		const label = `${seed.role === "student" ? "Student" : "Accompanist"} ${seed.name ?? seed.subjectId} (${seed.subjectId})`;

		const outside = [
			...new Set(
				records
					.map((record) => record.festivalDate)
					.filter((date) => !dateSet.has(date)),
			),
		].sort(compareText);
		if (outside.length > 0) {
			warnings.push({
				code: "availability-saved-outside-festival-dates",
				severity: "warning",
				targetId: seed.subjectId,
				message: `${label} has saved availability on ${outside.join(", ")}, outside the scheduling festival dates; it is ignored.`,
			});
		}
		if (
			days.length > 0 &&
			days.every(
				(day) => day.provenance === "saved" && day.availableHours.length === 0,
			)
		) {
			warnings.push({
				code: "availability-all-days-empty",
				severity: "warning",
				targetId: seed.subjectId,
				message: `${label} saved every festival date as unavailable; with fewer than three available days, availability is not enforced.`,
			});
		}

		return {
			role: seed.role,
			subjectId: seed.subjectId,
			name: seed.name,
			entitlementIds: seed.entitlementIds,
			availableDayCount,
			days,
			enforced: isAvailabilityEnforced(availableDayCount),
		} satisfies SchedulingReadinessPerson;
	});

	return rows.sort((a, b) =>
		compareText(a.role, b.role) === 0
			? compareText(a.name ?? "", b.name ?? "") ||
				compareText(a.subjectId, b.subjectId)
			: a.role === "student"
				? -1
				: 1,
	);
}
