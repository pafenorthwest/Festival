import type {
	AccompanistProfileRecord,
	OrganizationDivision,
	ProfileApprovalStatus,
	TeacherProfileRecord,
} from "@festival/common";

export type AdminDirectoryModerationProfile =
	| (TeacherProfileRecord & { readonly role: "Teacher" })
	| (AccompanistProfileRecord & { readonly role: "Accompanist" });

export function sortTeacherProfilesByName(
	profiles: readonly TeacherProfileRecord[],
): TeacherProfileRecord[] {
	return [...profiles].sort(
		(a, b) =>
			a.display_name
				.toLowerCase()
				.localeCompare(b.display_name.toLowerCase()) ||
			a.display_name.localeCompare(b.display_name) ||
			a.id.localeCompare(b.id),
	);
}

function sortModerationProfiles(
	profiles: readonly AdminDirectoryModerationProfile[],
): AdminDirectoryModerationProfile[] {
	return [...profiles].sort(
		(a, b) =>
			a.display_name
				.toLowerCase()
				.localeCompare(b.display_name.toLowerCase()) ||
			a.display_name.localeCompare(b.display_name) ||
			a.role.localeCompare(b.role) ||
			a.id.localeCompare(b.id),
	);
}

export function toAdminDirectoryModerationProfiles(
	teachers: readonly TeacherProfileRecord[],
	accompanists: readonly AccompanistProfileRecord[],
): AdminDirectoryModerationProfile[] {
	return sortModerationProfiles([
		...teachers.map((entry) => ({ ...entry, role: "Teacher" as const })),
		...accompanists.map((entry) => ({
			...entry,
			role: "Accompanist" as const,
		})),
	]);
}

export function applyUpdatedModerationProfile(
	profiles: readonly AdminDirectoryModerationProfile[],
	updated: AdminDirectoryModerationProfile,
): AdminDirectoryModerationProfile[] {
	let matched = false;
	const replaced = profiles.map((entry) => {
		if (entry.role === updated.role && entry.id === updated.id) {
			matched = true;
			return updated;
		}
		return entry;
	});
	if (!matched) replaced.push(updated);
	return sortModerationProfiles(replaced);
}

export function nextAdminTeacherApprovalStatus(
	currentStatus: ProfileApprovalStatus,
): ProfileApprovalStatus {
	return currentStatus === "approved" ? "rejected" : "approved";
}

export function applyUpdatedTeacherProfile(
	profiles: readonly TeacherProfileRecord[],
	updated: TeacherProfileRecord,
): TeacherProfileRecord[] {
	let matched = false;
	const replaced = profiles.map((entry) => {
		if (entry.id === updated.id) {
			matched = true;
			return updated;
		}
		return entry;
	});
	if (!matched) replaced.push(updated);
	return sortTeacherProfilesByName(replaced);
}

export function formatTeacherApprovalBadge(status: ProfileApprovalStatus): {
	label: string;
	badgeClass: string;
} {
	switch (status) {
		case "approved":
			return { label: "Approved", badgeClass: "badge-active" };
		case "rejected":
			return { label: "Hidden by Admin", badgeClass: "badge-inactive" };
		default:
			return { label: "Pending", badgeClass: "badge-inactive" };
	}
}

export function formatTeacherModerationActionLabel(
	status: ProfileApprovalStatus,
	updating: boolean,
): string {
	if (updating) return "Updating…";
	if (status === "approved") return "Hide from Directory";
	return status === "rejected" ? "Reinstate" : "Approve";
}

export function resolveTeacherDivisionNames(
	divisionIds: readonly string[],
	divisionsById: ReadonlyMap<string, string>,
): string[] {
	return divisionIds.map((id) => divisionsById.get(id) ?? id);
}

export function buildDivisionNameMap(
	divisions: readonly Pick<OrganizationDivision, "id" | "displayName">[],
): Map<string, string> {
	return new Map(divisions.map((div) => [div.id, div.displayName]));
}
