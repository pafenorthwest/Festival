import type { PublicDirectoryProfileDto } from "@festival/common";
import type { Resource } from "solid-js";

export interface PartitionedDirectoryProfiles {
	teachers: PublicDirectoryProfileDto[];
	accompanists: PublicDirectoryProfileDto[];
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

export function partitionDirectoryProfiles(
	profiles: readonly PublicDirectoryProfileDto[] | undefined,
): PartitionedDirectoryProfiles {
	const list = profiles ?? [];
	return {
		teachers: sortProfilesByName(list.filter((p) => p.role === "Teacher")),
		accompanists: sortProfilesByName(
			list.filter((p) => p.role === "Accompanist"),
		),
	};
}
