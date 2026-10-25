import type { PublicDirectoryProfileDto } from "@festival/common";

export function sortProfilesByName(
	profiles: readonly PublicDirectoryProfileDto[],
): PublicDirectoryProfileDto[] {
	return [...profiles].sort(
		(a, b) =>
			a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()) ||
			a.displayName.localeCompare(b.displayName),
	);
}
