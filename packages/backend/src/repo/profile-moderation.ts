/**
 * Determines whether an edit to an existing participant profile must be
 * re-moderated. Changing the public display name or the set of divisions
 * (order-insensitive) invalidates any prior approval or rejection.
 */
export function profileEditRequiresReapproval(
	existing: { displayName: string; divisionIds: readonly string[] },
	next: { displayName: string; divisionIds: readonly string[] },
): boolean {
	if (existing.displayName !== next.displayName) {
		return true;
	}
	const existingSet = new Set(existing.divisionIds);
	const nextSet = new Set(next.divisionIds);
	if (existingSet.size !== nextSet.size) {
		return true;
	}
	for (const divisionId of nextSet) {
		if (!existingSet.has(divisionId)) {
			return true;
		}
	}
	return false;
}
