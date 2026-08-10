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
	input: SaveShopifyIntegrationInput,
	options: { requireClientSecret: boolean },
): ShopifySettingsValidation {
	const storeDomain = normalizeShopifyStoreDomain(input.storeUrl);
	const clientId = input.clientId.trim();
	const clientSecret = input.clientSecret?.trim();
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
