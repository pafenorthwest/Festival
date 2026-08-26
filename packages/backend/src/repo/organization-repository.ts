import type {
	AuthenticatedUser,
	CreateEntitlementGrantSnapshotInput,
	EntitlementClass,
	EntitlementGrantSnapshot,
	FestivalRecord,
	OrganizationAdminUserEntry,
	OrganizationDivision,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationUserRecord,
	ShopifyCapabilityDiagnostics,
	ShopifyFailureCategory,
	ShopifyVerificationStatus,
} from "@festival/common";

export interface MembershipWithOrganization {
	membership: OrganizationMembershipRecord;
	organization: OrganizationRecord;
}

export interface InviteWithOrganization {
	invite: OrganizationInviteRecord;
	organization: OrganizationRecord;
}

export interface CreateMembershipInput {
	organizationId: string;
	userId: string;
	role: OrganizationMembershipRecord["role"];
	origin: OrganizationMembershipRecord["origin"];
}

export interface CreateInviteRecordInput {
	organizationId: string;
	email: string;
	role: OrganizationInviteRecord["role"];
	invitedByUserId: string;
}

export interface CreateFestivalRecordInput {
	id: string;
	organizationId: string;
	code: string;
	name: string;
	startDate: string;
	endDate: string;
}

export interface ShopifyIntegrationRecord {
	organizationId: string;
	storeDomain: string;
	clientId: string;
	encryptedClientSecret: string;
	encryptedStorefrontPrivateToken?: string;
	verificationStatus: ShopifyVerificationStatus;
	verifiedShopGid?: string;
	verifiedShopDomain?: string;
	grantedScopes: string[];
	capabilities: ShopifyCapabilityDiagnostics;
	integrationVersion: number;
	verifiedAtIso?: string;
	lastTestedAtIso?: string;
	lastError?: string;
	lastFailureCategory?: ShopifyFailureCategory;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface UpsertShopifyIntegrationInput {
	organizationId: string;
	storeDomain: string;
	clientId: string;
	encryptedClientSecret: string;
	encryptedStorefrontPrivateToken?: string;
}

interface UpdateShopifyVerificationBase {
	organizationId: string;
	lastTestedAtIso: string;
	lastError?: string;
	lastFailureCategory?: ShopifyFailureCategory;
}

export type UpdateShopifyVerificationInput =
	| (UpdateShopifyVerificationBase & {
			verificationStatus: "ok";
			verifiedAtIso: string;
			verifiedShopGid: string;
			verifiedShopDomain: string;
			grantedScopes: string[];
			capabilities: ShopifyCapabilityDiagnostics;
	  })
	| (UpdateShopifyVerificationBase & {
			verificationStatus: "failed";
			verifiedAtIso?: undefined;
			verifiedShopGid?: undefined;
			verifiedShopDomain?: undefined;
			grantedScopes?: undefined;
			capabilities?: undefined;
	  });

export class ShopifyShopOwnershipError extends Error {
	constructor() {
		super("Shopify shop is already assigned to another organization.");
		this.name = "ShopifyShopOwnershipError";
	}
}

export interface ProductRecord {
	id: string;
	organizationId: string;
	productCategory: "membership";
	entitlementClass: EntitlementClass;
	durationDays: number;
	isActive: boolean;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	productNameSnapshot: string;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface CreateMembershipProductRecordInput {
	organizationId: string;
	entitlementClass: EntitlementClass;
	durationDays: number;
	isActive: boolean;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	productNameSnapshot: string;
}

export interface OrganizationRepository {
	ensureReady(): Promise<void>;
	upsertUser(user: AuthenticatedUser): Promise<OrganizationUserRecord>;
	findMembershipByUserId(
		userId: string,
	): Promise<MembershipWithOrganization | null>;
	listMembershipsByUserId(
		userId: string,
	): Promise<MembershipWithOrganization[]>;
	findMembershipByUserAndSlug(
		userId: string,
		slug: string,
	): Promise<MembershipWithOrganization | null>;
	findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	findOrganizationByName(name: string): Promise<OrganizationRecord | null>;
	createOrganization(input: {
		name: string;
		slug: string;
	}): Promise<OrganizationRecord>;
	listDivisions(
		organizationId: string,
		activeOnly?: boolean,
	): Promise<OrganizationDivision[]>;
	createDivision(input: {
		organizationId: string;
		displayName: string;
		normalizedName: string;
	}): Promise<OrganizationDivision>;
	updateDivision(input: {
		organizationId: string;
		divisionId: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
	}): Promise<OrganizationDivision | null>;
	reorderDivisions(
		organizationId: string,
		divisionIds: string[],
	): Promise<OrganizationDivision[]>;
	getOrganizationTimezone(organizationId: string): Promise<string>;
	updateOrganizationTimezone(
		organizationId: string,
		timezone: string,
	): Promise<string>;
	createMembership(
		input: CreateMembershipInput,
	): Promise<OrganizationMembershipRecord>;
	createInvite(
		input: CreateInviteRecordInput,
	): Promise<OrganizationInviteRecord>;
	findInviteByToken(token: string): Promise<InviteWithOrganization | null>;
	markInviteAccepted(token: string): Promise<void>;
	listAdminUsers(
		organizationId: string,
		currentUserId: string,
	): Promise<OrganizationAdminUserEntry[]>;
	deleteMembership(input: {
		organizationId: string;
		membershipId: string;
		currentUserId: string;
	}): Promise<void>;
	cancelInvite(input: {
		organizationId: string;
		inviteId: string;
	}): Promise<void>;
	listFestivals(organizationId: string): Promise<FestivalRecord[]>;
	createFestival(input: CreateFestivalRecordInput): Promise<FestivalRecord>;
	findFestivalByName(
		organizationId: string,
		name: string,
	): Promise<FestivalRecord | null>;
	dismissWelcome(
		userId: string,
		organizationId: string,
	): Promise<OrganizationMembershipRecord>;
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
	findProductRecordByShopifyProductGid(
		shopifyProductGid: string,
	): Promise<ProductRecord | null>;
	findProductRecordByShopifyVariantGid(
		shopifyVariantGid: string,
	): Promise<ProductRecord | null>;
	createEntitlementGrantSnapshot(
		input: CreateEntitlementGrantSnapshotInput,
	): Promise<EntitlementGrantSnapshot>;
	listEntitlementGrantSnapshots(
		organizationId: string,
		customerId: string,
	): Promise<EntitlementGrantSnapshot[]>;
}
