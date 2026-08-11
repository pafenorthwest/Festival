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

	throw new ShopifyUserError(
		userErrors.map((error) => error.message).join("; "),
	);
}

export class ShopifyAdminApiClient
	implements ShopifyConnectivityTester, ShopifyMembershipProductClient
{
	private readonly accessTokens = new Map<string, CachedAccessToken>();

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

		const response = await fetch(
			`https://${credentials.storeDomain}/admin/oauth/access_token`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "client_credentials",
					client_id: credentials.clientId,
					client_secret: credentials.clientSecret,
				}),
			},
		);

		if (!response.ok) {
			throw new ShopifyCredentialsError(
				`Shopify token request failed with status ${response.status}.`,
			);
		}

		const payload = (await response.json()) as AccessTokenResponse;
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
		const response = await fetch(
			`https://${storeDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Shopify-Access-Token": accessToken,
				},
				body: JSON.stringify({ query, variables }),
			},
		);

		if (!response.ok) {
			throw new ShopifyAdminApiError(
				`Shopify Admin API request failed with status ${response.status}.`,
			);
		}

		const payload = (await response.json()) as GraphqlResponse<TData>;
		if (payload.errors && payload.errors.length > 0) {
			throw new ShopifyAdminApiError(
				`Shopify Admin API request failed: ${payload.errors.map((error) => error.message).join("; ")}`,
			);
		}

		if (!payload.data) {
			throw new ShopifyAdminApiError("Shopify Admin API returned no data.");
		}

		return payload.data;
	}
}
