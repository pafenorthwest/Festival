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
