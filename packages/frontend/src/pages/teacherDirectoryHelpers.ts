import type {
	CustomerMembershipStatusEntry,
	PublicOrganizationDivision,
	TeacherProfileRecord,
} from "@festival/common";

export const DEFAULT_TEACHER_DIRECTORY_OPT_IN = true;

export type TeacherVisibilityStatus =
	| "listed"
	| "opted_out"
	| "hidden_by_admin";

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface TeacherDirectoryDraftInput {
	profile: TeacherProfileRecord | null;
	customerName?: string | null;
	activeDivisionIds?: readonly string[];
	pendingOptIn?: boolean | null;
}

export interface TeacherDirectoryDraftState {
	displayName: string;
	publicDirectoryOptIn: boolean;
	divisionIds: string[];
	visibilityStatus: TeacherVisibilityStatus;
}

function pendingOptInStorageKey(orgSlug: string): string {
	return `festival:teacher-directory-opt-in:${orgSlug.trim().toLowerCase()}`;
}
function resolveDefaultStorage<T extends object>(
	explicit?: T | null,
): T | null {
	if (explicit !== undefined) return explicit;
	try {
		return (globalThis.localStorage ?? null) as unknown as T | null;
	} catch {
		return null;
	}
}
export function resolveInitialCheckoutDirectoryOptIn(
	pendingPreference?: boolean | null,
): boolean {
	return typeof pendingPreference === "boolean"
		? pendingPreference
		: DEFAULT_TEACHER_DIRECTORY_OPT_IN;
}
export function readPendingTeacherDirectoryOptIn(
	orgSlug: string,
	storage?: Pick<StorageLike, "getItem"> | null,
): boolean | null {
	try {
		const raw = resolveDefaultStorage(storage)?.getItem(
			pendingOptInStorageKey(orgSlug),
		);
		return raw === "true" ? true : raw === "false" ? false : null;
	} catch {
		return null;
	}
}

export function writePendingTeacherDirectoryOptIn(
	orgSlug: string,
	optIn: boolean,
	storage?: Pick<StorageLike, "setItem"> | null,
): void {
	try {
		resolveDefaultStorage(storage)?.setItem(
			pendingOptInStorageKey(orgSlug),
			optIn ? "true" : "false",
		);
	} catch {}
}

export function clearPendingTeacherDirectoryOptIn(
	orgSlug: string,
	storage?: Pick<StorageLike, "removeItem"> | null,
): void {
	try {
		resolveDefaultStorage(storage)?.removeItem(pendingOptInStorageKey(orgSlug));
	} catch {}
}

export function hasActiveTeacherMembership(
	memberships: readonly CustomerMembershipStatusEntry[],
): boolean {
	return memberships.some(
		(entry) =>
			entry.entitlementClass === "teacher_membership" &&
			entry.status === "active",
	);
}

export function resolveActiveTeacherGrantDivisionIds(
	memberships: readonly CustomerMembershipStatusEntry[],
	divisions: readonly PublicOrganizationDivision[],
): string[] {
	const activeNames = new Set<string>();
	for (const entry of memberships) {
		if (
			entry.entitlementClass === "teacher_membership" &&
			entry.status === "active" &&
			entry.divisionName?.trim()
		) {
			activeNames.add(entry.divisionName.trim().toLowerCase());
		}
	}
	return divisions
		.filter((div) => activeNames.has(div.displayName.trim().toLowerCase()))
		.map((div) => div.id);
}

export function computeTeacherDirectoryVisibility(
	profile: Pick<
		TeacherProfileRecord,
		"public_directory_opt_in" | "approval_status"
	> | null,
): TeacherVisibilityStatus {
	if (!profile) return "opted_out";
	if (profile.approval_status === "rejected") return "hidden_by_admin";
	if (profile.public_directory_opt_in && profile.approval_status === "approved")
		return "listed";
	return "opted_out";
}

export function buildTeacherDirectoryDraft(
	input: TeacherDirectoryDraftInput,
): TeacherDirectoryDraftState {
	if (input.profile) {
		return {
			displayName: input.profile.display_name,
			publicDirectoryOptIn: input.profile.public_directory_opt_in,
			divisionIds: [...input.profile.division_ids],
			visibilityStatus: computeTeacherDirectoryVisibility(input.profile),
		};
	}
	return {
		displayName: (input.customerName ?? "").trim(),
		publicDirectoryOptIn: resolveInitialCheckoutDirectoryOptIn(
			input.pendingOptIn,
		),
		divisionIds: [...(input.activeDivisionIds ?? [])],
		visibilityStatus: computeTeacherDirectoryVisibility(null),
	};
}

const VISIBILITY_BADGES: Record<
	TeacherVisibilityStatus,
	{ label: string; badgeClass: string }
> = {
	listed: { label: "Listed in Public Directory", badgeClass: "badge-active" },
	hidden_by_admin: {
		label: "Hidden by Organization Admin",
		badgeClass: "badge-inactive",
	},
	opted_out: { label: "Opted Out (Hidden)", badgeClass: "badge-inactive" },
};

export function formatTeacherVisibilityBadge(status: TeacherVisibilityStatus) {
	return VISIBILITY_BADGES[status];
}

export function toggleDivisionSelection(
	currentIds: readonly string[],
	divisionId: string,
	checked: boolean,
): string[] {
	const next = new Set(currentIds);
	if (checked) next.add(divisionId);
	else next.delete(divisionId);
	return [...next];
}
