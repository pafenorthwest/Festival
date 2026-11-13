import { TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS } from "@festival/common";
import {
	inMemCreateMembershipProductRecord,
	inMemUpdateMembershipProductRecord,
	inMemUpdateShopifyVerification,
	inMemUpdateShopifyWebhookReadiness,
	inMemUpsertShopifyIntegration,
} from "./in-memory-org-commerce.js";
import {
	inMemCreateAccompanistMembershipGrant,
	inMemCreateEntitlementGrantSnapshot,
	inMemFindMembershipCustomerContacts,
	inMemListActiveTeachersForDivision,
	inMemRevokeEntitlement,
} from "./in-memory-org-commerce-grants.js";
import {
	inMemGetPublicDirectoryProfiles,
	inMemListAccompanistProfiles,
	inMemListTeacherProfiles,
	inMemUpdateAccompanistProfileApproval,
	inMemUpdateTeacherProfileApproval,
	inMemUpsertAccompanistProfile,
	inMemUpsertTeacherProfile,
	withAccompanistContact,
} from "./in-memory-org-profiles.js";
import {
	withAccompanistLifecycle,
	withTeacherLifecycle,
} from "./in-memory-org-state.js";
import { InMemoryTenantCatalogAdapter } from "./in-memory-org-tenant-catalog-adapter.js";
import type {
	MembershipCustomerContact,
	OrganizationRepository,
} from "./organization-repository.js";

/** Profile directory portion of the in-memory OrganizationRepository compatibility adapter. */
class InMemoryOrgProfilesAdapter extends InMemoryTenantCatalogAdapter {
	async getTeacherProfile(organizationId: string, customerId: string) {
		const m = [...this.state.teacherProfiles.values()].find(
			(p) =>
				p.organization_id === organizationId && p.customer_id === customerId,
		);
		return m ? { ...m, division_ids: [...m.division_ids] } : null;
	}
	async getTeacherProfileById(organizationId: string, profileId: string) {
		const m = this.state.teacherProfiles.get(profileId);
		if (!m || m.organization_id !== organizationId) return null;
		return { ...m, division_ids: [...m.division_ids] };
	}
	async upsertTeacherProfile(
		params: Parameters<OrganizationRepository["upsertTeacherProfile"]>[0],
	) {
		return inMemUpsertTeacherProfile(this.state, params);
	}
	async updateTeacherProfileApproval(
		organizationId: string,
		profileId: string,
		approvalStatus: Parameters<
			OrganizationRepository["updateTeacherProfileApproval"]
		>[2],
	) {
		return inMemUpdateTeacherProfileApproval(
			this.state,
			organizationId,
			profileId,
			approvalStatus,
		);
	}
	async listTeacherProfiles(organizationId: string) {
		return inMemListTeacherProfiles(this.state, organizationId);
	}
	async getAccompanistProfile(organizationId: string, customerId: string) {
		const m = [...this.state.accompanistProfiles.values()].find(
			(p) =>
				p.organization_id === organizationId && p.customer_id === customerId,
		);
		return m ? withAccompanistContact(this.state, m) : null;
	}
	async getAccompanistProfileById(organizationId: string, profileId: string) {
		const m = this.state.accompanistProfiles.get(profileId);
		if (!m || m.organization_id !== organizationId) return null;
		return withAccompanistContact(this.state, m);
	}
	async upsertAccompanistProfile(
		params: Parameters<OrganizationRepository["upsertAccompanistProfile"]>[0],
	) {
		return inMemUpsertAccompanistProfile(this.state, params);
	}
	async updateAccompanistProfileApproval(
		organizationId: string,
		profileId: string,
		approvalStatus: Parameters<
			OrganizationRepository["updateAccompanistProfileApproval"]
		>[2],
	) {
		return inMemUpdateAccompanistProfileApproval(
			this.state,
			organizationId,
			profileId,
			approvalStatus,
		);
	}
	async listAccompanistProfiles(organizationId: string) {
		return inMemListAccompanistProfiles(this.state, organizationId);
	}
	async getPublicDirectoryProfiles(organizationId: string) {
		return inMemGetPublicDirectoryProfiles(this.state, organizationId);
	}
}

