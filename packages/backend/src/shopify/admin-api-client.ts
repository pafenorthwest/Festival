import { normalizeEffectiveShopifyScopes } from "@festival/common";
import {
	ShopifyAdminApiError,
	ShopifyCredentialsError,
	ShopifyIdentityError,
	ShopifyIntegrationError,
	ShopifyScopeError,
	ShopifyTransportError,
	ShopifyUserError,
} from "./errors.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyConnectivityTester,
	ShopifyCredentials,
	ShopifyMembershipProductClient,
	ShopifyProductDetails,
	ShopifyVerificationResult,
} from "./types.js";

const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

type ShopifyFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

interface ShopifyAdminApiClientOptions {
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

interface AcquiredAccessToken {
	accessToken: string;
	grantedScopes: string[];
}

const ACCESS_TOKEN_EXPIRY_SAFETY_MS = 60_000;

interface GraphqlResponse<TData> {
	data?: TData;
	errors?: Array<{ message: string }>;
}

interface ShopifyProductNode {
	id?: string;
	title?: string;
	descriptionHtml?: string;
	status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
	variants?: {
		nodes?: ShopifyVariantNode[];
		edges?: Array<{ node?: ShopifyVariantNode }>;
	};
}

interface ShopifyVariantNode {
	id?: string;
	title?: string;
	price?: string | { amount?: string; currencyCode?: string };
	product?: { id?: string };
	selectedOptions?: Array<{ name?: string; value?: string }>;
}

interface ShopifyUserErrorPayload {
	field?: string[];
	message: string;
}

function mapProductNode(
	node: ShopifyProductNode,
	shopCurrencyCode: string,
): ShopifyProductDetails {
	if (!node.id || !node.title || !node.status) {
		throw new ShopifyAdminApiError("Shopify product response was incomplete.");
	}

	const productId = node.id;
	const variantNodes =
		node.variants?.nodes ??
		node.variants?.edges?.map((edge) => edge.node).filter(Boolean) ??
		[];

	return {
		id: node.id,
		title: node.title,
		description: node.descriptionHtml,
		status: node.status,
		variants: variantNodes.map((variant) => {
			if (!variant?.id) {
				throw new ShopifyAdminApiError(
					"Shopify variant response was incomplete.",
				);
			}

			const amount =
				typeof variant.price === "string"
					? variant.price
					: (variant.price?.amount ?? "");

			if (!shopCurrencyCode) {
				throw new ShopifyAdminApiError(
					"Shopify shop response did not include a currency code.",
				);
			}

			return {
				id: variant.id,
				title: variant.title ?? "",
				price: {
					amount,
					currencyCode: shopCurrencyCode,
				},
				productId: variant.product?.id ?? productId,
				selectedOptions:
					variant.selectedOptions?.map((option) => ({
						name: option.name ?? "",
						value: option.value ?? "",
					})) ?? [],
			};
		}),
	};
}

function throwIfUserErrors(
	userErrors: ShopifyUserErrorPayload[] = [],
	requestId?: string,
): void {
	if (userErrors.length === 0) {
		return;
	}

	throw new ShopifyUserError(
		"Shopify rejected the product operation.",
		requestId,
	);
}

export class ShopifyAdminApiClient
	implements ShopifyConnectivityTester, ShopifyMembershipProductClient
{
	private readonly accessTokens = new Map<string, CachedAccessToken>();
	private readonly fetchImpl: ShopifyFetch;
	private readonly requestTimeoutMs: number;
	private readonly maxResponseBytes: number;
	private readonly now: () => number;

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
			`
			query TestShopifyConnection {
				shop {
					id
					myshopifyDomain
				}
			}
		`,
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

	async createProduct(
		context: ShopifyAdminOperationContext,
		input: {
			name: string;
			description?: string;
		},
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		this.assertOperationContext(context, "write_products");
		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"write_products",
		);
		const shopCurrencyCode = await this.fetchShopCurrencyCode(
			credentials.storeDomain,
			accessToken,
		);
		const response = await this.graphqlRequest<{
			productCreate?: {
				product?: ShopifyProductNode;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(
			credentials.storeDomain,
			accessToken,
			`
			mutation CreateMembershipProduct($product: ProductCreateInput!) {
				productCreate(product: $product) {
					product {
						id
						title
						descriptionHtml
						status
						variants(first: 2) {
							nodes {
								id
								title
								price
								product {
									id
								}
								selectedOptions {
									name
									value
								}
							}
						}
					}
					userErrors {
						field
						message
					}
				}
			}
		`,
			{
				product: {
					title: input.name,
					descriptionHtml: input.description ?? "",
					productOptions: [
						{
							name: "Plan",
							values: [{ name: "Standard" }],
						},
					],
				},
			},
		);

		const payload = response.value;
		throwIfUserErrors(payload.productCreate?.userErrors, response.requestId);
		if (!payload.productCreate?.product) {
			throw new ShopifyAdminApiError(
				"Shopify product creation returned no product.",
			);
		}

		return {
			value: mapProductNode(payload.productCreate.product, shopCurrencyCode),
			requestId: response.requestId,
		};
	}

	async updateVariantPrice(
		context: ShopifyAdminOperationContext,
		input: {
			productId: string;
			variantId: string;
			price: string;
		},
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		this.assertOperationContext(context, "write_products");
		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"write_products",
		);
		const shopCurrencyCode = await this.fetchShopCurrencyCode(
			credentials.storeDomain,
			accessToken,
		);
		const response = await this.graphqlRequest<{
			productVariantsBulkUpdate?: {
				product?: ShopifyProductNode;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(
			credentials.storeDomain,
			accessToken,
			`
			mutation UpdateMembershipProductVariantPrice(
				$productId: ID!
				$variants: [ProductVariantsBulkInput!]!
			) {
				productVariantsBulkUpdate(productId: $productId, variants: $variants) {
					product {
						id
						title
						descriptionHtml
						status
						variants(first: 2) {
							nodes {
								id
								title
								price
								product {
									id
								}
								selectedOptions {
									name
									value
								}
							}
						}
					}
					userErrors {
						field
						message
					}
				}
			}
		`,
			{
				productId: input.productId,
				variants: [
					{
						id: input.variantId,
						price: input.price,
					},
				],
			},
		);

		const payload = response.value;
		throwIfUserErrors(
			payload.productVariantsBulkUpdate?.userErrors,
			response.requestId,
		);
		if (!payload.productVariantsBulkUpdate?.product) {
			throw new ShopifyAdminApiError(
				"Shopify variant update returned no product.",
			);
		}

		return {
			value: mapProductNode(
				payload.productVariantsBulkUpdate.product,
				shopCurrencyCode,
			),
			requestId: response.requestId,
		};
	}

	async readProductsByGid(
		context: ShopifyAdminOperationContext,
		productGids: string[],
	): Promise<ShopifyAdminResult<ShopifyProductDetails[]>> {
		this.assertOperationContext(context, "read_products");
		if (productGids.length === 0) {
			return { value: [] };
		}

		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"read_products",
		);
		const shopCurrencyCode = await this.fetchShopCurrencyCode(
			credentials.storeDomain,
			accessToken,
		);
		const response = await this.graphqlRequest<{
			nodes?: Array<ShopifyProductNode | null>;
		}>(
			credentials.storeDomain,
			accessToken,
			`
			query ReadMembershipProducts($ids: [ID!]!) {
				nodes(ids: $ids) {
					... on Product {
						id
						title
						descriptionHtml
						status
						variants(first: 2) {
							nodes {
								id
								title
								price
								product {
									id
								}
								selectedOptions {
									name
									value
								}
							}
						}
					}
				}
			}
		`,
			{ ids: productGids },
		);

		return {
			value: (response.value.nodes ?? [])
				.filter((node): node is ShopifyProductNode => Boolean(node))
				.map((node) => mapProductNode(node, shopCurrencyCode)),
			requestId: response.requestId,
		};
	}

	async deleteProduct(
		context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<ShopifyAdminResult<void>> {
		this.assertOperationContext(context, "write_products");
		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"write_products",
		);
		const response = await this.graphqlRequest<{
			productDelete?: {
				deletedProductId?: string;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(
			credentials.storeDomain,
			accessToken,
			`
			mutation DeleteMembershipProduct($input: ProductDeleteInput!) {
				productDelete(input: $input) {
					deletedProductId
					userErrors {
						field
						message
					}
				}
			}
		`,
			{ input: { id: productGid } },
		);

		throwIfUserErrors(
			response.value.productDelete?.userErrors,
			response.requestId,
		);
		if (response.value.productDelete?.deletedProductId !== productGid) {
			throw new ShopifyAdminApiError(
				"Shopify product deletion returned no matching product.",
				{ requestId: response.requestId },
			);
		}
		return { value: undefined, requestId: response.requestId };
	}

	private assertOperationContext(
		context: ShopifyAdminOperationContext,
		requiredCapability: "read_products" | "write_products",
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

	private async fetchOperationAccessToken(
		context: ShopifyAdminOperationContext,
		requiredCapability: "read_products" | "write_products",
	): Promise<AcquiredAccessToken> {
		const token = await this.fetchAccessToken(context.credentials);
		if (!token.grantedScopes.includes(requiredCapability)) {
			throw new ShopifyScopeError();
		}
		return token;
	}

	private async fetchAccessToken(
		credentials: ShopifyCredentials,
		forceRefresh = false,
	): Promise<AcquiredAccessToken> {
		const cacheKey = this.accessTokenCacheKey(credentials);
		const cached = this.accessTokens.get(cacheKey);
		if (
			!forceRefresh &&
			cached &&
			cached.expiresAtMs - ACCESS_TOKEN_EXPIRY_SAFETY_MS > this.now()
		) {
			return {
				accessToken: cached.accessToken,
				grantedScopes: [...cached.grantedScopes],
			};
		}

		const { value: payload } = await this.postJson<AccessTokenResponse>(
			this.shopifyUrl(credentials.storeDomain, "/admin/oauth/access_token"),
			{
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "client_credentials",
					client_id: credentials.clientId,
					client_secret: credentials.clientSecret,
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
		const grantedScopes = this.normalizeGrantedScopes(payload.scope);
		this.accessTokens.set(cacheKey, {
			accessToken: payload.access_token,
			grantedScopes,
			expiresAtMs: this.now() + payload.expires_in * 1_000,
		});

		return { accessToken: payload.access_token, grantedScopes };
	}

	private accessTokenCacheKey(credentials: ShopifyCredentials): string {
		if (
			!credentials.organizationId ||
			!Number.isSafeInteger(credentials.integrationVersion) ||
			credentials.integrationVersion <= 0
		) {
			throw new ShopifyCredentialsError(
				"Shopify integration identity is invalid.",
			);
		}
		return [
			credentials.organizationId,
			credentials.storeDomain,
			credentials.clientId,
			String(credentials.integrationVersion),
		].join("\u0000");
	}

	private normalizeGrantedScopes(scope: unknown): string[] {
		if (typeof scope !== "string") {
			throw new ShopifyCredentialsError(
				"Shopify token response did not include granted scopes.",
			);
		}
		const scopes = [...new Set(scope.split(",").map((value) => value.trim()))]
			.filter(Boolean)
			.sort();
		if (
			scopes.length === 0 ||
			scopes.some((value) => !/^[a-z][a-z0-9_]*$/.test(value))
		) {
			throw new ShopifyCredentialsError(
				"Shopify token response included invalid granted scopes.",
			);
		}
		return normalizeEffectiveShopifyScopes(scopes);
	}

	private async fetchShopCurrencyCode(
		storeDomain: string,
		accessToken: string,
	): Promise<string> {
		const { value: payload } = await this.graphqlRequest<{
			shop?: { currencyCode?: string };
		}>(
			storeDomain,
			accessToken,
			`
			query ReadShopCurrency {
				shop {
					currencyCode
				}
			}
		`,
		);

		if (!payload.shop?.currencyCode) {
			throw new ShopifyAdminApiError(
				"Shopify shop response did not include a currency code.",
			);
		}

		return payload.shop.currencyCode;
	}

	private async graphqlRequest<TData>(
		storeDomain: string,
		accessToken: string,
		query: string,
		variables: Record<string, unknown> = {},
	): Promise<ShopifyAdminResult<TData>> {
		const response = await this.postJson<GraphqlResponse<TData>>(
			this.shopifyUrl(
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

	private shopifyUrl(storeDomain: string, path: string): URL {
		if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(storeDomain)) {
			throw new ShopifyCredentialsError(
				"Shopify store domain is not a canonical myshopify.com host.",
			);
		}

		const url = new URL(`https://${storeDomain}${path}`);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.port ||
			url.hostname !== storeDomain
		) {
			throw new ShopifyCredentialsError("Shopify destination is not allowed.");
		}

		return url;
	}

	private async postJson<T>(
		url: URL,
		init: Omit<RequestInit, "method" | "redirect" | "signal">,
		errorKind: "credentials" | "admin",
	): Promise<ShopifyAdminResult<T>> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

		try {
			const response = await this.fetchImpl(url, {
				...init,
				method: "POST",
				redirect: "manual",
				signal: controller.signal,
			});
			if (response.status >= 300 && response.status < 400) {
				throw this.requestError(errorKind, "Shopify redirect was rejected.");
			}
			if (!response.ok) {
				const requestId =
					response.headers.get("x-request-id") ??
					response.headers.get("x-shopify-request-id") ??
					undefined;
				const retryAfter = Number.parseInt(
					response.headers.get("retry-after") ?? "",
					10,
				);
				throw this.requestError(
					errorKind,
					response.status === 401 || response.status === 403
						? "Shopify authorization failed."
						: response.status === 429
							? "Shopify request was throttled."
							: "Shopify upstream request failed.",
					{
						requestId,
						retryAfterSeconds: Number.isFinite(retryAfter)
							? retryAfter
							: undefined,
					},
				);
			}

			const contentLength = Number.parseInt(
				response.headers.get("content-length") ?? "0",
				10,
			);
			if (contentLength > this.maxResponseBytes) {
				throw this.requestError(errorKind, "Shopify response was too large.");
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw this.requestError(
					errorKind,
					"Shopify returned an empty response.",
				);
			}
			const chunks: Uint8Array[] = [];
			let size = 0;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > this.maxResponseBytes) {
					await reader.cancel();
					throw this.requestError(errorKind, "Shopify response was too large.");
				}
				chunks.push(value);
			}

			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			try {
				return {
					value: JSON.parse(new TextDecoder().decode(bytes)) as T,
					requestId:
						response.headers.get("x-request-id") ??
						response.headers.get("x-shopify-request-id") ??
						undefined,
				};
			} catch {
				throw this.requestError(errorKind, "Shopify returned invalid JSON.");
			}
		} catch (error) {
			if (controller.signal.aborted) {
				throw new ShopifyTransportError("Shopify request timed out.");
			}
			if (error instanceof ShopifyIntegrationError) {
				throw error;
			}
			throw new ShopifyTransportError();
		} finally {
			clearTimeout(timeout);
		}
	}

	private requestError(
		errorKind: "credentials" | "admin",
		message: string,
		metadata: { requestId?: string; retryAfterSeconds?: number } = {},
	): ShopifyCredentialsError | ShopifyAdminApiError {
		return errorKind === "credentials"
			? new ShopifyCredentialsError(message)
			: new ShopifyAdminApiError(
					message,
					metadata,
					message === "Shopify authorization failed."
						? "credentials"
						: "upstream",
				);
	}
}
