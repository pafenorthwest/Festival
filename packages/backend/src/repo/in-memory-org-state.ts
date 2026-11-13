import type {
	AccompanistMembershipGrant,
	AccompanistProfileRecord,
	EntitlementClass,
	EntitlementGrantSnapshot,
	FestivalClassCapacityAuditRecord,
	FestivalClassConfiguration,
	FestivalRecord,
	OrganizationDivision,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationUserRecord,
	RegistrationAgeConfiguration,
	RegistrationCatalogValue,
	TeacherProfileRecord,
} from "@festival/common";
import {
	calendarDateInTimezone,
	deriveEntitlementLifecycle,
} from "@festival/common";
import type {
	AccompanistDivisionPolicyHistoryRecord,
	AccompanistDivisionPolicyRecord,
	EntitlementRevocationRecord,
	MembershipCustomerContact,
	ProductRecord,
	RegistrationCatalogKind,
	ShopifyIntegrationRecord,
} from "./organization-repository.js";

export type StoredTeacherEntitlement = Omit<EntitlementGrantSnapshot, "status">;
export type StoredAccompanistEntitlement = Omit<
	AccompanistMembershipGrant,
	"status" | "isCurrent"
>;
export type StoredDivision = OrganizationDivision & { normalizedName: string };
export type StoredCatalogValue = RegistrationCatalogValue & {
	kind: RegistrationCatalogKind;
	normalizedName: string;
};

/** Shared state bag backing the in-memory OrganizationRepository compatibility adapter. */
export interface InMemoryOrgState {
	readonly now: () => Date;
	readonly users: Map<string, OrganizationUserRecord>;
	readonly usersByUid: Map<string, string>;
	readonly organizations: Map<string, OrganizationRecord>;
	readonly organizationsBySlug: Map<string, string>;
	readonly organizationsByName: Map<string, string>;
	readonly memberships: Map<string, OrganizationMembershipRecord>;
	readonly membershipsByUserId: Map<string, Set<string>>;
	readonly membershipsByUserAndOrganization: Map<string, string>;
	readonly invites: Map<string, OrganizationInviteRecord>;
	readonly invitesByToken: Map<string, string>;
	readonly festivals: Map<string, FestivalRecord>;
	readonly shopifyIntegrations: Map<string, ShopifyIntegrationRecord>;
	readonly products: Map<string, ProductRecord>;
	readonly entitlementGrants: Map<string, StoredTeacherEntitlement>;
	readonly entitlementRevocations: Map<string, EntitlementRevocationRecord>;
	readonly entitlementSupersededOn: Map<string, string>;
	readonly entitlementSupersededAt: Map<string, string>;
	readonly entitlementSupersededByGrantId: Map<string, string>;
	readonly entitlementCohortVersions: Map<string, number>;
	readonly membershipIdentityEmails: Map<string, string>;
	readonly membershipIdentityEmailsByCustomer: Map<string, string>;
	readonly divisions: Map<string, StoredDivision>;
	readonly accompanistPolicies: Map<string, AccompanistDivisionPolicyRecord>;
	readonly accompanistPolicyHistory: AccompanistDivisionPolicyHistoryRecord[];
	readonly accompanistMembershipGrants: Map<
		string,
		StoredAccompanistEntitlement
	>;
	readonly registrationAgeConfigurations: Map<
		string,
		RegistrationAgeConfiguration
	>;
	readonly registrationCatalogValues: Map<string, StoredCatalogValue>;
	readonly festivalClassSubtypeIds: Set<string>;
	readonly festivalClassConfigurations: Map<string, FestivalClassConfiguration>;
	readonly festivalClassCapacityAudits: FestivalClassCapacityAuditRecord[];
	readonly customerContacts: Map<string, MembershipCustomerContact>;
	readonly customerNames: Map<string, string>;
	readonly teacherProfiles: Map<string, TeacherProfileRecord>;
	readonly accompanistProfiles: Map<string, AccompanistProfileRecord>;
}

