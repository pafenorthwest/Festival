import {
	ShopifyAdminApiError,
	ShopifyCredentialsError,
	ShopifyIdentityError,
	ShopifyIntegrationError,
	ShopifyScopeError,
	ShopifyTransportError,
	type ShopifyWebhookFailureStage,
	ShopifyWebhookOperationError,
} from "./shopify-errors.js";
import {
	webhookFailureCategory,
	webhookOperationError,
} from "./shopify-graphql-mappers.js";
import {
	accessTokenCacheKey,
	assertShopifyResponseOk,
	buildShopifyUrl,
	normalizeGrantedScopes,
	readShopifyResponseJson,
} from "./shopify-graphql-response.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyConnectivityTester,
	ShopifyCredentials,
	ShopifyVerificationResult,
} from "./shopify-types.js";

const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const ACCESS_TOKEN_EXPIRY_SAFETY_MS = 60_000;

export type ShopifyFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface ShopifyAdminApiClientOptions {
	fetch?: ShopifyFetch;
	requestTimeoutMs?: number;
	maxResponseBytes?: number;
	now?: () => number;
}

interface AccessTokenResponse {
	access_token?: string;
	scope?: string;
	expires_in?: number;
}

interface CachedAccessToken {
	accessToken: string;
	grantedScopes: string[];
	expiresAtMs: number;
}

export interface AcquiredAccessToken {
	accessToken: string;
	grantedScopes: string[];
}

interface GraphqlResponse<TData> {
	data?: TData;
	errors?: Array<{ message: string }>;
}

const TEST_SHOPIFY_CONNECTION_QUERY = `
	query TestShopifyConnection {
		shop { id myshopifyDomain }
	}
`;

const READ_SHOP_CURRENCY_QUERY = `
	query ReadShopCurrency {
		shop { currencyCode }
	}
`;

function normalizeOrderReadSinceIso(
	sinceIso: string,
	now: () => number,
): string {
	if (
		typeof sinceIso !== "string" ||
		!/(?:Z|[+-]\d{2}:\d{2})$/.test(sinceIso)
	) {
		throw new Error("Shopify order read window is invalid.");
	}
	const since = new Date(sinceIso);
	const nowDate = new Date(now());
	if (
		!Number.isFinite(since.getTime()) ||
		!Number.isFinite(nowDate.getTime())
	) {
		throw new Error("Shopify order read window is invalid.");
	}
	const oldestAllowed = new Date(nowDate);
	oldestAllowed.setUTCDate(oldestAllowed.getUTCDate() - 60);
	if (since < oldestAllowed) {
		throw new Error(
			"Shopify order reads are limited to the most recent 60 days.",
		);
	}
	if (since > nowDate) {
		throw new Error("Shopify order read window is invalid.");
	}
	return since.toISOString();
}

async function postShopifyJson<T>(
	fetchImpl: ShopifyFetch,
	requestTimeoutMs: number,
	maxResponseBytes: number,
	url: URL,
	init: Omit<RequestInit, "method" | "redirect" | "signal">,
	errorKind: "credentials" | "admin",
): Promise<ShopifyAdminResult<T>> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
	try {
		const response = await fetchImpl(url, {
			...init,
			method: "POST",
			redirect: "manual",
			signal: controller.signal,
		});
		assertShopifyResponseOk(response, errorKind, maxResponseBytes);
		return await readShopifyResponseJson<T>(
			response,
			errorKind,
			maxResponseBytes,
		);
	} catch (error) {
		if (controller.signal.aborted) {
			throw new ShopifyTransportError("Shopify request timed out.");
		}
		if (error instanceof ShopifyIntegrationError) throw error;
		throw new ShopifyTransportError();
	} finally {
		clearTimeout(timeout);
	}
}

