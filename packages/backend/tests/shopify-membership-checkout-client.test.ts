import { describe, expect, it } from "bun:test";
import { ShopifyMembershipCheckoutClient } from "../src/checkout/shopify-membership-checkout-client.js";
import { CustomerAccountTransport } from "../src/customer/customer-account-transport.js";

describe("ShopifyMembershipCheckoutClient", () => {
	it("uses the DNS-pinned transport and attaches only the opaque correlation attribute", async () => {
		let body = "";
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async (_url, _answer, _agent, init) => {
				body = String(init?.body);
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
			}),
		).resolves.toEqual({ shopifyCartId: "gid://shopify/Cart/private" });
		expect(body).toContain("festival_checkout_intent_id");
		expect(body).toContain("opaque-intent");
		expect(body).not.toContain("private-token");
	});
});
