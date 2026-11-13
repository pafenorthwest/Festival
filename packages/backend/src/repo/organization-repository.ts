import type {
	AccompanistMembershipGrant,
	AccompanistProfileRecord,
	CreateEntitlementGrantSnapshotInput,
	EntitlementClass,
	EntitlementGrantSnapshot,
	ProfileApprovalStatus,
	PublicDirectoryProfileDto,
	TeacherProfileRecord,
} from "@festival/common";
import type {
	DivisionFestivalRepository,
	RegistrationCatalogRepository,
} from "../domains/catalog-repertoire/index.js";
import type {
	AppUserMembershipRepository,
	TenantRepository,
} from "../domains/tenant-org/index.js";
import type {
	CreateAccompanistMembershipGrantInput,
	CreateMembershipProductRecordInput,
	EntitlementRevocationRecord,
	MembershipCustomerContact,
	ProductRecord,
	ShopifyIntegrationRecord,
	UpdateShopifyVerificationInput,
	UpdateShopifyWebhookReadinessInput,
	UpsertAccompanistProfileInput,
	UpsertShopifyIntegrationInput,
	UpsertTeacherProfileInput,
} from "./organization-repository-types.js";

export { assertValidSubtypeDependency } from "../domains/catalog-repertoire/index.js";
export * from "./organization-repository-types.js";

/** Compatibility repository interface composing S09 bounded contexts plus S10/S11 methods. */
export interface OrganizationRepository
	extends TenantRepository,
		AppUserMembershipRepository,
		DivisionFestivalRepository,
		RegistrationCatalogRepository {
	getShopifyIntegration(
		organizationId: string,
	): Promise<ShopifyIntegrationRecord | null>;
	getPublicShopifyCatalogDomain(organizationId: string): Promise<string | null>;
	upsertShopifyIntegration(
		input: UpsertShopifyIntegrationInput,
	): Promise<ShopifyIntegrationRecord>;
	updateShopifyVerification(
		input: UpdateShopifyVerificationInput,
	): Promise<ShopifyIntegrationRecord>;
	updateShopifyWebhookReadiness(
		input: UpdateShopifyWebhookReadinessInput,
	): Promise<ShopifyIntegrationRecord>;
	createMembershipProductRecord(
		input: CreateMembershipProductRecordInput,
	): Promise<ProductRecord>;
	updateMembershipProductRecord(input: {
		organizationId: string;
		productId: string;
		productNameSnapshot?: string;
		durationDays?: number;
		isActive?: boolean;
	}): Promise<ProductRecord | null>;
	listMembershipProductRecords(
		organizationId: string,
	): Promise<ProductRecord[]>;
	findMembershipProductRecordByClass(
		organizationId: string,
		entitlementClass: EntitlementClass,
	): Promise<ProductRecord | null>;
	createAccompanistMembershipGrant(
		input: CreateAccompanistMembershipGrantInput,
	): Promise<AccompanistMembershipGrant>;
	findCurrentAccompanistMembershipGrant(input: {
		organizationId: string;
		customerId: string;
	}): Promise<AccompanistMembershipGrant | null>;
	listAccompanistMembershipGrants(input: {
		organizationId: string;
		customerId?: string;
		normalizedEmail?: string;
		currentOnly?: boolean;
	}): Promise<AccompanistMembershipGrant[]>;
	findProductRecordByShopifyProductGid(
		shopifyProductGid: string,
	): Promise<ProductRecord | null>;
	findProductRecordByShopifyVariantGid(
		shopifyVariantGid: string,
	): Promise<ProductRecord | null>;
	createEntitlementGrantSnapshot(
		input: CreateEntitlementGrantSnapshotInput,
	): Promise<EntitlementGrantSnapshot>;
	findActiveTeacherEntitlementGrant(input: {
		organizationId: string;
		customerId: string;
		divisionId: string;
	}): Promise<EntitlementGrantSnapshot | null>;
	listEntitlementGrantSnapshots(
		organizationId: string,
		customerId?: string,
	): Promise<EntitlementGrantSnapshot[]>;
	findMembershipCustomerContacts(
		organizationId: string,
		customerIds: string[],
	): Promise<Map<string, MembershipCustomerContact>>;
	revokeEntitlement(input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	}): Promise<{ revocation: EntitlementRevocationRecord; existing: boolean }>;
	listActiveTeachersForDivision(
		organizationId: string,
		divisionId: string,
	): Promise<Array<{ id: string; name: string }>>;
	getTeacherProfile(
		organizationId: string,
		customerId: string,
	): Promise<TeacherProfileRecord | null>;
	getTeacherProfileById(
		organizationId: string,
		profileId: string,
	): Promise<TeacherProfileRecord | null>;
	upsertTeacherProfile(
		params: UpsertTeacherProfileInput,
	): Promise<TeacherProfileRecord>;
	updateTeacherProfileApproval(
		organizationId: string,
		profileId: string,
		approvalStatus: ProfileApprovalStatus,
	): Promise<TeacherProfileRecord | null>;
	listTeacherProfiles(organizationId: string): Promise<TeacherProfileRecord[]>;
	getAccompanistProfile(
		organizationId: string,
		customerId: string,
	): Promise<AccompanistProfileRecord | null>;
	getAccompanistProfileById(
		organizationId: string,
		profileId: string,
	): Promise<AccompanistProfileRecord | null>;
	upsertAccompanistProfile(
		params: UpsertAccompanistProfileInput,
	): Promise<AccompanistProfileRecord>;
	updateAccompanistProfileApproval(
		organizationId: string,
		profileId: string,
		approvalStatus: ProfileApprovalStatus,
	): Promise<AccompanistProfileRecord | null>;
	listAccompanistProfiles(
		organizationId: string,
	): Promise<AccompanistProfileRecord[]>;
	getPublicDirectoryProfiles(
		organizationId: string,
	): Promise<PublicDirectoryProfileDto[]>;
}
