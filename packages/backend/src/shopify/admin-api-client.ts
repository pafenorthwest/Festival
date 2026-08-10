import { ShopifyCredentialsError } from "./errors.js";
import type { ShopifyConnectivityTester, ShopifyCredentials } from "./types.js";

const SHOPIFY_ADMIN_API_VERSION = "2026-07";

interface AccessTokenResponse {
	access_token?: string;
	scope?: string;
}

export class ShopifyAdminApiClient implements ShopifyConnectivityTester {
	async testCredentials(credentials: ShopifyCredentials): Promise<void> {
		const accessToken = await this.fetchAccessToken(credentials);
		await this.graphqlRequest(
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
	}

	private async fetchAccessToken(
		credentials: ShopifyCredentials,
	): Promise<string> {
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

		return payload.access_token;
	}

	private async graphqlRequest(
		storeDomain: string,
		accessToken: string,
		query: string,
	): Promise<void> {
		const response = await fetch(
			`https://${storeDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Shopify-Access-Token": accessToken,
				},
				body: JSON.stringify({ query, variables: {} }),
			},
		);

		if (!response.ok) {
			throw new ShopifyCredentialsError(
				`Shopify Admin API test failed with status ${response.status}.`,
			);
		}

		const payload = (await response.json()) as {
			data?: { shop?: { id?: string; myshopifyDomain?: string } };
			errors?: Array<{ message: string }>;
		};
		if (payload.errors && payload.errors.length > 0) {
			throw new ShopifyCredentialsError(
				`Shopify Admin API test failed: ${payload.errors.map((error) => error.message).join("; ")}`,
			);
		}

		if (!payload.data?.shop?.id) {
			throw new ShopifyCredentialsError(
				"Shopify Admin API test returned no shop data.",
			);
		}
	}
}
