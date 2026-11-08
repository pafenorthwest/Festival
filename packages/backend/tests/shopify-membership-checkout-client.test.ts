import { describe, expect, it } from "bun:test";
import { ShopifyMembershipCheckoutClient } from "../src/checkout/shopify-membership-checkout-client.js";
import { CustomerAccountTransport } from "../src/customer/customer-account-transport.js";

describe("ShopifyMembershipCheckoutClient", () => {
	it("uses the DNS-pinned transport and attaches only the opaque correlation attribute", async () => {
		let body = "";
		let headers: HeadersInit | undefined;
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async (_url, _answer, _agent, init) => {
				body = String(init?.body);
				headers = init?.headers;
				return {
					status: 200,
					body: (async function* () {
						yield new TextEncoder().encode(
							JSON.stringify({
								data: {
									cartCreate: {
										cart: { id: "gid://shopify/Cart/private" },
										userErrors: [],
										warnings: [],
									},
								},
							}),
						);
					})(),
				};
			},
		});
		const client = new ShopifyMembershipCheckoutClient(
			{
				getShopifyIntegration: async () => ({
					storeDomain: "festival.myshopify.com",
					encryptedStorefrontPrivateToken: "ciphertext",
				}),
			} as never,
			{ decrypt: () => "private-token" } as never,
			transport,
		);
		await expect(
			client.createCart({
				organizationId: "org",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
				buyerAccessToken: "customer-token",
				correlationId: "opaque-intent",
				idempotencyKey: "festival-only-do-not-forward",
			} as never),
		).resolves.toEqual({ shopifyCartId: "gid://shopify/Cart/private" });
		expect(body).toContain("festival_checkout_intent_id");
		expect(body).toContain("opaque-intent");
		expect(body).not.toContain("private-token");
		expect(body).not.toContain("festival-only-do-not-forward");
		expect(new Headers(headers).has("Idempotency-Key")).toBe(false);
	});

	it("reads complete correlation, buyer and line evidence without forwarding Festival request keys", async () => {
		let requestBody = "";
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async (_url, _answer, _agent, init) => {
				requestBody = String(init?.body);
				return {
					status: 200,
					body: (async function* () {
						yield new TextEncoder().encode(
							JSON.stringify({
								data: {
									cart: {
										attributes: [
											{
												key: "festival_checkout_intent_id",
												value: "correlation",
											},
										],
										buyerIdentity: {
											customer: { id: "gid://shopify/Customer/1" },
										},
										lines: {
											pageInfo: { hasNextPage: false },
											nodes: [
												{
													quantity: 1,
													attributes: [
														{
															key: "festival_checkout_intent_line_id",
															value: "line-identity",
														},
													],
													merchandise: { id: "gid://shopify/ProductVariant/1" },
												},
											],
										},
									},
								},
							}),
						);
					})(),
				};
			},
		});
		const client = new ShopifyMembershipCheckoutClient(
			{
				getShopifyIntegration: async () => ({
					storeDomain: "festival.myshopify.com",
					encryptedStorefrontPrivateToken: "ciphertext",
				}),
			} as never,
			{ decrypt: () => "private-token" } as never,
			transport,
		);
		await expect(
			client.inspectCart({
				organizationId: "org",
				shopifyCartId: "gid://shopify/Cart/private",
				idempotencyKey: "festival-only",
			} as never),
		).resolves.toEqual({
			correlationId: "correlation",
			customerGid: "gid://shopify/Customer/1",
			lines: [
				{
					intentLineId: "line-identity",
					variantGid: "gid://shopify/ProductVariant/1",
					quantity: 1,
				},
			],
		});
		expect(requestBody).not.toContain("festival-only");
	});

	it("refuses incomplete paginated cart evidence", async () => {
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async () => ({
				status: 200,
				body: (async function* () {
					yield new TextEncoder().encode(
						JSON.stringify({
							data: {
								cart: { lines: { nodes: [], pageInfo: { hasNextPage: true } } },
							},
						}),
					);
				})(),
			}),
		});
		const client = new ShopifyMembershipCheckoutClient(
			{
				getShopifyIntegration: async () => ({
					storeDomain: "festival.myshopify.com",
					encryptedStorefrontPrivateToken: "ciphertext",
				}),
			} as never,
			{ decrypt: () => "private-token" } as never,
			transport,
		);
		await expect(
			client.inspectCart({
				organizationId: "org",
				shopifyCartId: "gid://shopify/Cart/private",
			}),
		).rejects.toMatchObject({ status: 503 });
	});

	it("normalizes Storefront user errors, warnings, and invalid carts", async () => {
		let response: unknown = {
			data: {
				cartCreate: {
					cart: { id: "gid://shopify/Cart/private" },
					userErrors: [{ message: "no" }],
					warnings: [],
				},
			},
		};
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async () => ({
				status: 200,
				body: (async function* () {
					yield new TextEncoder().encode(JSON.stringify(response));
				})(),
			}),
		});
		const client = new ShopifyMembershipCheckoutClient(
			{
				getShopifyIntegration: async () => ({
					storeDomain: "festival.myshopify.com",
					encryptedStorefrontPrivateToken: "ciphertext",
				}),
			} as never,
			{ decrypt: () => "private-token" } as never,
			transport,
		);
		const create = () =>
			client.createCart({
				organizationId: "org",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
				buyerAccessToken: "customer-token",
				correlationId: "opaque-intent",
			});
		await expect(create()).rejects.toMatchObject({ status: 503 });
		response = {
			data: {
				cartCreate: {
					cart: { id: "gid://shopify/Cart/private" },
					userErrors: [],
					warnings: [{ message: "warning" }],
				},
			},
		};
		await expect(create()).rejects.toMatchObject({ status: 503 });
		response = {
			data: {
				cartCreate: { cart: { id: "gid://shopify/Cart/partial-result" } },
			},
			errors: [{ message: "partial provider failure" }],
		};
		await expect(create()).rejects.toMatchObject({
			status: 503,
			observedShopifyCartId: "gid://shopify/Cart/partial-result",
		});
		response = { data: { cart: null } };
		await expect(
			client.checkout({
				organizationId: "org",
				shopifyCartId: "gid://shopify/Cart/private",
			}),
		).rejects.toMatchObject({ status: 503 });
	});
});