/** In-memory OrganizationRepository compatibility adapter for non-S09 tests until S14. */
export class InMemoryOrganizationRepository
	extends InMemoryOrgProfilesAdapter
	implements OrganizationRepository
{
	async getShopifyIntegration(organizationId: string) {
		return this.state.shopifyIntegrations.get(organizationId) ?? null;
	}
	async getPublicShopifyCatalogDomain(organizationId: string) {
		const i = this.state.shopifyIntegrations.get(organizationId);
		return i?.verificationStatus === "ok"
			? (i.verifiedShopDomain ?? null)
			: null;
	}
	async upsertShopifyIntegration(
		input: Parameters<OrganizationRepository["upsertShopifyIntegration"]>[0],
	) {
		return inMemUpsertShopifyIntegration(this.state, input);
	}
	async updateShopifyWebhookReadiness(
		input: Parameters<
			OrganizationRepository["updateShopifyWebhookReadiness"]
		>[0],
	) {
		return inMemUpdateShopifyWebhookReadiness(this.state, input);
	}
	async updateShopifyVerification(
		input: Parameters<OrganizationRepository["updateShopifyVerification"]>[0],
	) {
		return inMemUpdateShopifyVerification(this.state, input);
	}
	async createMembershipProductRecord(
		input: Parameters<
			OrganizationRepository["createMembershipProductRecord"]
		>[0],
	) {
		return inMemCreateMembershipProductRecord(this.state, input);
	}
	async listMembershipProductRecords(organizationId: string) {
		return [...this.state.products.values()]
			.filter(
				(p) =>
					p.organizationId === organizationId &&
					p.productCategory === "membership",
			)
			.sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso));
	}
	async updateMembershipProductRecord(
		input: Parameters<
			OrganizationRepository["updateMembershipProductRecord"]
		>[0],
	) {
		return inMemUpdateMembershipProductRecord(this.state, input);
	}
	async findMembershipProductRecordByClass(
		organizationId: string,
		entitlementClass: Parameters<
			OrganizationRepository["findMembershipProductRecordByClass"]
		>[1],
	) {
		return (
			[...this.state.products.values()].find(
				(p) =>
					p.organizationId === organizationId &&
					p.productCategory === "membership" &&
					p.entitlementClass === entitlementClass &&
					p.isActive,
			) ?? null
		);
	}
	async createAccompanistMembershipGrant(
		input: Parameters<
			OrganizationRepository["createAccompanistMembershipGrant"]
		>[0],
	) {
		return inMemCreateAccompanistMembershipGrant(this.state, input);
	}
	async findCurrentAccompanistMembershipGrant(
		input: Parameters<
			OrganizationRepository["findCurrentAccompanistMembershipGrant"]
		>[0],
	) {
		const match = [...this.state.accompanistMembershipGrants.values()]
			.filter(
				(g) =>
					g.organizationId === input.organizationId &&
					g.customerId === input.customerId,
			)
			.sort(
				(a, b) =>
					a.createdAtIso.localeCompare(b.createdAtIso) ||
					a.id.localeCompare(b.id),
			)
			.map((g) => withAccompanistLifecycle(this.state, g))
			.find((g) => g.isCurrent);
		return match
			? {
					...match,
					contact: { ...match.contact },
					divisions: match.divisions.map((d) => ({ ...d })),
				}
			: null;
	}
	async listAccompanistMembershipGrants(
		input: Parameters<
			OrganizationRepository["listAccompanistMembershipGrants"]
		>[0],
	) {
		return [...this.state.accompanistMembershipGrants.values()]
			.map((g) => withAccompanistLifecycle(this.state, g))
			.filter(
				(g) =>
					g.organizationId === input.organizationId &&
					(!input.customerId || g.customerId === input.customerId) &&
					(!input.normalizedEmail ||
						g.normalizedEmail === input.normalizedEmail) &&
					(!input.currentOnly || g.isCurrent),
			)
			.sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso))
			.map((g) => ({
				...g,
				contact: { ...g.contact },
				divisions: g.divisions.map((d) => ({ ...d })),
			}));
	}
	async findProductRecordByShopifyProductGid(shopifyProductGid: string) {
		return (
			[...this.state.products.values()].find(
				(p) => p.shopifyProductGid === shopifyProductGid,
			) ?? null
		);
	}
	async findProductRecordByShopifyVariantGid(shopifyVariantGid: string) {
		return (
			[...this.state.products.values()].find(
				(p) => p.shopifyVariantGid === shopifyVariantGid,
			) ?? null
		);
	}
	async createEntitlementGrantSnapshot(
		input: Parameters<
			OrganizationRepository["createEntitlementGrantSnapshot"]
		>[0],
	) {
		return inMemCreateEntitlementGrantSnapshot(this.state, input);
	}
	async findActiveTeacherEntitlementGrant(
		input: Parameters<
			OrganizationRepository["findActiveTeacherEntitlementGrant"]
		>[0],
	) {
		return (
			[...this.state.entitlementGrants.values()]
				.filter(
					(g) =>
						g.organizationId === input.organizationId &&
						g.customerId === input.customerId &&
						g.entitlementClass === TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS &&
						g.divisionId === input.divisionId,
				)
				.sort(
					(a, b) =>
						a.createdAtIso.localeCompare(b.createdAtIso) ||
						a.id.localeCompare(b.id),
				)
				.map((g) => withTeacherLifecycle(this.state, g))
				.find((g) => g.status === "active") ?? null
		);
	}
	async listEntitlementGrantSnapshots(
		organizationId: string,
		customerId?: string,
	) {
		return [...this.state.entitlementGrants.values()]
			.filter(
				(g) =>
					g.organizationId === organizationId &&
					(!customerId || g.customerId === customerId),
			)
			.sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso))
			.map((g) => withTeacherLifecycle(this.state, g));
	}
	async revokeEntitlement(
		input: Parameters<OrganizationRepository["revokeEntitlement"]>[0],
	) {
		return inMemRevokeEntitlement(this.state, input);
	}
	setCustomerName(customerId: string, name: string): void {
		this.state.customerNames.set(customerId, name);
	}
	setCustomerContact(
		organizationIdOrContact: string | MembershipCustomerContact,
		contact?: MembershipCustomerContact,
	): void {
		if (typeof organizationIdOrContact === "string" && contact) {
			this.state.customerContacts.set(
				`${organizationIdOrContact}:${contact.customerId}`,
				contact,
			);
		} else if (typeof organizationIdOrContact === "object") {
			this.state.customerContacts.set(
				organizationIdOrContact.customerId,
				organizationIdOrContact,
			);
		}
	}
	async findMembershipCustomerContacts(
		organizationId: string,
		customerIds: string[],
	) {
		return inMemFindMembershipCustomerContacts(
			this.state,
			organizationId,
			customerIds,
		);
	}
	async listActiveTeachersForDivision(
		organizationId: string,
		divisionId: string,
	) {
		return inMemListActiveTeachersForDivision(
			this.state,
			organizationId,
			divisionId,
		);
	}
}
