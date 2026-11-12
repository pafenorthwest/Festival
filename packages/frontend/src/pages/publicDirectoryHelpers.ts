import type {
	PublicDirectoryDivisionDto,
	PublicDirectoryProfileDto,
} from "@festival/common";
import type { Resource } from "solid-js";

export interface PartitionedDirectoryProfiles {
	teachers: PublicDirectoryProfileDto[];
	accompanists: PublicDirectoryProfileDto[];
}

export interface DirectoryFilterCriteria {
	query?: string;
	divisionId?: string;
}

function isEligibleDirectoryProfile(
	profile: PublicDirectoryProfileDto,
): boolean {
	if (profile.role === "Teacher") {
		return profile.isActiveMember === true;
	}
	return profile.role === "Accompanist";
}

export function sortProfilesByName(
	profiles: readonly PublicDirectoryProfileDto[],
): PublicDirectoryProfileDto[] {
	return [...profiles].sort(
		(a, b) =>
			a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()) ||
			a.displayName.localeCompare(b.displayName),
	);
}

/**
 * Solid 1.9 resources throw when read in the errored state, so only read
 * the value once the resource is ready.
 */
export function readReadyProfiles(
	resource: Resource<readonly PublicDirectoryProfileDto[]>,
): readonly PublicDirectoryProfileDto[] | undefined {
	return resource.state === "ready" ? resource() : undefined;
}

export function collectDirectoryDivisions(
	profiles?: readonly PublicDirectoryProfileDto[],
): PublicDirectoryDivisionDto[] {
	const byId = new Map<string, PublicDirectoryDivisionDto>();
	for (const profile of profiles ?? []) {
		if (!isEligibleDirectoryProfile(profile)) continue;
		for (const division of profile.approvedDivisions ?? []) {
			if (!byId.has(division.id)) {
				byId.set(division.id, { id: division.id, name: division.name });
			}
		}
	}
	return [...byId.values()].sort(
		(a, b) =>
			a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
			a.name.localeCompare(b.name),
	);
}

export function filterDirectoryProfiles(
	profiles?: readonly PublicDirectoryProfileDto[],
	criteria?: DirectoryFilterCriteria,
): PublicDirectoryProfileDto[] {
	const query = criteria?.query?.trim().toLowerCase() ?? "";
	const divisionId = criteria?.divisionId?.trim() ?? "";

	return (profiles ?? []).filter((profile) => {
		if (!isEligibleDirectoryProfile(profile)) return false;
		const divisions = profile.approvedDivisions ?? [];
		if (divisionId && !divisions.some((d) => d.id === divisionId)) {
			return false;
		}
		if (!query) return true;
		return (
			profile.displayName.toLowerCase().includes(query) ||
			divisions.some((d) => d.name.toLowerCase().includes(query))
		);
	});
}

export function partitionDirectoryProfiles(
	profiles: readonly PublicDirectoryProfileDto[] | undefined,
): PartitionedDirectoryProfiles {
	const list = profiles ?? [];
	return {
		teachers: sortProfilesByName(
			list.filter((p) => p.role === "Teacher" && p.isActiveMember),
		),
		accompanists: sortProfilesByName(
			list.filter((p) => p.role === "Accompanist"),
		),
	};
}
