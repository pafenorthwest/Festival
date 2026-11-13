import { createHash, randomBytes } from "node:crypto";
import {
	AppError,
	CUSTOMER_ACCOUNT_API_VERSION,
	type CustomerOrdersResponse,
} from "@festival/common";
import type { CustomerAccountTransport } from "../../infra/s10-infra.js";

export const CUSTOMER_SESSION_COOKIE = "festival_customer_session";
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
const CUSTOMER_ACCOUNT_GRAPHQL_PATH =
	/^(\/(?:\d+\/account\/)?customer\/api\/)(\d{4}-(?:01|04|07|10))(\/graphql)$/;

export interface Discovery {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	end_session_endpoint: string;
	jwks_uri: string;
	scopes_supported?: string[];
}

export interface ApiDiscovery {
	graphql_api: string;
}

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function jsonChild(value: unknown, key: string): JsonRecord | undefined {
	return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

export function randomOpaque(bytes = 32): string {
	return randomBytes(bytes).toString("base64url");
}

export function hashOAuthState(value: string): string {
	return createHash("sha256").update(value).digest("base64url");
}

export function safeAuthError(): AppError {
	return new AppError("Customer Account authentication is unavailable.", 503);
}

function hasExplicitAuthorityPort(value: string): boolean {
	const authority = /^https:\/\/([^/]+)/i.exec(value)?.[1] ?? "";
	const host = authority.includes("@")
		? (authority.split("@").at(-1) ?? "")
		: authority;
	return host.startsWith("[") || /:\d+$/.test(host);
}

function parseMoney(value: unknown): { amount: string; currencyCode: string } {
	if (
		!isRecord(value) ||
		typeof value.amount !== "string" ||
		typeof value.currencyCode !== "string"
	) {
		throw safeAuthError();
	}
	return { amount: value.amount, currencyCode: value.currencyCode };
}

export function resolveUrls(
	publicOrigin: string,
	slug: string,
): { callbackUrl: string; logoutUrl: string } {
	return {
		callbackUrl: `${publicOrigin}/api/customer-auth/callback`,
		logoutUrl: `${publicOrigin}/org/${encodeURIComponent(slug)}/account`,
	};
}

export function resolveStartReturnTo(
	slug: string,
	returnTo?: string,
	offeringId?: string,
): string {
	if (offeringId && !/^[A-Za-z0-9_-]{1,128}$/.test(offeringId)) {
		throw new AppError("Membership selection is invalid.", 400);
	}
	let expected = offeringId
		? `/org/${slug}/membership?purchase=${encodeURIComponent(offeringId)}`
		: `/org/${slug}/account`;
	if (!offeringId && returnTo) {
		expected = matchAllowedReturnTo(slug, expected, returnTo);
	}
	if (returnTo && returnTo !== expected) {
		throw new AppError("Return target is invalid.", 400);
	}
	return expected;
}

function matchAllowedReturnTo(
	slug: string,
	defaultTarget: string,
	returnTo: string,
): string {
	if (
		returnTo === `/org/${slug}` ||
		returnTo === `/org/${slug}/accompanist-membership`
	) {
		return returnTo;
	}
	// Preserve only known checkout/recovery/festival return paths; arbitrary URLs remain forbidden.
	if (returnTo === `${defaultTarget}?checkout=processing`) return returnTo;
	const recoveryPrefix = `/org/${slug}/checkout-recovery/`;
	if (
		returnTo.startsWith(recoveryPrefix) &&
		/^[A-Za-z0-9_-]{1,128}$/.test(returnTo.slice(recoveryPrefix.length))
	) {
		return returnTo;
	}
	const festivalPattern = new RegExp(
		`^/org/${slug.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}/festival/[A-Za-z0-9_-]{1,128}/(?:register(?:/cart)?|cart)$`,
	);
	return festivalPattern.test(returnTo) ? returnTo : defaultTarget;
}

export async function transportJson(
	transport: CustomerAccountTransport,
	url: URL,
	domain: string,
	init?: RequestInit,
): Promise<JsonRecord> {
	try {
		return await transport.json(url, domain, {
			...init,
			headers: {
				"User-Agent": "Festival-Customer-BFF/1.0",
				...(init?.headers ?? {}),
			},
		});
	} catch {
		throw safeAuthError();
	}
}

export async function loadShopifyDiscovery(
	transport: CustomerAccountTransport,
	domain: string,
): Promise<{ oidc: Discovery; api: ApiDiscovery }> {
	const [oidcRaw, apiRaw] = await Promise.all([
		transportJson(
			transport,
			new URL(`https://${domain}/.well-known/openid-configuration`),
			domain,
		),
		transportJson(
			transport,
			new URL(`https://${domain}/.well-known/customer-account-api`),
			domain,
		),
	]);
	for (const field of [
		"issuer",
		"authorization_endpoint",
		"token_endpoint",
		"end_session_endpoint",
		"jwks_uri",
	] as const) {
		if (typeof oidcRaw[field] !== "string") throw safeAuthError();
	}
	if (typeof apiRaw.graphql_api !== "string") throw safeAuthError();
	const oidc = oidcRaw as unknown as Discovery;
	const api: ApiDiscovery = { graphql_api: apiRaw.graphql_api };
	for (const endpoint of [
		oidc.authorization_endpoint,
		oidc.token_endpoint,
		oidc.end_session_endpoint,
		oidc.jwks_uri,
		api.graphql_api,
	]) {
		if (hasExplicitAuthorityPort(endpoint)) throw safeAuthError();
		transport.assertDestination(new URL(endpoint), domain);
	}
	api.graphql_api = normalizeGraphqlEndpoint(api.graphql_api);
	assertValidIssuer(oidc.issuer, domain);
	return { oidc, api };
}

function normalizeGraphqlEndpoint(graphqlApi: string): string {
	const graph = new URL(graphqlApi);
	const match = CUSTOMER_ACCOUNT_GRAPHQL_PATH.exec(graph.pathname);
	if (
		graphqlApi !== graph.toString() ||
		!match ||
		match[2] < CUSTOMER_ACCOUNT_API_VERSION ||
		graph.search ||
		graph.hash
	) {
		throw safeAuthError();
	}
	graph.pathname = `${match[1]}${CUSTOMER_ACCOUNT_API_VERSION}${match[3]}`;
	return graph.toString();
}

function assertValidIssuer(issuerRaw: string, domain: string): void {
	const issuer = new URL(issuerRaw);
	const host = issuer.hostname.toLowerCase();
	if (
		issuer.protocol !== "https:" ||
		issuer.username ||
		issuer.password ||
		issuer.port ||
		hasExplicitAuthorityPort(issuerRaw) ||
		(host !== domain.toLowerCase() &&
			host !== "shopify.com" &&
			!host.endsWith(".shopify.com"))
	) {
		throw safeAuthError();
	}
}

export function parseCustomerOrdersPayload(
	result: JsonRecord,
): CustomerOrdersResponse {
	const connection = jsonChild(jsonChild(result.data, "customer"), "orders");
	if (!connection || !Array.isArray(connection.nodes)) throw safeAuthError();
	return {
		orders: connection.nodes.map(mapOrderNode),
		pageInfo: {
			hasNextPage: Boolean(
				isRecord(connection.pageInfo) && connection.pageInfo.hasNextPage,
			),
			endCursor:
				isRecord(connection.pageInfo) &&
				typeof connection.pageInfo.endCursor === "string"
					? connection.pageInfo.endCursor
					: null,
		},
	};
}

function mapOrderNode(
	value: unknown,
): CustomerOrdersResponse["orders"][number] {
	if (!isRecord(value)) throw safeAuthError();
	const rawLines =
		isRecord(value.lineItems) && Array.isArray(value.lineItems.nodes)
			? value.lineItems.nodes
			: [];
	return {
		orderNumber: String(value.number ?? ""),
		createdAtIso: String(value.createdAt ?? ""),
		total: parseMoney(value.totalPrice),
		financialStatus:
			typeof value.financialStatus === "string" ? value.financialStatus : null,
		fulfillmentStatus: String(value.fulfillmentStatus ?? ""),
		cancellation: value.cancelledAt
			? {
					cancelledAtIso: String(value.cancelledAt),
					reason:
						typeof value.cancelReason === "string" ? value.cancelReason : null,
				}
			: null,
		refund:
			isRecord(value.totalRefunded) && Number(value.totalRefunded.amount) > 0
				? { total: parseMoney(value.totalRefunded) }
				: null,
		lineItems: rawLines.map((lineValue: unknown) => {
			if (!isRecord(lineValue)) throw safeAuthError();
			return {
				title: String(lineValue.title ?? ""),
				quantity: Number(lineValue.quantity),
				total: parseMoney(lineValue.totalPrice),
			};
		}),
	};
}