async function acquireAccessToken(input: {
	accessTokens: Map<string, CachedAccessToken>;
	credentials: ShopifyCredentials;
	forceRefresh: boolean;
	fetchImpl: ShopifyFetch;
	requestTimeoutMs: number;
	maxResponseBytes: number;
	now: () => number;
}): Promise<AcquiredAccessToken> {
	const cacheKey = accessTokenCacheKey(input.credentials);
	const cached = input.accessTokens.get(cacheKey);
	if (
		!input.forceRefresh &&
		cached &&
		cached.expiresAtMs - ACCESS_TOKEN_EXPIRY_SAFETY_MS > input.now()
	) {
		return {
			accessToken: cached.accessToken,
			grantedScopes: [...cached.grantedScopes],
		};
	}
	const { value: payload } = await postShopifyJson<AccessTokenResponse>(
		input.fetchImpl,
		input.requestTimeoutMs,
		input.maxResponseBytes,
		buildShopifyUrl(input.credentials.storeDomain, "/admin/oauth/access_token"),
		{
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: input.credentials.clientId,
				client_secret: input.credentials.clientSecret,
			}),
		},
		"credentials",
	);
	if (!payload.access_token) {
		throw new ShopifyCredentialsError(
			"Shopify token response did not include an access token.",
		);
	}
	if (
		typeof payload.expires_in !== "number" ||
		!Number.isFinite(payload.expires_in) ||
		payload.expires_in <= 0
	) {
		throw new ShopifyCredentialsError(
			"Shopify token response included an invalid expiry.",
		);
	}
	const grantedScopes = normalizeGrantedScopes(payload.scope);
	input.accessTokens.set(cacheKey, {
		accessToken: payload.access_token,
		grantedScopes,
		expiresAtMs: input.now() + payload.expires_in * 1_000,
	});
	return { accessToken: payload.access_token, grantedScopes };
}

export class ShopifyGraphqlTransport implements ShopifyConnectivityTester {
	private readonly accessTokens = new Map<string, CachedAccessToken>();
	private readonly fetchImpl: ShopifyFetch;
	private readonly requestTimeoutMs: number;
	private readonly maxResponseBytes: number;
	readonly now: () => number;

	constructor(options: ShopifyAdminApiClientOptions = {}) {
		this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
		this.requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.maxResponseBytes =
			options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
		this.now = options.now ?? Date.now;
	}

	async testCredentials(
		credentials: ShopifyCredentials,
	): Promise<ShopifyVerificationResult> {
		const token = await this.fetchAccessToken(credentials, true);
		const { value: payload } = await this.graphqlRequest<{
			shop?: { id?: string; myshopifyDomain?: string };
		}>(
			credentials.storeDomain,
			token.accessToken,
			TEST_SHOPIFY_CONNECTION_QUERY,
		);
		if (!payload.shop?.id || !payload.shop.myshopifyDomain) {
			throw new ShopifyCredentialsError(
				"Shopify Admin API test returned no shop data.",
			);
		}
		if (
			payload.shop.myshopifyDomain.toLowerCase() !== credentials.storeDomain
		) {
			throw new ShopifyIdentityError();
		}
		return {
			shopGid: payload.shop.id,
			shopDomain: payload.shop.myshopifyDomain.toLowerCase(),
			grantedScopes: token.grantedScopes,
		};
	}

	invalidateIntegration(
		organizationId: string,
		integrationVersion: number,
	): void {
		for (const key of this.accessTokens.keys()) {
			if (
				key.startsWith(`${organizationId}\u0000`) &&
				key.endsWith(`\u0000${integrationVersion}`)
			) {
				this.accessTokens.delete(key);
			}
		}
	}

	assertOperationContext(
		context: ShopifyAdminOperationContext,
		requiredCapability: "read_products" | "write_products" | "read_orders",
	): void {
		if (
			context.capability !== requiredCapability ||
			!context.grantedScopes.includes(requiredCapability) ||
			context.organizationId !== context.credentials.organizationId ||
			context.integrationVersion !== context.credentials.integrationVersion ||
			context.verifiedShopDomain !== context.credentials.storeDomain
		) {
			throw new ShopifyCredentialsError(
				"Shopify operation context is not authorized.",
			);
		}
	}

	normalizePaidOrderReadSince(sinceIso: string): string {
		return normalizeOrderReadSinceIso(sinceIso, this.now);
	}

