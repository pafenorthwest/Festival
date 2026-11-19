import { describe, expect, it } from "bun:test";
import type { ShopifyAdminCapability } from "@festival/common";
import {
	type ShopifyAdminOperationContext,
	ShopifyCatalogAdminClient,
	ShopifyGraphqlTransport,
	ShopifyOrdersAdminClient,
	ShopifyWebhookOperationError,
	ShopifyWebhooksAdminClient,
} from "../../../src/domains/commerce-projection/index.js";

function jsonResponse(
	body: unknown,
	status = 200,
	requestId = "req-1",
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
			"x-request-id": requestId,
		},
	});
}

function verifiedContext(
	capability: ShopifyAdminCapability = "read_orders",
	scopes: string[] = [
		"read_products",
		"write_products",
		"write_inventory",
		"read_orders",
		"read_publications",
	],
): ShopifyAdminOperationContext {
	return {
		organizationId: "org-1",
		firebaseActorUid: "uid-1",
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: "festival-studio.myshopify.com",
		integrationVersion: 2,
		grantedScopes: scopes,
		capability,
		credentials: {
			organizationId: "org-1",
			storeDomain: "festival-studio.myshopify.com",
			clientId: "client-1",
			clientSecret: "secret-1",
			integrationVersion: 2,
		},
	};
}

describe("commerce-projection split Shopify admin clients", () => {
	it("caches OAuth access token in ShopifyGraphqlTransport and invalidates on version bump", async () => {
		let tokenCalls = 0;
		const transport = new ShopifyGraphqlTransport({
			now: () => Date.parse("2026-08-10T00:00:00Z"),
			fetch: async (url) => {
				if (String(url).includes("/admin/oauth/access_token")) {
					tokenCalls += 1;
					return jsonResponse({
						access_token: `shpat_tok_${tokenCalls}`,
						expires_in: 3600,
						scope: "read_orders,read_products",
					});
				}
				return jsonResponse({
					data: {
						orders: {
							nodes: [],
							pageInfo: { hasNextPage: false },
						},
					},
				});
			},
		});

		const orders = new ShopifyOrdersAdminClient(transport);
		await orders.listPaidOrdersSince(
			verifiedContext("read_orders"),
			"2026-08-01T00:00:00Z",
		);
		await orders.listPaidOrdersSince(
			verifiedContext("read_orders"),
			"2026-08-01T00:00:00Z",
		);
		expect(tokenCalls).toBe(1);

		transport.invalidateIntegration("org-1", 2);
		await orders.listPaidOrdersSince(
			verifiedContext("read_orders"),
			"2026-08-01T00:00:00Z",
		);
		expect(tokenCalls).toBe(2);
	});

	it("maps GraphQL product reads through ShopifyCatalogAdminClient", async () => {
		const transport = new ShopifyGraphqlTransport({
			now: () => Date.parse("2026-08-10T00:00:00Z"),
			fetch: async (url) => {
				if (String(url).includes("/admin/oauth/access_token")) {
					return jsonResponse({
						access_token: "shpat_catalog",
						expires_in: 3600,
						scope: "read_products,write_products,write_inventory",
					});
				}
				return jsonResponse(
					{
						data: {
							shop: { currencyCode: "USD" },
							nodes: [
								{
									id: "gid://shopify/Product/10",
									title: "Teacher Membership",
									descriptionHtml: "<p>Annual</p>",
									status: "ACTIVE",
									variants: {
										nodes: [
											{
												id: "gid://shopify/ProductVariant/100",
												title: "Default Title",
												price: "45.00",
												product: { id: "gid://shopify/Product/10" },
												selectedOptions: [
													{ name: "Title", value: "Default Title" },
												],
												inventoryItem: {
													id: "gid://shopify/InventoryItem/200",
													requiresShipping: false,
												},
											},
										],
									},
								},
							],
						},
					},
					200,
					"req-cat-1",
				);
			},
		});

		const catalog = new ShopifyCatalogAdminClient(transport);
		const result = await catalog.readProductsByGid(
			verifiedContext("read_products"),
			["gid://shopify/Product/10"],
		);
		expect(result.requestId).toBe("req-cat-1");
		expect(result.value).toHaveLength(1);
		expect(result.value[0]?.id).toBe("gid://shopify/Product/10");
		expect(result.value[0]?.variants[0]?.price.amount).toBe("45.00");
		expect(result.value[0]?.variants[0]?.requiresShipping).toBe(false);
	});

	it("reconciles duplicate ORDERS_PAID subscriptions and rejects non-HTTPS callback URLs in ShopifyWebhooksAdminClient", async () => {
		const graphqlQueries: string[] = [];
		const transport = new ShopifyGraphqlTransport({
			fetch: async (url, init) => {
				if (String(url).includes("/admin/oauth/access_token")) {
					return jsonResponse({
						access_token: "shpat_wh",
						expires_in: 3600,
						scope: "read_orders",
					});
				}
				const payload = JSON.parse(String(init?.body ?? "{}")) as {
					query?: string;
				};
				graphqlQueries.push(payload.query ?? "");
				if (payload.query?.includes("ListOrdersPaidWebhookSubscriptions")) {
					return jsonResponse({
						data: {
							webhookSubscriptions: {
								nodes: [
									{
										id: "gid://shopify/WebhookSubscription/1",
										topic: "ORDERS_PAID",
										uri: "https://old.example.com/api/shopify/webhooks/orders-paid",
									},
								],
							},
						},
					});
				}
				if (payload.query?.includes("CreateOrdersPaidWebhook")) {
					return jsonResponse({
						data: {
							webhookSubscriptionCreate: {
								webhookSubscription: {
									id: "gid://shopify/WebhookSubscription/2",
									topic: "ORDERS_PAID",
									uri: "https://festival.example.com/api/shopify/webhooks/orders-paid",
								},
								userErrors: [],
							},
						},
					});
				}
				return jsonResponse({
					data: {
						webhookSubscriptionDelete: {
							deletedWebhookSubscriptionId:
								"gid://shopify/WebhookSubscription/1",
							userErrors: [],
						},
					},
				});
			},
		});

		const webhooks = new ShopifyWebhooksAdminClient(transport);
		await expect(
			webhooks.reconcileOrdersPaidWebhook(
				verifiedContext("read_orders", ["read_orders"]),
				"http://insecure.example.com/api/shopify/webhooks/orders-paid",
			),
		).rejects.toBeInstanceOf(ShopifyWebhookOperationError);

		const res = await webhooks.reconcileOrdersPaidWebhook(
			verifiedContext("read_orders", ["read_orders"]),
			"https://festival.example.com/api/shopify/webhooks/orders-paid",
		);
		expect(res.requestId).toBe("req-1");
		expect(
			graphqlQueries.some((q) => q.includes("CreateOrdersPaidWebhook")),
		).toBe(true);
		expect(
			graphqlQueries.some((q) => q.includes("DeleteOrdersPaidWebhook")),
		).toBe(true);
	});
});
