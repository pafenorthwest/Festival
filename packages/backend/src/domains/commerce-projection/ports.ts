import type {
	CustomerMailingAddress,
	EntitlementClass,
	FestivalClassConfiguration,
	FestivalRecord,
	OrganizationRecord,
	ShopifyCapabilityDiagnostics,
	ShopifyFailureCategory,
	ShopifyVerificationStatus,
	ShopifyWebhookFailureCategory,
	ShopifyWebhookReadinessStatus,
} from "@festival/common";

export interface ProductPortRecord {
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

export interface CreateMembershipProductPortInput {
	organizationId: string;
	entitlementClass: EntitlementClass;
	durationDays: number;
	isActive: boolean;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	productNameSnapshot: string;
}

export interface ShopifyIntegrationPortRecord {
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

export interface UpsertShopifyIntegrationPortInput {
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

export type UpdateShopifyVerificationPortInput =
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

export type UpdateShopifyWebhookReadinessPortInput =
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

export interface CommerceOrganizationPort {
	findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	findOrganizationByShopDomain(
		shopDomain: string,
	): Promise<OrganizationRecord | null>;
	getOrganizationTimezone(organizationId: string): Promise<string>;
	listFestivals(organizationId: string): Promise<FestivalRecord[]>;
	listDivisions(
		organizationId: string,
		activeOnly?: boolean,
	): Promise<Array<{ id: string; displayName: string; isActive: boolean }>>;
	listFestivalClassConfigurations(
		organizationId: string,
		festivalId: string,
		activeOnly?: boolean,
	): Promise<FestivalClassConfiguration[]>;
	findMembershipProductRecordByClass(
		organizationId: string,
		entitlementClass: EntitlementClass,
	): Promise<ProductPortRecord | null>;
	listMembershipProductRecords(
		organizationId: string,
	): Promise<ProductPortRecord[]>;
	createMembershipProductRecord(
		input: CreateMembershipProductPortInput,
	): Promise<ProductPortRecord>;
	updateMembershipProductRecord(input: {
		organizationId: string;
		productId: string;
		productNameSnapshot?: string;
		durationDays?: number;
		isActive?: boolean;
	}): Promise<ProductPortRecord | null>;
	getShopifyIntegration(
		organizationId: string,
	): Promise<ShopifyIntegrationPortRecord | null>;
	upsertShopifyIntegration(
		input: UpsertShopifyIntegrationPortInput,
	): Promise<ShopifyIntegrationPortRecord>;
	updateShopifyVerification(
		input: UpdateShopifyVerificationPortInput,
	): Promise<ShopifyIntegrationPortRecord>;
	updateShopifyWebhookReadiness(
		input: UpdateShopifyWebhookReadinessPortInput,
	): Promise<void>;
	getPublicShopifyCatalogDomain?(
		organizationId: string,
	): Promise<string | null>;
	listEntitlementGrantSnapshots?(input: {
		organizationId: string;
		customerId?: string;
		entitlementClass?: EntitlementClass;
	}): Promise<
		Array<{
			id: string;
			customerId: string;
			divisionIds: string[];
			startsOn: string;
			endsOn: string;
		}>
	>;
	createEntitlementGrantSnapshot?(input: {
		organizationId: string;
		customerId: string;
		entitlementClass: "teacher_membership";
		offeringId: string;
		durationDays: number;
		divisionId: string;
		divisionNameSnapshot: string;
		paidAmount: string;
		currencyCode: string;
		shopifyOrderGid: string;
		shopifyOrderLineGid: string;
		checkoutIntentId: string;
		startsOn: string;
		endsOn: string;
		identityEmail: string;
	}): Promise<{ id: string }>;
}

export interface CommerceCustomerPort {
	getCustomer(
		organizationId: string,
		customerId: string,
	): Promise<{
		id: string;
		organizationId: string;
		shopifyCustomerGid: string | null;
		email: { value: string };
		name: { value: string };
	} | null>;
	getConsentedCustomer?(
		organizationId: string,
		customerId: string,
	): Promise<{ id: string; staffAccessConsent?: boolean } | null>;
	applyCustomerProfile?(input: {
		organizationId: string;
		customerId: string;
		name?: string;
		email?: string;
		phone?: string;
		mailingAddress?: CustomerMailingAddress;
	}): Promise<void>;
	recordStaffAccessConsent?(input: {
		organizationId: string;
		customerId: string;
		consentedAtIso: string;
		source: string;
		referenceId?: string;
	}): Promise<void>;
}
