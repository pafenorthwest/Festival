import {
	type AvailabilityHour,
	type EffectiveAvailabilityDay,
	formatAvailabilityHourBlock,
	primaryCodeForAdditionalCode,
	type SchedulingEnsemblePairing,
	type SchedulingReadinessEntry,
	type SchedulingReadinessPerson,
} from "@festival/common";
import { ApiError } from "../lib/api.js";

export interface PairingOption {
	value: string;
	label: string;
	invalid: boolean;
}

/**
 * Primary-entry choices for an additional ensemble participant: confirmed
 * scheduling entries whose code is the matching primary code (PEA.x -> PEP.x).
 * A currently configured primary that is no longer a valid choice is kept as
 * an invalid option so the select reflects saved state.
 */
export function buildPairingOptions(
	additional: SchedulingReadinessEntry,
	entries: readonly SchedulingReadinessEntry[],
	currentPrimaryId: string | null,
): PairingOption[] {
	const expected = primaryCodeForAdditionalCode(additional.code ?? "");
	const options: PairingOption[] =
		expected === null
			? []
			: entries
					.filter((entry) => entry.role === "entry" && entry.code === expected)
					.map((entry) => ({
						value: entry.entitlementId,
						label: `${entry.entitlementId} · ${entry.childName} (${entry.code})`,
						invalid: false,
					}));
	if (
		currentPrimaryId &&
		!options.some((option) => option.value === currentPrimaryId)
	) {
		options.unshift({
			value: currentPrimaryId,
			label: `${currentPrimaryId} (invalid pairing)`,
			invalid: true,
		});
	}
	return options;
}

/**
 * Returns pairings with the additional participant's pairing replaced by the
 * given primary, or removed when `primaryEntitlementId` is null.
 */
export function updateEnsemblePairings(
	pairings: readonly SchedulingEnsemblePairing[],
	additionalEntitlementId: string,
	primaryEntitlementId: string | null,
): SchedulingEnsemblePairing[] {
	const next = pairings.filter(
		(pairing) => pairing.additionalEntitlementId !== additionalEntitlementId,
	);
	if (primaryEntitlementId) {
		next.push({ additionalEntitlementId, primaryEntitlementId });
	}
	return next.sort((a, b) =>
		a.additionalEntitlementId < b.additionalEntitlementId
			? -1
			: a.additionalEntitlementId > b.additionalEntitlementId
				? 1
				: 0,
	);
}

export function availabilityEnforcementLabel(
	person: Pick<SchedulingReadinessPerson, "enforced">,
): string {
	return person.enforced ? "Enforced (≥3 days)" : "Not enforced";
}

/** Merges consecutive hours into ranges, e.g. "9:00 a.m. - 12:00 p.m.". */
export function formatAvailabilityHours(
	hours: readonly AvailabilityHour[],
): string {
	if (hours.length === 0) return "Unavailable";
	const sorted = [...hours].sort((a, b) => a - b);
	const ranges: Array<[AvailabilityHour, AvailabilityHour]> = [];
	for (const hour of sorted) {
		const last = ranges.at(-1);
		if (last && hour === last[1] + 1) last[1] = hour;
		else ranges.push([hour, hour]);
	}
	return ranges
		.map(([first, last]) => {
			const start = formatAvailabilityHourBlock(first).split(" - ")[0];
			const end = formatAvailabilityHourBlock(last).split(" - ")[1];
			return `${start} - ${end}`;
		})
		.join(", ");
}

export function formatAvailabilityDay(day: EffectiveAvailabilityDay): string {
	return `${day.date}: ${formatAvailabilityHours(day.availableHours)} (${day.provenance})`;
}

export function readinessErrorMessage(cause: unknown): string {
	if (
		cause instanceof ApiError &&
		cause.status === 503 &&
		cause.code === "scheduling-readiness-unavailable"
	) {
		return `Input review is not available on this server yet: ${cause.message}`;
	}
	return cause instanceof Error
		? cause.message
		: "Could not load the scheduling readiness report.";
}
