import { describe, expect, it } from "bun:test";
import { TokenlessShopifyPublicCatalogClient } from "../src/shopify/shopify-public-catalog-client.js";

function payload(overrides: Record<string, unknown> = {}) {
	return {
		data: {
			product: {
				id: "gid://shopify/Product/123",
				title: "Teacher Membership",
				description: "Annual teacher membership.",
				availableForSale: true,
				variants: {
					nodes: [
						{
							id: "gid://shopify/ProductVariant/456",
							availableForSale: true,
							price: { amount: "75.00", currencyCode: "USD" },
						},
					],
				},
				...overrides,
			},
		},
	};
}

describe("tokenless Shopify public catalog client", () => {
	it("diagnoses public Storefront access without credentials and classifies a locked store", async () => {
		let requestInit: RequestInit | undefined;
		const available = new TokenlessShopifyPublicCatalogClient((async (
			_url,
			init,
		) => {
			requestInit = init;
			return Response.json({ data: { shop: { name: "Festival Shop" } } });
		}) as typeof fetch);
		await expect(
			available.diagnosePublicStorefrontAccess("festival.myshopify.com"),
		).resolves.toBe("passed");
		expect(requestInit?.redirect).toBe("error");
		expect(requestInit?.body).toContain("FestivalPublicStorefrontDiagnostic");
		expect(JSON.stringify(requestInit?.headers)).not.toMatch(
			/token|authorization|secret/i,
		);

		const locked = new TokenlessShopifyPublicCatalogClient((async () =>
			Response.json(
				{
					errors: [
						{
							message: "Online Store channel is locked.",
							detail: "sensitive-upstream-canary",
						},
					],
				},
				{ status: 400 },
			)) as typeof fetch);
		await expect(
			locked.diagnosePublicStorefrontAccess("festival.myshopify.com"),
		).resolves.toBe("locked");
	});

	it("sanitizes unexpected public Storefront diagnostic failures", async () => {
		const client = new TokenlessShopifyPublicCatalogClient((async () =>
			Response.json(
				{
					errors: [{ message: "unexpected sensitive-upstream-canary failure" }],
				},
				{ status: 500 },
			)) as typeof fetch);
		try {
			await client.diagnosePublicStorefrontAccess("festival.myshopify.com");
			throw new Error("Expected diagnostic to reject.");
		} catch (error) {
			expect((error as Error).message).toBe(
				"Membership information is temporarily unavailable.",
			);
			expect((error as Error).message).not.toContain(
				"sensitive-upstream-canary",
			);
		}
	});

	it("reads a bounded current product without sending a Storefront or Admin credential", async () => {
		let requestUrl = "";
		let requestInit: RequestInit | undefined;
		const client = new TokenlessShopifyPublicCatalogClient((async (
			url,
			init,
		) => {
			requestUrl = String(url);
			requestInit = init;
			return Response.json(payload());
		}) as typeof fetch);
		const product = await client.readProduct(
			"festival.myshopify.com",
			"gid://shopify/Product/123",
		);
		expect(product).toMatchObject({
			title: "Teacher Membership",
			availableForSale: true,
			variant: {
				id: "gid://shopify/ProductVariant/456",
				price: { amount: "75.00", currencyCode: "USD" },
			},
		});
		expect(requestUrl).toBe(
			"https://festival.myshopify.com/api/2026-07/graphql.json",
		);
		expect(requestInit?.redirect).toBe("error");
		expect(JSON.stringify(requestInit?.headers)).not.toMatch(
			/token|authorization|secret/i,
		);
	});

	it("sends a configured private Storefront token without exposing it in failures", async () => {
		let requestInit: RequestInit | undefined;
		const client = new TokenlessShopifyPublicCatalogClient((async (
			_url,
			init,
		) => {
			requestInit = init;
			return Response.json(payload());
		}) as typeof fetch);
		await client.readProduct(
			"festival.myshopify.com",
			"gid://shopify/Product/123",
			"private-storefront-token",
		);
		expect(requestInit?.headers).toMatchObject({
			"Shopify-Storefront-Private-Token": "private-storefront-token",
		});
	});

	it("fails closed for unsafe destinations, oversized payloads, and malformed Shopify data", async () => {
		const never = new TokenlessShopifyPublicCatalogClient((async () => {
			throw new Error("must not fetch");
		}) as typeof fetch);
		await expect(
			never.readProduct("127.0.0.1", "gid://shopify/Product/123"),
		).rejects.toThrow("temporarily unavailable");

		const oversized = new TokenlessShopifyPublicCatalogClient(
			(async () =>
				new Response("{}", {
					headers: { "Content-Length": String(64 * 1024 + 1) },
				})) as typeof fetch,
		);
		await expect(
			oversized.readProduct(
				"festival.myshopify.com",
				"gid://shopify/Product/123",
			),
		).rejects.toThrow("temporarily unavailable");

		const malformed = new TokenlessShopifyPublicCatalogClient((async () =>
			Response.json(
				payload({
					variants: { nodes: [] },
				}),
			)) as typeof fetch);
		await expect(
			malformed.readProduct(
				"festival.myshopify.com",
				"gid://shopify/Product/123",
			),
		).rejects.toThrow("temporarily unavailable");
	});
});
