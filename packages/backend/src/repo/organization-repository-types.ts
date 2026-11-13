import type {
	AccompanistMembershipGrant,
	EntitlementClass,
	ShopifyCapabilityDiagnostics,
	ShopifyFailureCategory,
	ShopifyVerificationStatus,
	ShopifyWebhookFailureCategory,
	ShopifyWebhookReadinessStatus,
} from "@festival/common";

export type {
	CreateFestivalClassCapacityAuditInput,
	CreateFestivalClassConfigurationInput,
	CreateFestivalRecordInput,
	RegistrationCatalogKind,
	UpdateFestivalClassConfigurationInput,
} from "../domains/catalog-repertoire/index.js";
export type {
	AccompanistDivisionPolicyHistoryRecord,
	AccompanistDivisionPolicyRecord,
	CreateInviteRecordInput,
	CreateMembershipInput,
	InviteWithOrganization,
	MembershipWithOrganization,
} from "../domains/tenant-org/index.js";

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
	webhookReadinessStatus: ShopifyWebhookReadinessStatus;
	webhookCheckedAtIso?: string;
	webhookError?: string;
	webhookFailureCategory?: ShopifyWebhookFailureCategory;
	webhookRequestId?: string;
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

export type UpdateShopifyWebhookReadinessInput =
	| {
			organizationId: string;
			status: "checking" | "ready";
			checkedAtIso: string;
			message?: undefined;
			failureCategory?: undefined;
			requestId?: undefined;
	  }
	| {
			organizationId: string;
			status: "failed";
			checkedAtIso: string;
			message: string;
			failureCategory: ShopifyWebhookFailureCategory;
			requestId?: string;
	  };

export class ShopifyShopOwnershipError extends Error {
	constructor() {
		super("Shopify shop is already assigned to another organization.");
		this.name = "ShopifyShopOwnershipError";
	}
}

export class AccompanistMembershipConflictError extends Error {
	constructor() {
		super("An active accompanist membership already exists.");
		this.name = "AccompanistMembershipConflictError";
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

export interface CreateAccompanistMembershipGrantInput
	extends Omit<
		AccompanistMembershipGrant,
		"id" | "createdAtIso" | "status" | "isCurrent"
	> {
	supersedeGrantId?: string;
}

export interface EntitlementRevocationRecord {
	id: string;
	entitlementId: string;
	organizationId: string;
	actorUserId: string;
	reason: string;
	revokedAtIso: string;
}

export interface MembershipCustomerContact {
	customerId: string;
	name?: string;
	email?: string;
	phone?: string;
	city?: string;
}

export interface UpsertProfileInput {
	organizationId: string;
	customerId: string;
	displayName: string;
	publicDirectoryOptIn: boolean;
	divisionIds: string[];
}

export type UpsertTeacherProfileInput = UpsertProfileInput;
export type UpsertAccompanistProfileInput = UpsertProfileInput;
