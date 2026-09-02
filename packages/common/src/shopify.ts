export const SHOPIFY_VERIFICATION_STATUSES = [
	"unknown",
	"ok",
	"failed",
] as const;

export type ShopifyVerificationStatus =
	(typeof SHOPIFY_VERIFICATION_STATUSES)[number];

export const SHOPIFY_ADMIN_CAPABILITIES = [
	"read_products",
	"write_products",
	"read_orders",
	"write_orders",
] as const;

export type ShopifyAdminCapability =
	(typeof SHOPIFY_ADMIN_CAPABILITIES)[number];
export type ShopifyCapabilityStatus = "granted" | "missing" | "disabled";
export type ShopifyCapabilityDiagnostics = Record<
	ShopifyAdminCapability,
	ShopifyCapabilityStatus
>;

export const EMPTY_SHOPIFY_CAPABILITIES: ShopifyCapabilityDiagnostics = {
	read_products: "missing",
	write_products: "missing",
	read_orders: "missing",
	write_orders: "disabled",
};

export function normalizeEffectiveShopifyScopes(
	grantedScopes: readonly string[],
): string[] {
	const scopes = new Set(grantedScopes);
	if (scopes.has("write_products")) {
		scopes.add("read_products");
	}
	return [...scopes].sort();
}

export function deriveShopifyCapabilities(
	grantedScopes: readonly string[],
): ShopifyCapabilityDiagnostics {
	const scopes = new Set(normalizeEffectiveShopifyScopes(grantedScopes));
	return {
		read_products: scopes.has("read_products") ? "granted" : "missing",
		write_products: scopes.has("write_products") ? "granted" : "missing",
		read_orders: scopes.has("read_orders") ? "granted" : "missing",
		write_orders: "disabled",
	};
}

export const SHOPIFY_FAILURE_CATEGORIES = [
	"credentials",
	"identity_mismatch",
	"shop_ownership_conflict",
	"missing_scope",
	"transport",
	"upstream",
] as const;

export type ShopifyFailureCategory =
	(typeof SHOPIFY_FAILURE_CATEGORIES)[number];

export interface ShopifyIntegrationSettings {
	storeDomain: string;
	clientId: string;
	hasClientSecret: boolean;
	hasStorefrontPrivateToken: boolean;
	verificationStatus: ShopifyVerificationStatus;
	verifiedShopGid?: string;
	verifiedShopDomain?: string;
	capabilities: ShopifyCapabilityDiagnostics;
	integrationVersion: number;
	verifiedAtIso?: string;
	lastTestedAtIso?: string;
	lastError?: string;
	lastFailureCategory?: ShopifyFailureCategory;
	updatedAtIso: string;
}

export interface ShopifyIntegrationSettingsResponse {
	settings: ShopifyIntegrationSettings | null;
}

export interface SaveShopifyIntegrationInput {
	storeUrl: string;
	clientId: string;
	clientSecret?: string;
	storefrontPrivateToken?: string;
}

export interface SaveShopifyIntegrationResponse {
	settings: ShopifyIntegrationSettings;
}

export const SHOPIFY_INTEGRATION_DIAGNOSTIC_IDS = [
	"orders_paid_webhook",
	"public_storefront_access",
] as const;

export type ShopifyIntegrationDiagnosticId =
	(typeof SHOPIFY_INTEGRATION_DIAGNOSTIC_IDS)[number];

export interface ShopifyIntegrationDiagnosticCheck {
	id: ShopifyIntegrationDiagnosticId;
	status: "passed" | "failed";
	message: string;
}

export interface ShopifyIntegrationDiagnosticsResponse {
	checks: ShopifyIntegrationDiagnosticCheck[];
}

export interface ShopifySettingsValidation {
	valid: boolean;
	errors: string[];
	storeDomain: string;
	clientId: string;
	clientSecret?: string;
	storefrontPrivateToken?: string;
}

export const SHOPIFY_PRODUCT_STATUSES = [
	"ACTIVE",
	"DRAFT",
	"ARCHIVED",
] as const;

export type ShopifyProductStatus = (typeof SHOPIFY_PRODUCT_STATUSES)[number];

export interface MoneyPayload {
	amount: string;
	currencyCode: string;
}

export interface CreateMembershipProductInput {
	name: string;
	description?: string;
	price: string;
}

export interface MembershipProductSummary {
	id: string;
	name: string;
	description?: string;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
	variantName: "Standard";
	entitlementClass: EntitlementClass;
	durationDays: number;
	isActive: boolean;
	price: MoneyPayload;
	status?: ShopifyProductStatus;
	createdAtIso: string;
}

