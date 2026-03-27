import { randomUUID } from "node:crypto";

export interface StorefrontCartLine {
	merchandiseId: string;
	quantity: number;
}

interface StorefrontClientConfig {
	shopDomain?: string;
	storefrontAccessToken?: string;
}

export interface StorefrontCartResult {
	id: string;
	checkoutUrl: string;
	providerMode: "live" | "mock";
}

export class ShopifyStorefrontClient {
	private readonly config: StorefrontClientConfig;

	constructor(config: StorefrontClientConfig) {
		this.config = config;
	}

	get mode(): "live" | "mock" {
		return this.config.shopDomain && this.config.storefrontAccessToken
			? "live"
			: "mock";
	}

	async createCart(
		lines: StorefrontCartLine[],
		buyerEmail: string,
	): Promise<StorefrontCartResult> {
		if (this.mode === "mock") {
			const cartId = `gid://shopify/Cart/mock-${randomUUID()}`;
			return {
				id: cartId,
				checkoutUrl: `https://example.local/checkout/${encodeURIComponent(cartId)}`,
				providerMode: "mock",
			};
		}

		const mutation = `
      mutation CreateCart($input: CartInput!) {
        cartCreate(input: $input) {
          cart {
            id
            checkoutUrl
          }
          userErrors {
            message
          }
        }
      }
    `;

		const payload = await this.graphqlRequest<{
			cartCreate: {
				cart: { id: string; checkoutUrl: string } | null;
				userErrors: Array<{ message: string }>;
			};
		}>(mutation, {
			input: {
				lines,
				buyerIdentity: {
					email: buyerEmail,
				},
			},
		});

		if (payload.cartCreate.userErrors.length > 0 || !payload.cartCreate.cart) {
			throw new Error(
				`Shopify cartCreate failed: ${payload.cartCreate.userErrors.map((error) => error.message).join("; ")}`,
			);
		}

		return {
			id: payload.cartCreate.cart.id,
			checkoutUrl: payload.cartCreate.cart.checkoutUrl,
			providerMode: "live",
		};
	}

	private async graphqlRequest<T>(
		query: string,
		variables: Record<string, unknown>,
	): Promise<T> {
		if (!this.config.shopDomain || !this.config.storefrontAccessToken) {
			throw new Error("Shopify Storefront API credentials are missing.");
		}

		const endpoint = `https://${this.config.shopDomain}/api/2025-10/graphql.json`;
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Shopify-Storefront-Access-Token": this.config.storefrontAccessToken,
			},
			body: JSON.stringify({ query, variables }),
		});

		if (!response.ok) {
			throw new Error(
				`Shopify Storefront API request failed with status ${response.status}`,
			);
		}

		const body = (await response.json()) as {
			data?: T;
			errors?: Array<{ message: string }>;
		};

		if (body.errors && body.errors.length > 0) {
			throw new Error(
				`Shopify Storefront API errors: ${body.errors.map((error) => error.message).join("; ")}`,
			);
		}

		if (!body.data) {
			throw new Error("Shopify Storefront API returned empty data payload.");
		}

		return body.data;
	}
}
