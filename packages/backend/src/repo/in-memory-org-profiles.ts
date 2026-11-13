import { randomUUID } from "node:crypto";
import type {
	AccompanistProfileRecord,
	ProfileApprovalStatus,
	PublicDirectoryDivisionDto,
	PublicDirectoryProfileDto,
	TeacherProfileRecord,
} from "@festival/common";
import {
	AppError,
	getDeterministicTeacherColor,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	validateDisplayName,
	validateDivisionIds,
	validateProfileApprovalStatus,
	validatePublicDirectoryOptIn,
	validatePublicDirectoryProfileDto,
} from "@festival/common";
import type {
	InMemoryOrgState,
	StoredDivision,
} from "./in-memory-org-state.js";
import {
	withAccompanistLifecycle,
	withTeacherLifecycle,
} from "./in-memory-org-state.js";
import type {
	UpsertAccompanistProfileInput,
	UpsertTeacherProfileInput,
} from "./organization-repository.js";
import {
	profileEditRequiresReapproval,
	resolveTeacherProfileApprovalStatus,
} from "./profile-moderation.js";
import {
	compareCodePoint,
	compareDivisionsByName,
	compareProfilesByName,
} from "./profile-ordering.js";

function assertValidDivisionIds(
	state: InMemoryOrgState,
	organizationId: string,
	divisionIds: string[],
): string[] {
	const validated = validateDivisionIds(divisionIds);
	const uniqueIds = [...new Set(validated)];
	for (const divId of uniqueIds) {
		const div = state.divisions.get(divId);
		if (!div || div.organizationId !== organizationId) {
			throw new AppError(
				"One or more divisions do not belong to the organization.",
				400,
				"invalid_division",
			);
		}
	}
	return uniqueIds.sort(compareCodePoint);
}

export function withAccompanistContact(
	state: InMemoryOrgState,
	profile: AccompanistProfileRecord,
): AccompanistProfileRecord {
	const customerKey = `${profile.organization_id}:${profile.customer_id}`;
	const contact =
		state.customerContacts.get(customerKey) ??
		state.customerContacts.get(profile.customer_id);
	const email =
		state.membershipIdentityEmailsByCustomer.get(customerKey) ?? contact?.email;
	const phone = contact?.phone;
	return {
		...profile,
		division_ids: [...profile.division_ids],
		...(phone ? { phone } : {}),
		...(email ? { email } : {}),
	};
}

export function inMemUpsertTeacherProfile(
	state: InMemoryOrgState,
	params: UpsertTeacherProfileInput,
): TeacherProfileRecord {
	const displayName = validateDisplayName(params.displayName);
	const publicDirectoryOptIn = validatePublicDirectoryOptIn(
		params.publicDirectoryOptIn,
	);
	const divisionIds = assertValidDivisionIds(
		state,
		params.organizationId,
		params.divisionIds,
	);
	const existing = [...state.teacherProfiles.values()].find(
		(p) =>
			p.organization_id === params.organizationId &&
			p.customer_id === params.customerId,
	);
	const nowIso = state.now().toISOString();
	const approvalStatus = resolveTeacherProfileApprovalStatus(
		existing?.approval_status,
		publicDirectoryOptIn,
	);
	if (existing) {
		const updated: TeacherProfileRecord = {
			...existing,
			display_name: displayName,
			public_directory_opt_in: publicDirectoryOptIn,
			division_ids: divisionIds,
			teacher_color: getDeterministicTeacherColor(params.customerId),
			approval_status: approvalStatus,
			updated_at: nowIso,
		};
		state.teacherProfiles.set(existing.id, updated);
		return { ...updated, division_ids: [...updated.division_ids] };
	}
	const record: TeacherProfileRecord = {
		id: randomUUID(),
		organization_id: params.organizationId,
		customer_id: params.customerId,
		display_name: displayName,
		teacher_color: getDeterministicTeacherColor(params.customerId),
		public_directory_opt_in: publicDirectoryOptIn,
		approval_status: approvalStatus,
		division_ids: divisionIds,
		created_at: nowIso,
		updated_at: nowIso,
	};
	state.teacherProfiles.set(record.id, record);
	return { ...record, division_ids: [...record.division_ids] };
}

export function inMemUpdateTeacherProfileApproval(
	state: InMemoryOrgState,
	organizationId: string,
	profileId: string,
	approvalStatus: ProfileApprovalStatus,
): TeacherProfileRecord | null {
	const validStatus = validateProfileApprovalStatus(approvalStatus);
	const match = state.teacherProfiles.get(profileId);
	if (!match || match.organization_id !== organizationId) return null;
	const updated: TeacherProfileRecord = {
		...match,
		approval_status: validStatus,
		updated_at: state.now().toISOString(),
	};
	state.teacherProfiles.set(profileId, updated);
	return { ...updated, division_ids: [...updated.division_ids] };
}

