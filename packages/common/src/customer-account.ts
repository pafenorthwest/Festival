export const CUSTOMER_ACCOUNT_API_VERSION = "2026-07" as const;

export type CustomerAccountReadiness = "unknown" | "ready" | "failed";

export interface CustomerAccountSettings {
	storefrontDomain: string;
	clientId: string;
	hasClientSecret: boolean;
	callbackUrl: string;
	logoutUrl: string;
	apiVersion: typeof CUSTOMER_ACCOUNT_API_VERSION;
	readiness: CustomerAccountReadiness;
	canReadOrders: boolean;
	integrationVersion: number;
	verifiedAtIso?: string;
	lastError?: string;
	updatedAtIso: string;
}

export interface CustomerAccountSettingsResponse {
	settings: CustomerAccountSettings | null;
}

export interface SaveCustomerAccountSettingsInput {
	storefrontDomain: string;
	clientId: string;
	clientSecret?: string;
}

export interface SaveCustomerAccountSettingsResponse {
	settings: CustomerAccountSettings;
}

export interface CustomerSessionProfile {
	authenticated: true;
	csrfToken: string;
	expiresAtIso: string;
}

export interface CustomerSessionResponse {
	session: CustomerSessionProfile | { authenticated: false };
}

export const CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION =
	"festival-customer-profile-v1" as const;

export interface CustomerMailingAddress {
	line1: string;
	line2?: string;
	city: string;
	region: string;
	postalCode: string;
	countryCode: string;
}

export interface CustomerProfile {
	name: string | null;
	email: string | null;
	mailingAddress: CustomerMailingAddress | null;
	phone: string | null;
	updatedAtIso: string | null;
}

export interface CustomerProfileResponse {
	profile: CustomerProfile;
}

export interface UpdateCustomerProfileInput {
	name: string;
	email: string;
	mailingAddress: CustomerMailingAddress;
	phone: string;
}

export interface AdminCustomerProfileSummary {
	customerId: string;
	profile: CustomerProfile;
}

export interface AdminCustomerSearchResult {
	customerId: string;
	name: string | null;
	email: string | null;
	phone: string | null;
}

export interface AdminCustomerSearchResponse {
	customers: AdminCustomerSearchResult[];
}

const PROFILE_TEXT_LIMIT = 255;
const PROFILE_ADDRESS_LIMIT = 512;
const PROFILE_PHONE_PATTERN = /^\+?[0-9][0-9 ().-]{5,30}$/;
const PROFILE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiredText(
	value: unknown,
	label: string,
	maxLength = PROFILE_TEXT_LIMIT,
): string {
	if (typeof value !== "string") throw new Error(`${label} is required.`);
	const normalized = value.trim();
	if (!normalized) throw new Error(`${label} is required.`);
	if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
	return normalized;
}

export function validateCustomerProfileInput(
	input: unknown,
): UpdateCustomerProfileInput {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Customer profile is invalid.");
	const candidate = input as Record<string, unknown>;
	const allowed = new Set(["name", "email", "mailingAddress", "phone"]);
	if (Object.keys(candidate).some((key) => !allowed.has(key)))
		throw new Error("Customer profile contains unsupported fields.");
	const email = requiredText(candidate.email, "Email").toLowerCase();
	if (!PROFILE_EMAIL_PATTERN.test(email)) throw new Error("Email is invalid.");
	const phone = requiredText(candidate.phone, "Phone");
	if (!PROFILE_PHONE_PATTERN.test(phone)) throw new Error("Phone is invalid.");
	if (
		!candidate.mailingAddress ||
		typeof candidate.mailingAddress !== "object" ||
		Array.isArray(candidate.mailingAddress)
	)
		throw new Error("Mailing address is required.");
	const address = candidate.mailingAddress as Record<string, unknown>;
	const addressAllowed = new Set([
		"line1",
		"line2",
		"city",
		"region",
		"postalCode",
		"countryCode",
	]);
	if (Object.keys(address).some((key) => !addressAllowed.has(key)))
		throw new Error("Mailing address contains unsupported fields.");
	const countryCode = requiredText(
		address.countryCode,
		"Country code",
	).toUpperCase();
	if (!/^[A-Z]{2}$/.test(countryCode))
		throw new Error("Country code is invalid.");
	const line2 =
		typeof address.line2 === "string" ? address.line2.trim() : undefined;
	if (line2 && line2.length > PROFILE_ADDRESS_LIMIT)
		throw new Error("Address line 2 is too long.");
	return {
		name: requiredText(candidate.name, "Name"),
		email,
		phone,
		mailingAddress: {
			line1: requiredText(
				address.line1,
				"Address line 1",
				PROFILE_ADDRESS_LIMIT,
			),
			...(line2 ? { line2 } : {}),
			city: requiredText(address.city, "City"),
			region: requiredText(address.region, "Region"),
			postalCode: requiredText(address.postalCode, "Postal code"),
			countryCode,
		},
	};
}

export interface CustomerMoney {
	amount: string;
	currencyCode: string;
}

export interface CustomerOrderLineItem {
	title: string;
	quantity: number;
	total: CustomerMoney;
}

export interface CustomerOrderSummary {
	orderNumber: string;
	createdAtIso: string;
	total: CustomerMoney;
	financialStatus: string | null;
	fulfillmentStatus: string;
	cancellation: { cancelledAtIso: string; reason: string | null } | null;
	refund: { total: CustomerMoney } | null;
	lineItems: CustomerOrderLineItem[];
}

export interface CustomerOrdersResponse {
	orders: CustomerOrderSummary[];
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export function normalizeCustomerAccountDomain(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim().toLowerCase();
	if (!trimmed || trimmed.length > 253) return "";
	let hostname: string;
	try {
		hostname = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
			.hostname;
	} catch {
		return "";
	}
	return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) ? hostname : "";
}

export function validateCustomerAccountSettings(
	input: unknown,
	requireSecret: boolean,
): { storefrontDomain: string; clientId: string; clientSecret?: string } {
	const candidate =
		input && typeof input === "object" && !Array.isArray(input)
			? (input as Record<string, unknown>)
			: {};
	const allowed = new Set(["storefrontDomain", "clientId", "clientSecret"]);
	const extra = Object.keys(candidate).filter((key) => !allowed.has(key));
	if (extra.length)
		throw new Error("Customer Account settings contain unsupported fields.");
	const storefrontDomain = normalizeCustomerAccountDomain(
		candidate.storefrontDomain,
	);
	const clientId =
		typeof candidate.clientId === "string" ? candidate.clientId.trim() : "";
	const clientSecret =
		typeof candidate.clientSecret === "string"
			? candidate.clientSecret.trim()
			: undefined;
	if (!storefrontDomain)
		throw new Error("A valid storefront domain is required.");
	if (!clientId || clientId.length > 256)
		throw new Error("Customer Account client ID is required.");
	if (requireSecret && !clientSecret)
		throw new Error("Customer Account client secret is required.");
	if (clientSecret && clientSecret.length > 8192)
		throw new Error("Customer Account client secret is invalid.");
	return {
		storefrontDomain,
		clientId,
		clientSecret: clientSecret || undefined,
	};
}