	async fetchOperationAccessToken(
		context: ShopifyAdminOperationContext,
		requiredCapability:
			| "read_products"
			| "write_products"
			| "write_inventory"
			| "read_orders",
	): Promise<AcquiredAccessToken> {
		let token = await this.fetchAccessToken(context.credentials);
		if (!token.grantedScopes.includes(requiredCapability)) {
			token = await this.fetchAccessToken(context.credentials, true);
		}
		if (!token.grantedScopes.includes(requiredCapability)) {
			throw new ShopifyScopeError();
		}
		return token;
	}

	async fetchShopCurrencyCode(
		storeDomain: string,
		accessToken: string,
	): Promise<string> {
		const { value: payload } = await this.graphqlRequest<{
			shop?: { currencyCode?: string };
		}>(storeDomain, accessToken, READ_SHOP_CURRENCY_QUERY);
		if (!payload.shop?.currencyCode) {
			throw new ShopifyAdminApiError(
				"Shopify shop response did not include a currency code.",
			);
		}
		return payload.shop.currencyCode;
	}

	async graphqlRequest<TData>(
		storeDomain: string,
		accessToken: string,
		query: string,
		variables: Record<string, unknown> = {},
	): Promise<ShopifyAdminResult<TData>> {
		const response = await this.postJson<GraphqlResponse<TData>>(
			buildShopifyUrl(
				storeDomain,
				`/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
			),
			{
				headers: {
					"Content-Type": "application/json",
					"X-Shopify-Access-Token": accessToken,
				},
				body: JSON.stringify({ query, variables }),
			},
			"admin",
		);
		const payload = response.value;
		if (payload.errors && payload.errors.length > 0) {
			throw new ShopifyAdminApiError("Shopify Admin API returned an error.", {
				requestId: response.requestId,
			});
		}
		if (!payload.data) {
			throw new ShopifyAdminApiError("Shopify Admin API returned no data.", {
				requestId: response.requestId,
			});
		}
		return { value: payload.data, requestId: response.requestId };
	}

	async webhookGraphqlRequest<TData>(
		storeDomain: string,
		accessToken: string,
		query: string,
		variables: Record<string, unknown>,
		stage: ShopifyWebhookFailureStage,
	): Promise<ShopifyAdminResult<TData>> {
		try {
			const response = await this.postJson<GraphqlResponse<TData>>(
				buildShopifyUrl(
					storeDomain,
					`/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
				),
				{
					headers: {
						"Content-Type": "application/json",
						"X-Shopify-Access-Token": accessToken,
					},
					body: JSON.stringify({ query, variables }),
				},
				"admin",
			);
			const payload = response.value;
			if (payload.errors && payload.errors.length > 0) {
				throw new ShopifyWebhookOperationError(
					stage,
					webhookFailureCategory(
						payload.errors.map((error) => error.message),
						false,
					),
					response.requestId,
				);
			}
			if (!payload.data) {
				throw new ShopifyWebhookOperationError(
					stage,
					"upstream",
					response.requestId,
				);
			}
			return { value: payload.data, requestId: response.requestId };
		} catch (error) {
			throw webhookOperationError(error, stage);
		}
	}

	private fetchAccessToken(
		credentials: ShopifyCredentials,
		forceRefresh = false,
	): Promise<AcquiredAccessToken> {
		return acquireAccessToken({
			accessTokens: this.accessTokens,
			credentials,
			forceRefresh,
			fetchImpl: this.fetchImpl,
			requestTimeoutMs: this.requestTimeoutMs,
			maxResponseBytes: this.maxResponseBytes,
			now: this.now,
		});
	}

	private postJson<T>(
		url: URL,
		init: Omit<RequestInit, "method" | "redirect" | "signal">,
		errorKind: "credentials" | "admin",
	): Promise<ShopifyAdminResult<T>> {
		return postShopifyJson(
			this.fetchImpl,
			this.requestTimeoutMs,
			this.maxResponseBytes,
			url,
			init,
			errorKind,
		);
	}
}
