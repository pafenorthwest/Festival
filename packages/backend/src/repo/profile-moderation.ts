import type { ProfileApprovalStatus } from "@festival/common";

/**
 * Resolves teacher profile approval status during a customer profile upsert.
 * Admin-hidden ('rejected') profiles cannot be bypassed by customer edits;
 * opted-in active teachers are auto-approved and remain approved across edits.
 */
export function resolveTeacherProfileApprovalStatus(
	existingStatus: ProfileApprovalStatus | null | undefined,
	publicDirectoryOptIn: boolean,
): ProfileApprovalStatus {
	if (existingStatus === "rejected") {
		return "rejected";
	}
	if (publicDirectoryOptIn) {
		return "approved";
	}
	return existingStatus ?? "pending";
}

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
