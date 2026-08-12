export const SHOPIFY_VERIFICATION_STATUSES = [
	"unknown",
	"ok",
	"failed",
] as const;

export type ShopifyVerificationStatus =
	(typeof SHOPIFY_VERIFICATION_STATUSES)[number];

export interface ShopifyIntegrationSettings {
	storeDomain: string;
	clientId: string;
	hasClientSecret: boolean;
	verificationStatus: ShopifyVerificationStatus;
	verifiedAtIso?: string;
	lastTestedAtIso?: string;
	lastError?: string;
	updatedAtIso: string;
}

export interface ShopifyIntegrationSettingsResponse {
	settings: ShopifyIntegrationSettings | null;
}

export interface SaveShopifyIntegrationInput {
	storeUrl: string;
	clientId: string;
	clientSecret?: string;
}

export interface SaveShopifyIntegrationResponse {
	settings: ShopifyIntegrationSettings;
}

export interface ShopifySettingsValidation {
	valid: boolean;
	errors: string[];
	storeDomain: string;
	clientId: string;
	clientSecret?: string;
}

export const MEMBERSHIP_PRODUCT_TYPES = ["teacher", "accompanist"] as const;

export type MembershipProductType = (typeof MEMBERSHIP_PRODUCT_TYPES)[number];

export const MEMBERSHIP_ENTITLEMENT_PERIODS = [
	"1_day",
	"1_month",
	"1_year",
] as const;

export type MembershipEntitlementPeriod =
	(typeof MEMBERSHIP_ENTITLEMENT_PERIODS)[number];

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
	membershipType: MembershipProductType;
	entitlementPeriod: MembershipEntitlementPeriod;
}

export interface MembershipProductSummary {
	id: string;
	name: string;
	description?: string;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
	variantName: "Standard";
	membershipType: MembershipProductType;
	entitlementPeriod: MembershipEntitlementPeriod;
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
	};
}

function isMembershipProductType(
	value: string,
): value is MembershipProductType {
	return MEMBERSHIP_PRODUCT_TYPES.includes(value as MembershipProductType);
}

function isMembershipEntitlementPeriod(
	value: string,
): value is MembershipEntitlementPeriod {
	return MEMBERSHIP_ENTITLEMENT_PERIODS.includes(
		value as MembershipEntitlementPeriod,
	);
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
	const membershipType =
		typeof candidate.membershipType === "string"
			? candidate.membershipType
			: "";
	const entitlementPeriod =
		typeof candidate.entitlementPeriod === "string"
			? candidate.entitlementPeriod
			: "";
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

	if (isMembershipProductType(membershipType)) {
		normalizedInput.membershipType = membershipType;
	} else {
		errors.push("Membership product type must be teacher or accompanist.");
	}

	if (isMembershipEntitlementPeriod(entitlementPeriod)) {
		normalizedInput.entitlementPeriod = entitlementPeriod;
	} else {
		errors.push(
			"Membership entitlement period must be 1_day, 1_month, or 1_year.",
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
