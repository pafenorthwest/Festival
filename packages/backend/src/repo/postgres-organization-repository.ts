import { defaultPostgresSchemaName } from "../infra/s09-infra.js";
import type { OrganizationRepository } from "./organization-repository.js";
import { PostgresMembershipGrantDelegate } from "./postgres-membership-grant-delegate.js";
import { PostgresProfileDirectoryDelegate } from "./postgres-profile-directory-delegate.js";
import { PostgresShopifyIntegrationDelegate } from "./postgres-shopify-integration-delegate.js";
import { PostgresTenantCatalogFacade } from "./postgres-tenant-catalog-facade.js";

/** PostgreSQL implementation composing S09 domain repositories and S10/S11 delegates. */
export class PostgresOrganizationRepository
	extends PostgresTenantCatalogFacade
	implements OrganizationRepository
{
	private readonly shopifyDelegate: PostgresShopifyIntegrationDelegate;
	private readonly grantDelegate: PostgresMembershipGrantDelegate;
	private readonly profileDelegate: PostgresProfileDirectoryDelegate;

	constructor(schema = defaultPostgresSchemaName()) {
		super(schema);
		this.shopifyDelegate = new PostgresShopifyIntegrationDelegate(
			this.schema,
			this.ensureReadyCallback,
		);
		this.grantDelegate = new PostgresMembershipGrantDelegate(
			this.schema,
			this.ensureReadyCallback,
		);
		this.profileDelegate = new PostgresProfileDirectoryDelegate(
			this.schema,
			this.ensureReadyCallback,
		);
	}

	getShopifyIntegration(
		...args: Parameters<OrganizationRepository["getShopifyIntegration"]>
	) {
		return this.shopifyDelegate.getShopifyIntegration(...args);
	}
	getPublicShopifyCatalogDomain(
		...args: Parameters<OrganizationRepository["getPublicShopifyCatalogDomain"]>
	) {
		return this.shopifyDelegate.getPublicShopifyCatalogDomain(...args);
	}
	upsertShopifyIntegration(
		...args: Parameters<OrganizationRepository["upsertShopifyIntegration"]>
	) {
		return this.shopifyDelegate.upsertShopifyIntegration(...args);
	}
	updateShopifyVerification(
		...args: Parameters<OrganizationRepository["updateShopifyVerification"]>
	) {
		return this.shopifyDelegate.updateShopifyVerification(...args);
	}
	updateShopifyWebhookReadiness(
		...args: Parameters<OrganizationRepository["updateShopifyWebhookReadiness"]>
	) {
		return this.shopifyDelegate.updateShopifyWebhookReadiness(...args);
	}
	createMembershipProductRecord(
		...args: Parameters<OrganizationRepository["createMembershipProductRecord"]>
	) {
		return this.shopifyDelegate.createMembershipProductRecord(...args);
	}
	updateMembershipProductRecord(
		...args: Parameters<OrganizationRepository["updateMembershipProductRecord"]>
	) {
		return this.shopifyDelegate.updateMembershipProductRecord(...args);
	}
	listMembershipProductRecords(
		...args: Parameters<OrganizationRepository["listMembershipProductRecords"]>
	) {
		return this.shopifyDelegate.listMembershipProductRecords(...args);
	}
	findMembershipProductRecordByClass(
		...args: Parameters<
			OrganizationRepository["findMembershipProductRecordByClass"]
		>
	) {
		return this.shopifyDelegate.findMembershipProductRecordByClass(...args);
	}
	createAccompanistMembershipGrant(
		...args: Parameters<
			OrganizationRepository["createAccompanistMembershipGrant"]
		>
	) {
		return this.grantDelegate.createAccompanistMembershipGrant(...args);
	}
	findCurrentAccompanistMembershipGrant(
		...args: Parameters<
			OrganizationRepository["findCurrentAccompanistMembershipGrant"]
		>
	) {
		return this.grantDelegate.findCurrentAccompanistMembershipGrant(...args);
	}
	listAccompanistMembershipGrants(
		...args: Parameters<
			OrganizationRepository["listAccompanistMembershipGrants"]
		>
	) {
		return this.grantDelegate.listAccompanistMembershipGrants(...args);
	}
	findProductRecordByShopifyProductGid(
		...args: Parameters<
			OrganizationRepository["findProductRecordByShopifyProductGid"]
		>
	) {
		return this.shopifyDelegate.findProductRecordByShopifyProductGid(...args);
	}
	findProductRecordByShopifyVariantGid(
		...args: Parameters<
			OrganizationRepository["findProductRecordByShopifyVariantGid"]
		>
	) {
		return this.shopifyDelegate.findProductRecordByShopifyVariantGid(...args);
	}
	createEntitlementGrantSnapshot(
		...args: Parameters<
			OrganizationRepository["createEntitlementGrantSnapshot"]
		>
	) {
		return this.grantDelegate.createEntitlementGrantSnapshot(...args);
	}
	findActiveTeacherEntitlementGrant(
		...args: Parameters<
			OrganizationRepository["findActiveTeacherEntitlementGrant"]
		>
	) {
		return this.grantDelegate.findActiveTeacherEntitlementGrant(...args);
	}
	listEntitlementGrantSnapshots(
		...args: Parameters<OrganizationRepository["listEntitlementGrantSnapshots"]>
	) {
		return this.grantDelegate.listEntitlementGrantSnapshots(...args);
	}
	findMembershipCustomerContacts(
		...args: Parameters<
			OrganizationRepository["findMembershipCustomerContacts"]
		>
	) {
		return this.grantDelegate.findMembershipCustomerContacts(...args);
	}
	revokeEntitlement(
		...args: Parameters<OrganizationRepository["revokeEntitlement"]>
	) {
		return this.grantDelegate.revokeEntitlement(...args);
	}
	listActiveTeachersForDivision(
		...args: Parameters<OrganizationRepository["listActiveTeachersForDivision"]>
	) {
		return this.grantDelegate.listActiveTeachersForDivision(...args);
	}
	getTeacherProfile(
		...args: Parameters<OrganizationRepository["getTeacherProfile"]>
	) {
		return this.profileDelegate.getTeacherProfile(...args);
	}
	getTeacherProfileById(
		...args: Parameters<OrganizationRepository["getTeacherProfileById"]>
	) {
		return this.profileDelegate.getTeacherProfileById(...args);
	}
	upsertTeacherProfile(
		...args: Parameters<OrganizationRepository["upsertTeacherProfile"]>
	) {
		return this.profileDelegate.upsertTeacherProfile(...args);
	}
	updateTeacherProfileApproval(
		...args: Parameters<OrganizationRepository["updateTeacherProfileApproval"]>
	) {
		return this.profileDelegate.updateTeacherProfileApproval(...args);
	}
	listTeacherProfiles(
		...args: Parameters<OrganizationRepository["listTeacherProfiles"]>
	) {
		return this.profileDelegate.listTeacherProfiles(...args);
	}
	getAccompanistProfile(
		...args: Parameters<OrganizationRepository["getAccompanistProfile"]>
	) {
		return this.profileDelegate.getAccompanistProfile(...args);
	}
	getAccompanistProfileById(
		...args: Parameters<OrganizationRepository["getAccompanistProfileById"]>
	) {
		return this.profileDelegate.getAccompanistProfileById(...args);
	}
	upsertAccompanistProfile(
		...args: Parameters<OrganizationRepository["upsertAccompanistProfile"]>
	) {
		return this.profileDelegate.upsertAccompanistProfile(...args);
	}
	updateAccompanistProfileApproval(
		...args: Parameters<
			OrganizationRepository["updateAccompanistProfileApproval"]
		>
	) {
		return this.profileDelegate.updateAccompanistProfileApproval(...args);
	}
	listAccompanistProfiles(
		...args: Parameters<OrganizationRepository["listAccompanistProfiles"]>
	) {
		return this.profileDelegate.listAccompanistProfiles(...args);
	}
	getPublicDirectoryProfiles(
		...args: Parameters<OrganizationRepository["getPublicDirectoryProfiles"]>
	) {
		return this.profileDelegate.getPublicDirectoryProfiles(...args);
	}
}
