import { createHash } from "node:crypto";
import {
	ShopifyAdminApiError,
	ShopifyCredentialsError,
	ShopifyUserError,
} from "./errors.js";
import type {
	ShopifyConnectivityTester,
	ShopifyCredentials,
	ShopifyMembershipProductClient,
	ShopifyProductDetails,
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
}

interface AccessTokenResponse {
	access_token?: string;
	scope?: string;
	expires_in?: number;
}

interface CachedAccessToken {
	accessToken: string;
	expiresAtMs: number;
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

function throwIfUserErrors(userErrors: ShopifyUserErrorPayload[] = []): void {
	if (userErrors.length === 0) {
		return;
	}

	throw new ShopifyUserError("Shopify rejected the product operation.");
}

export class ShopifyAdminApiClient
	implements ShopifyConnectivityTester, ShopifyMembershipProductClient
{
	private readonly accessTokens = new Map<string, CachedAccessToken>();
	private readonly fetchImpl: ShopifyFetch;
	private readonly requestTimeoutMs: number;
	private readonly maxResponseBytes: number;

	constructor(options: ShopifyAdminApiClientOptions = {}) {
		this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
		this.requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.maxResponseBytes =
			options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
	}

	async testCredentials(credentials: ShopifyCredentials): Promise<void> {
		const accessToken = await this.fetchAccessToken(credentials, true);
		const payload = await this.graphqlRequest<{
			shop?: { id?: string; myshopifyDomain?: string };
		}>(
			credentials.storeDomain,
			accessToken,
			`
			query TestShopifyConnection {
				shop {
					id
					myshopifyDomain
				}
			}
		`,
		);

		if (!payload.shop?.id) {
			throw new ShopifyCredentialsError(
				"Shopify Admin API test returned no shop data.",
			);
		}
	}

	async createProduct(
		credentials: ShopifyCredentials,
		input: {
			name: string;
			description?: string;
		},
	): Promise<ShopifyProductDetails> {
		const accessToken = await this.fetchAccessToken(credentials);
		const shopCurrencyCode = await this.fetchShopCurrencyCode(
			credentials.storeDomain,
			accessToken,
		);
		const payload = await this.graphqlRequest<{
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

		throwIfUserErrors(payload.productCreate?.userErrors);
		if (!payload.productCreate?.product) {
			throw new ShopifyAdminApiError(
				"Shopify product creation returned no product.",
			);
		}

		return mapProductNode(payload.productCreate.product, shopCurrencyCode);
	}

	async updateVariantPrice(
		credentials: ShopifyCredentials,
		input: {
			productId: string;
			variantId: string;
			price: string;
		},
	): Promise<ShopifyProductDetails> {
		const accessToken = await this.fetchAccessToken(credentials);
		const shopCurrencyCode = await this.fetchShopCurrencyCode(
			credentials.storeDomain,
			accessToken,
		);
		const payload = await this.graphqlRequest<{
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

		throwIfUserErrors(payload.productVariantsBulkUpdate?.userErrors);
		if (!payload.productVariantsBulkUpdate?.product) {
			throw new ShopifyAdminApiError(
				"Shopify variant update returned no product.",
			);
		}

		return mapProductNode(
			payload.productVariantsBulkUpdate.product,
			shopCurrencyCode,
		);
	}

	async readProductsByGid(
		credentials: ShopifyCredentials,
		productGids: string[],
	): Promise<ShopifyProductDetails[]> {
		if (productGids.length === 0) {
			return [];
		}

		const accessToken = await this.fetchAccessToken(credentials);
		const shopCurrencyCode = await this.fetchShopCurrencyCode(
			credentials.storeDomain,
			accessToken,
		);
		const payload = await this.graphqlRequest<{
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

		return (payload.nodes ?? [])
			.filter((node): node is ShopifyProductNode => Boolean(node))
			.map((node) => mapProductNode(node, shopCurrencyCode));
	}

	async deleteProduct(
		credentials: ShopifyCredentials,
		productGid: string,
	): Promise<void> {
		const accessToken = await this.fetchAccessToken(credentials);
		const payload = await this.graphqlRequest<{
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

		throwIfUserErrors(payload.productDelete?.userErrors);
	}

	private async fetchAccessToken(
		credentials: ShopifyCredentials,
		forceRefresh = false,
	): Promise<string> {
		const cacheKey = this.accessTokenCacheKey(credentials);
		const cached = this.accessTokens.get(cacheKey);
		if (
			!forceRefresh &&
			cached &&
			cached.expiresAtMs - ACCESS_TOKEN_EXPIRY_SAFETY_MS > Date.now()
		) {
			return cached.accessToken;
		}

		const payload = await this.postJson<AccessTokenResponse>(
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
			typeof payload.expires_in === "number" &&
			Number.isFinite(payload.expires_in) &&
			payload.expires_in > 0
		) {
			this.accessTokens.set(cacheKey, {
				accessToken: payload.access_token,
				expiresAtMs: Date.now() + payload.expires_in * 1_000,
			});
		} else {
			this.accessTokens.delete(cacheKey);
		}

		return payload.access_token;
	}

	private accessTokenCacheKey(credentials: ShopifyCredentials): string {
		const secretFingerprint = createHash("sha256")
			.update(credentials.clientSecret)
			.digest("base64url");
		return `${credentials.storeDomain}:${credentials.clientId}:${secretFingerprint}`;
	}

	private async fetchShopCurrencyCode(
		storeDomain: string,
		accessToken: string,
	): Promise<string> {
		const payload = await this.graphqlRequest<{
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
	): Promise<TData> {
		const payload = await this.postJson<GraphqlResponse<TData>>(
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

		if (payload.errors && payload.errors.length > 0) {
			throw new ShopifyAdminApiError("Shopify Admin API returned an error.");
		}

		if (!payload.data) {
			throw new ShopifyAdminApiError("Shopify Admin API returned no data.");
		}

		return payload.data;
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
	): Promise<T> {
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
				throw this.requestError(
					errorKind,
					`Shopify request failed with status ${response.status}.`,
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
				return JSON.parse(new TextDecoder().decode(bytes)) as T;
			} catch {
				throw this.requestError(errorKind, "Shopify returned invalid JSON.");
			}
		} catch (error) {
			if (controller.signal.aborted) {
				throw this.requestError(errorKind, "Shopify request timed out.");
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}

	private requestError(
		errorKind: "credentials" | "admin",
		message: string,
	): ShopifyCredentialsError | ShopifyAdminApiError {
		return errorKind === "credentials"
			? new ShopifyCredentialsError(message)
			: new ShopifyAdminApiError(message);
	}
}