export function inMemUpsertAccompanistProfile(
	state: InMemoryOrgState,
	params: UpsertAccompanistProfileInput,
): AccompanistProfileRecord {
	const displayName = validateDisplayName(params.displayName);
	const publicDirectoryOptIn = validatePublicDirectoryOptIn(
		params.publicDirectoryOptIn,
	);
	const divisionIds = assertValidDivisionIds(
		state,
		params.organizationId,
		params.divisionIds,
	);
	const existing = [...state.accompanistProfiles.values()].find(
		(p) =>
			p.organization_id === params.organizationId &&
			p.customer_id === params.customerId,
	);
	const nowIso = state.now().toISOString();
	if (existing) {
		const updated: AccompanistProfileRecord = {
			...existing,
			display_name: displayName,
			public_directory_opt_in: publicDirectoryOptIn,
			division_ids: divisionIds,
			approval_status: profileEditRequiresReapproval(
				{
					displayName: existing.display_name,
					divisionIds: existing.division_ids,
				},
				{ displayName, divisionIds },
			)
				? "pending"
				: existing.approval_status,
			updated_at: nowIso,
		};
		state.accompanistProfiles.set(existing.id, updated);
		return withAccompanistContact(state, updated);
	}
	const record: AccompanistProfileRecord = {
		id: randomUUID(),
		organization_id: params.organizationId,
		customer_id: params.customerId,
		display_name: displayName,
		public_directory_opt_in: publicDirectoryOptIn,
		approval_status: "pending",
		division_ids: divisionIds,
		created_at: nowIso,
		updated_at: nowIso,
	};
	state.accompanistProfiles.set(record.id, record);
	return withAccompanistContact(state, record);
}

export function inMemUpdateAccompanistProfileApproval(
	state: InMemoryOrgState,
	organizationId: string,
	profileId: string,
	approvalStatus: ProfileApprovalStatus,
): AccompanistProfileRecord | null {
	const validStatus = validateProfileApprovalStatus(approvalStatus);
	const match = state.accompanistProfiles.get(profileId);
	if (!match || match.organization_id !== organizationId) return null;
	const updated: AccompanistProfileRecord = {
		...match,
		approval_status: validStatus,
		updated_at: state.now().toISOString(),
	};
	state.accompanistProfiles.set(profileId, updated);
	return withAccompanistContact(state, updated);
}

function resolveDirectoryDivisions(
	state: InMemoryOrgState,
	organizationId: string,
	divisionIds: readonly string[],
): PublicDirectoryDivisionDto[] {
	return divisionIds
		.map((id) => state.divisions.get(id))
		.filter((d): d is StoredDivision =>
			Boolean(d && d.organizationId === organizationId),
		)
		.map((d) => ({ id: d.id, name: d.displayName }))
		.sort(compareDivisionsByName);
}

function listPublicDirectoryTeachers(
	state: InMemoryOrgState,
	organizationId: string,
): PublicDirectoryProfileDto[] {
	const activeTeacherIds = new Set(
		[...state.entitlementGrants.values()]
			.filter(
				(g) =>
					g.organizationId === organizationId &&
					g.entitlementClass === TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			)
			.map((g) => withTeacherLifecycle(state, g))
			.filter((g) => g.status === "active")
			.map((g) => g.customerId),
	);
	return [...state.teacherProfiles.values()]
		.filter(
			(p) =>
				p.organization_id === organizationId &&
				p.public_directory_opt_in &&
				p.approval_status === "approved" &&
				activeTeacherIds.has(p.customer_id),
		)
		.sort(compareProfilesByName)
		.map((tp) =>
			validatePublicDirectoryProfileDto({
				displayName: tp.display_name,
				role: "Teacher",
				approvedDivisions: resolveDirectoryDivisions(
					state,
					organizationId,
					tp.division_ids,
				),
				teacherColor: getDeterministicTeacherColor(tp.customer_id),
				isActiveMember: true,
			}),
		);
}

function listPublicDirectoryAccompanists(
	state: InMemoryOrgState,
	organizationId: string,
): PublicDirectoryProfileDto[] {
	const activeAccompanistIds = new Set(
		[...state.accompanistMembershipGrants.values()]
			.filter((g) => g.organizationId === organizationId)
			.map((g) => withAccompanistLifecycle(state, g))
			.filter((g) => g.status === "active")
			.map((g) => g.customerId),
	);
	return [...state.accompanistProfiles.values()]
		.filter(
			(p) =>
				p.organization_id === organizationId &&
				p.public_directory_opt_in &&
				p.approval_status === "approved",
		)
		.sort(compareProfilesByName)
		.map((ap) =>
			validatePublicDirectoryProfileDto({
				displayName: ap.display_name,
				role: "Accompanist",
				approvedDivisions: resolveDirectoryDivisions(
					state,
					organizationId,
					ap.division_ids,
				),
				isActiveMember: activeAccompanistIds.has(ap.customer_id),
			}),
		);
}

export function inMemGetPublicDirectoryProfiles(
	state: InMemoryOrgState,
	organizationId: string,
): PublicDirectoryProfileDto[] {
	return [
		...listPublicDirectoryTeachers(state, organizationId),
		...listPublicDirectoryAccompanists(state, organizationId),
	];
}

export function inMemListTeacherProfiles(
	state: InMemoryOrgState,
	organizationId: string,
): TeacherProfileRecord[] {
	return [...state.teacherProfiles.values()]
		.filter((p) => p.organization_id === organizationId)
		.sort(compareProfilesByName)
		.map((p) => ({ ...p, division_ids: [...p.division_ids] }));
}

export function inMemListAccompanistProfiles(
	state: InMemoryOrgState,
	organizationId: string,
): AccompanistProfileRecord[] {
	return [...state.accompanistProfiles.values()]
		.filter((p) => p.organization_id === organizationId)
		.sort(compareProfilesByName)
		.map((p) => withAccompanistContact(state, p));
}