/** Creates an empty in-memory state container for OrganizationRepository compatibility tests. */
export function createInMemoryOrgState(
	now: () => Date = () => new Date(),
): InMemoryOrgState {
	return {
		now,
		users: new Map(),
		usersByUid: new Map(),
		organizations: new Map(),
		organizationsBySlug: new Map(),
		organizationsByName: new Map(),
		memberships: new Map(),
		membershipsByUserId: new Map(),
		membershipsByUserAndOrganization: new Map(),
		invites: new Map(),
		invitesByToken: new Map(),
		festivals: new Map(),
		shopifyIntegrations: new Map(),
		products: new Map(),
		entitlementGrants: new Map(),
		entitlementRevocations: new Map(),
		entitlementSupersededOn: new Map(),
		entitlementSupersededAt: new Map(),
		entitlementSupersededByGrantId: new Map(),
		entitlementCohortVersions: new Map(),
		membershipIdentityEmails: new Map(),
		membershipIdentityEmailsByCustomer: new Map(),
		divisions: new Map(),
		accompanistPolicies: new Map(),
		accompanistPolicyHistory: [],
		accompanistMembershipGrants: new Map(),
		registrationAgeConfigurations: new Map(),
		registrationCatalogValues: new Map(),
		festivalClassSubtypeIds: new Set(),
		festivalClassConfigurations: new Map(),
		festivalClassCapacityAudits: [],
		customerContacts: new Map(),
		customerNames: new Map(),
		teacherProfiles: new Map(),
		accompanistProfiles: new Map(),
	};
}

export function withAccompanistLifecycle(
	state: InMemoryOrgState,
	grant: StoredAccompanistEntitlement,
): AccompanistMembershipGrant {
	const organization = state.organizations.get(grant.organizationId);
	if (!organization) throw new Error("Organization not found.");
	const status = state.entitlementRevocations.has(grant.id)
		? "revoked"
		: deriveEntitlementLifecycle(
				grant,
				calendarDateInTimezone(
					state.now().toISOString(),
					organization.timezone,
				),
			);
	return { ...grant, status, isCurrent: status === "active" };
}

export function withTeacherLifecycle(
	state: InMemoryOrgState,
	grant: StoredTeacherEntitlement,
): EntitlementGrantSnapshot {
	const organization = state.organizations.get(grant.organizationId);
	if (!organization) throw new Error("Organization not found.");
	const supersededOn =
		state.entitlementSupersededOn.get(grant.id) ?? grant.supersededOn;
	const supersededAt =
		state.entitlementSupersededAt.get(grant.id) ?? grant.supersededAt;
	const supersededByGrantId =
		state.entitlementSupersededByGrantId.get(grant.id) ??
		grant.supersededByGrantId;
	const status = state.entitlementRevocations.has(grant.id)
		? "revoked"
		: deriveEntitlementLifecycle(
				{ ...grant, ...(supersededOn ? { supersededOn } : {}) },
				calendarDateInTimezone(
					state.now().toISOString(),
					organization.timezone,
				),
			);
	return {
		...grant,
		...(supersededOn ? { supersededOn } : {}),
		...(supersededAt !== undefined ? { supersededAt } : {}),
		...(supersededByGrantId !== undefined ? { supersededByGrantId } : {}),
		status,
	};
}

export function advanceEntitlementCohort(
	state: InMemoryOrgState,
	organizationId: string,
	customerId: string,
	entitlementClass: EntitlementClass,
): void {
	const key = `${organizationId}:${customerId}:${entitlementClass}`;
	state.entitlementCohortVersions.set(
		key,
		(state.entitlementCohortVersions.get(key) ?? 0) + 1,
	);
}

export function bindMembershipIdentityEmail(
	state: InMemoryOrgState,
	organizationId: string,
	normalizedEmail: string,
	customerId: string,
): void {
	const emailKey = `${organizationId}:${normalizedEmail}`;
	const customerKey = `${organizationId}:${customerId}`;
	const existingCustomer = state.membershipIdentityEmails.get(emailKey);
	const existingEmail =
		state.membershipIdentityEmailsByCustomer.get(customerKey);
	if (
		(existingCustomer && existingCustomer !== customerId) ||
		(existingEmail && existingEmail !== normalizedEmail)
	) {
		throw new Error("Shopify identity email belongs to another customer.");
	}
	state.membershipIdentityEmails.set(emailKey, customerId);
	state.membershipIdentityEmailsByCustomer.set(customerKey, normalizedEmail);
}
