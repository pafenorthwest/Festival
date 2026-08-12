import { afterEach, describe, expect, it } from "bun:test";
import { ShopifyAdminApiClient } from "../src/shopify/admin-api-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("ShopifyAdminApiClient", () => {
	it("reuses an unexpired access token for product reads", async () => {
		let tokenRequests = 0;
		let graphqlRequests = 0;
		globalThis.fetch = (async (input, init) => {
			const url = input instanceof Request ? input.url : input.toString();
			if (url.endsWith("/admin/oauth/access_token")) {
				tokenRequests += 1;
				return Response.json({
					access_token: "short-lived-token",
					expires_in: 86_399,
				});
			}

			graphqlRequests += 1;
			const body = JSON.parse(String(init?.body)) as { query: string };
			if (body.query.includes("ReadShopCurrency")) {
				return Response.json({ data: { shop: { currencyCode: "USD" } } });
			}
			return Response.json({
				data: { nodes: [] },
			});
		}) as typeof fetch;

		const client = new ShopifyAdminApiClient();
		const credentials = {
			storeDomain: "example.myshopify.com",
			clientId: "client-id",
			clientSecret: "client-secret",
		};

		await client.readProductsByGid(credentials, ["gid://shopify/Product/1"]);
		await client.readProductsByGid(credentials, ["gid://shopify/Product/1"]);

		expect(tokenRequests).toBe(1);
		expect(graphqlRequests).toBe(4);
	});

	it("does not reuse a token after the client secret changes", async () => {
		let tokenRequests = 0;
		globalThis.fetch = (async (input, init) => {
			const url = input instanceof Request ? input.url : input.toString();
			if (url.endsWith("/admin/oauth/access_token")) {
				tokenRequests += 1;
				return Response.json({
					access_token: `short-lived-token-${tokenRequests}`,
					expires_in: 86_399,
				});
			}

			const body = JSON.parse(String(init?.body)) as { query: string };
			return body.query.includes("ReadShopCurrency")
				? Response.json({ data: { shop: { currencyCode: "USD" } } })
				: Response.json({ data: { nodes: [] } });
		}) as typeof fetch;

		const client = new ShopifyAdminApiClient();
		const credentials = {
			storeDomain: "example.myshopify.com",
			clientId: "client-id",
			clientSecret: "client-secret",
		};

		await client.readProductsByGid(credentials, ["gid://shopify/Product/1"]);
		await client.readProductsByGid(
			{
				...credentials,
				clientSecret: "rotated-client-secret",
			},
			["gid://shopify/Product/1"],
		);

		expect(tokenRequests).toBe(2);
	});
});