export interface CreateMembershipProductResponse {
	membershipProduct: MembershipProductSummary;
}

export interface MembershipProductsListResponse {
	organization: {
		id: string;
		slug: string;
		name: string;
	};
	membershipProducts: MembershipProductSummary[];
}

export interface PublicMembershipProductSummary {
	id: string;
	name: string;
	description?: string;
	entitlementClass: typeof TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS;
	durationDays: number;
	available: boolean;
	price: MoneyPayload;
}

export interface PublicMembershipProductsListResponse {
	organization: {
		slug: string;
		name: string;
	};
	membershipProducts: PublicMembershipProductSummary[];
}

export interface MembershipPurchaseSelectionResponse {
	selection: {
		offeringId: string;
		organizationSlug: string;
		entitlementClass: typeof TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS;
	};
}

export function isMembershipProductPurchasable(
	membershipProduct: Pick<MembershipProductSummary, "isActive" | "status">,
): boolean {
	return membershipProduct.isActive && membershipProduct.status === "ACTIVE";
}

export type MembershipProductValidation =
	| {
			valid: true;
			errors: [];
			input: CreateMembershipProductInput;
	  }
	| {
			valid: false;
			errors: string[];
			input: Partial<CreateMembershipProductInput>;
	  };

const MAX_MEMBERSHIP_PRODUCT_NAME_LENGTH = 255;
const MAX_MEMBERSHIP_PRODUCT_DESCRIPTION_LENGTH = 5000;

export function normalizeShopifyStoreDomain(value: string): string {
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) {
		return "";
	}

	const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
	const withoutPath = withoutProtocol.split("/")[0] ?? "";
	return withoutPath.replace(/\.+$/, "");
}

export function validateShopifySettingsInput(
	input: unknown,
	options: { requireClientSecret: boolean },
): ShopifySettingsValidation {
	const candidate =
		input && typeof input === "object"
			? (input as Partial<Record<keyof SaveShopifyIntegrationInput, unknown>>)
			: {};
	const storeUrl =
		typeof candidate.storeUrl === "string" ? candidate.storeUrl : "";
	const clientId =
		typeof candidate.clientId === "string" ? candidate.clientId.trim() : "";
	const clientSecret =
		typeof candidate.clientSecret === "string"
			? candidate.clientSecret.trim()
			: undefined;
	const storefrontPrivateToken =
		typeof candidate.storefrontPrivateToken === "string"
			? candidate.storefrontPrivateToken.trim()
			: undefined;
	const storeDomain = normalizeShopifyStoreDomain(storeUrl);
	const errors: string[] = [];

	if (!storeDomain) {
		errors.push("Shopify store URL is required.");
	} else if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(storeDomain)) {
		errors.push("Shopify store URL must be a myshopify.com store domain.");
	}

	if (!clientId) {
		errors.push("Shopify client ID is required.");
	}

	if (options.requireClientSecret && !clientSecret) {
		errors.push("Shopify client secret is required.");
	}

	return {
		valid: errors.length === 0,
		errors,
		storeDomain,
		clientId,
		clientSecret,
		storefrontPrivateToken,
	};
}

export function validateMembershipProductInput(
	input: unknown,
): MembershipProductValidation {
	const candidate =
		input && typeof input === "object"
			? (input as Partial<Record<keyof CreateMembershipProductInput, unknown>>)
			: {};
	const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
	const description =
		typeof candidate.description === "string"
			? candidate.description.trim()
			: undefined;
	const price =
		typeof candidate.price === "string" ? candidate.price.trim() : "";
	const errors: string[] = [];
	const normalizedInput: Partial<CreateMembershipProductInput> = {
		name,
		...(description ? { description } : {}),
		price,
	};

	if (!name) {
		errors.push("Membership product name is required.");
	} else if (name.length > MAX_MEMBERSHIP_PRODUCT_NAME_LENGTH) {
		errors.push("Membership product name must be 255 characters or fewer.");
	}

	if (
		description &&
		description.length > MAX_MEMBERSHIP_PRODUCT_DESCRIPTION_LENGTH
	) {
		errors.push("Membership product description is too long.");
	}

	if (!price) {
		errors.push("Membership product price is required.");
	} else if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(price)) {
		errors.push(
			"Membership product price must be a non-negative decimal string with at most 2 decimal places.",
		);
	}

	if (errors.length > 0) {
		return {
			valid: false,
			errors,
			input: normalizedInput,
		};
	}

	return {
		valid: true,
		errors: [],
		input: normalizedInput as CreateMembershipProductInput,
	};
}

import type {
	EntitlementClass,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
} from "./entitlements.js";
