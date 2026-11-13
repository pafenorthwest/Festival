import { randomUUID } from "node:crypto";
import {
	type AccompanistMembershipGrant,
	AppError,
	addCalendarDays,
	assertValidEntitlementGrantSnapshotInput,
	type CreateEntitlementGrantSnapshotInput,
	calendarDateInTimezone,
	calendarDaysUntil,
	deriveEntitlementLifecycle,
	type EntitlementClass,
	type EntitlementGrantSnapshot,
	normalizeVerifiedShopifyIdentityEmail,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS,
} from "@festival/common";
import {
	advanceEntitlementCohort,
	bindMembershipIdentityEmail,
	type InMemoryOrgState,
	type StoredAccompanistEntitlement,
	type StoredTeacherEntitlement,
	withAccompanistLifecycle,
	withTeacherLifecycle,
} from "./in-memory-org-state.js";
import type {
	CreateAccompanistMembershipGrantInput,
	EntitlementRevocationRecord,
	MembershipCustomerContact,
} from "./organization-repository.js";

export function inMemCreateAccompanistMembershipGrant(
	state: InMemoryOrgState,
	input: CreateAccompanistMembershipGrantInput,
): AccompanistMembershipGrant {
	if (input.supersedeGrantId) {
		throw new Error("Superseding accompanist entitlements is not supported.");
	}
	if (
		[...state.accompanistMembershipGrants.values()].some(
			(g) =>
				g.organizationId === input.organizationId &&
				!state.entitlementRevocations.has(g.id) &&
				(g.customerId === input.customerId ||
					g.normalizedEmail === input.normalizedEmail) &&
				g.startsOn < input.endsOn &&
				g.endsOn > input.startsOn,
		)
	) {
		throw new Error("Accompanist membership intervals may not overlap.");
	}
	const { supersedeGrantId: _supersedeGrantId, ...snapshot } = input;
	const grant: StoredAccompanistEntitlement = {
		id: randomUUID(),
		...snapshot,
		divisions: input.divisions.map((division) => ({ ...division })),
		contact: { ...input.contact },
		createdAtIso: new Date().toISOString(),
	};
	bindMembershipIdentityEmail(
		state,
		input.organizationId,
		input.normalizedEmail,
		input.customerId,
	);
	state.accompanistMembershipGrants.set(grant.id, grant);
	advanceEntitlementCohort(
		state,
		grant.organizationId,
		grant.customerId,
		"accompanist_membership",
	);
	return withAccompanistLifecycle(state, grant);
}

function resolveSupersedingEndDate(
	state: InMemoryOrgState,
	input: CreateEntitlementGrantSnapshotInput,
	newGrantId: string,
): { effectiveEndsOn: string; supersededPrior: boolean } {
	const overlapping = [...state.entitlementGrants.values()].filter(
		(g) =>
			g.organizationId === input.organizationId &&
			g.customerId === input.customerId &&
			g.entitlementClass === input.entitlementClass &&
			!state.entitlementRevocations.has(g.id) &&
			!state.entitlementSupersededOn.has(g.id) &&
			g.startsOn < input.endsOn &&
			g.endsOn > input.startsOn,
	);
	const nowIso = state.now().toISOString();
	let effectiveEndsOn = input.endsOn;
	let supersededPrior = false;
	for (const prior of overlapping) {
		if (
			prior.startsOn <= input.startsOn &&
			prior.endsOn > input.startsOn &&
			calendarDaysUntil(input.startsOn, prior.endsOn) <=
				TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS
		) {
			state.entitlementSupersededOn.set(prior.id, input.startsOn);
			state.entitlementSupersededAt.set(prior.id, nowIso);
			state.entitlementSupersededByGrantId.set(prior.id, newGrantId);
			effectiveEndsOn = addCalendarDays(prior.endsOn, input.durationDays);
			supersededPrior = true;
		} else {
			throw new Error(
				"Teacher Membership entitlement intervals may not overlap.",
			);
		}
	}
	return { effectiveEndsOn, supersededPrior };
}

function assertTeacherGrantEligibility(
	state: InMemoryOrgState,
	input: CreateEntitlementGrantSnapshotInput,
): void {
	const offering = state.products.get(input.offeringId);
	if (
		!offering ||
		offering.organizationId !== input.organizationId ||
		offering.entitlementClass !== input.entitlementClass
	) {
		throw new Error(
			"Entitlement offering was not found for this Organization.",
		);
	}
	const division = state.divisions.get(input.divisionId);
	if (!division || division.organizationId !== input.organizationId) {
		throw new Error(
			"Entitlement division was not found for this Organization.",
		);
	}
	if (
		[...state.entitlementGrants.values()].some(
			(g) =>
				g.checkoutIntentId === input.checkoutIntentId ||
				g.shopifyOrderLineGid === input.shopifyOrderLineGid,
		)
	) {
		throw new Error("Entitlement grant correlation is already recorded.");
	}
}

export function inMemCreateEntitlementGrantSnapshot(
	state: InMemoryOrgState,
	input: CreateEntitlementGrantSnapshotInput,
): EntitlementGrantSnapshot {
	assertValidEntitlementGrantSnapshotInput(input);
	const verifiedIdentityEmail = normalizeVerifiedShopifyIdentityEmail(
		input.verifiedIdentityEmail,
	);
	assertTeacherGrantEligibility(state, input);
	const id = randomUUID();
	const { effectiveEndsOn, supersededPrior } = resolveSupersedingEndDate(
		state,
		input,
		id,
	);
	if (
		!supersededPrior &&
		input.endsOn !== addCalendarDays(input.startsOn, input.durationDays)
	) {
		throw new Error(
			"Entitlement endsOn must equal startsOn plus durationDays calendar days.",
		);
	}
	const {
		status: _status,
		verifiedIdentityEmail: _verifiedIdentityEmail,
		...snapshot
	} = input;
	const record: StoredTeacherEntitlement = Object.freeze({
		...snapshot,
		endsOn: effectiveEndsOn,
		id,
		createdAtIso: new Date().toISOString(),
	});
	bindMembershipIdentityEmail(
		state,
		input.organizationId,
		verifiedIdentityEmail,
		input.customerId,
	);
	state.entitlementGrants.set(record.id, record);
	advanceEntitlementCohort(
		state,
		record.organizationId,
		record.customerId,
		record.entitlementClass,
	);
	return withTeacherLifecycle(state, record);
}

export function inMemRevokeEntitlement(
	state: InMemoryOrgState,
	input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	},
): { revocation: EntitlementRevocationRecord; existing: boolean } {
	const teacher = state.entitlementGrants.get(input.entitlementId);
	const accompanist = state.accompanistMembershipGrants.get(
		input.entitlementId,
	);
	const target =
		teacher?.organizationId === input.organizationId
			? {
					entitlementClass: teacher.entitlementClass,
					customerId: teacher.customerId,
					startsOn: teacher.startsOn,
					endsOn: teacher.endsOn,
				}
			: accompanist?.organizationId === input.organizationId
				? {
						entitlementClass: "accompanist_membership" as EntitlementClass,
						customerId: accompanist.customerId,
						startsOn: accompanist.startsOn,
						endsOn: accompanist.endsOn,
					}
				: null;
	if (!target) throw new AppError("Entitlement was not found.", 404);
	const existing = state.entitlementRevocations.get(input.entitlementId);
	if (existing) return { revocation: existing, existing: true };
	const organization = state.organizations.get(input.organizationId);
	if (!organization) throw new AppError("Organization not found.", 404);
	const lifecycle = deriveEntitlementLifecycle(
		target,
		calendarDateInTimezone(state.now().toISOString(), organization.timezone),
	);
	if (lifecycle === "expired") {
		throw new AppError("Expired entitlements cannot be revoked.", 409);
	}
	advanceEntitlementCohort(
		state,
		input.organizationId,
		target.customerId,
		target.entitlementClass,
	);
	const revocation: EntitlementRevocationRecord = {
		id: randomUUID(),
		entitlementId: input.entitlementId,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		reason: input.reason,
		revokedAtIso: input.revokedAtIso,
	};
	state.entitlementRevocations.set(input.entitlementId, revocation);
	return { revocation, existing: false };
}

export function inMemFindMembershipCustomerContacts(
	state: InMemoryOrgState,
	organizationId: string,
	customerIds: string[],
): Map<string, MembershipCustomerContact> {
	const result = new Map<string, MembershipCustomerContact>();
	for (const customerId of customerIds) {
		const stored =
			state.customerContacts.get(`${organizationId}:${customerId}`) ??
			state.customerContacts.get(customerId);
		const name = stored?.name ?? state.customerNames.get(customerId);
		const email =
			stored?.email ??
			state.membershipIdentityEmailsByCustomer.get(
				`${organizationId}:${customerId}`,
			);
		const phone = stored?.phone;
		const city = stored?.city;
		if (
			name !== undefined ||
			email !== undefined ||
			phone !== undefined ||
			city !== undefined ||
			stored !== undefined
		) {
			result.set(customerId, {
				customerId,
				...(name?.trim() ? { name: name.trim() } : {}),
				...(email?.trim() ? { email: email.trim() } : {}),
				...(phone?.trim() ? { phone: phone.trim() } : {}),
				...(city?.trim() ? { city: city.trim() } : {}),
			});
		}
	}
	return result;
}

export function inMemListActiveTeachersForDivision(
	state: InMemoryOrgState,
	organizationId: string,
	divisionId: string,
): Array<{ id: string; name: string }> {
	const activeGrants = [...state.entitlementGrants.values()]
		.filter(
			(g) =>
				g.organizationId === organizationId &&
				g.divisionId === divisionId &&
				g.entitlementClass === TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
		)
		.map((g) => withTeacherLifecycle(state, g))
		.filter((g) => g.status === "active");
	const seen = new Set<string>();
	const result: Array<{ id: string; name: string }> = [];
	for (const grant of activeGrants) {
		if (!seen.has(grant.customerId)) {
			seen.add(grant.customerId);
			result.push({
				id: grant.customerId,
				name: state.customerNames.get(grant.customerId) || "Teacher",
			});
		}
	}
	return result.sort((a, b) => a.name.localeCompare(b.name));
}
