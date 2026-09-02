import { afterEach, describe, expect, it } from "bun:test";
import { ShopifyAdminApiClient } from "../src/shopify/admin-api-client.js";
import {
	ShopifyAdminApiError,
	ShopifyCredentialsError,
	ShopifyUserError,
} from "../src/shopify/errors.js";
import { assertShopifyOrderReadAllowed } from "../src/shopify/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("ShopifyAdminApiClient", () => {
	const credentials = {
		organizationId: "organization-1",
		storeDomain: "example.myshopify.com",
		clientId: "client-id",
		clientSecret: "client-secret",
		integrationVersion: 1,
	};
	const operationContext = {
		organizationId: credentials.organizationId,
		firebaseActorUid: "firebase-admin-uid",
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: credentials.storeDomain,
		integrationVersion: credentials.integrationVersion,
		grantedScopes: ["read_products", "write_products", "read_orders"],
		capability: "read_products" as const,
		credentials,
	};

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
					scope: "read_products,write_products,read_orders",
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
		await client.readProductsByGid(operationContext, [
			"gid://shopify/Product/1",
		]);
		await client.readProductsByGid(operationContext, [
			"gid://shopify/Product/1",
		]);

		expect(tokenRequests).toBe(1);
		expect(graphqlRequests).toBe(4);
	});

	it("does not reuse a token after the integration version changes", async () => {
		let tokenRequests = 0;
		globalThis.fetch = (async (input, init) => {
			const url = input instanceof Request ? input.url : input.toString();
			if (url.endsWith("/admin/oauth/access_token")) {
				tokenRequests += 1;
				return Response.json({
					access_token: `short-lived-token-${tokenRequests}`,
					expires_in: 86_399,
					scope: "read_products,write_products,read_orders",
				});
			}

			const body = JSON.parse(String(init?.body)) as { query: string };
			return body.query.includes("ReadShopCurrency")
				? Response.json({ data: { shop: { currencyCode: "USD" } } })
				: Response.json({ data: { nodes: [] } });
		}) as typeof fetch;

		const client = new ShopifyAdminApiClient();
		await client.readProductsByGid(operationContext, [
			"gid://shopify/Product/1",
		]);
		await client.readProductsByGid(
			{
				...operationContext,
				integrationVersion: 2,
				credentials: {
					...credentials,
					clientSecret: "rotated-client-secret",
					integrationVersion: 2,
				},
			},
			["gid://shopify/Product/1"],
		);

		expect(tokenRequests).toBe(2);
	});

	it("creates and confirms an exact paid-order webhook before removing old subscriptions", async () => {
		const graphQueries: string[] = [];
		const client = new ShopifyAdminApiClient({
			fetch: async (input, init) => {
				const url = input.toString();
				if (url.endsWith("/admin/oauth/access_token")) {
					return Response.json({
						access_token: "token",
						expires_in: 3600,
						scope: "read_orders",
					});
				}
				const body = JSON.parse(String(init?.body)) as {
					query: string;
					variables: Record<string, string>;
				};
				graphQueries.push(body.query);
				if (body.query.includes("ListOrdersPaidWebhookSubscriptions")) {
					return Response.json({
						data: {
							webhookSubscriptions: {
								nodes: [
									{
										id: "gid://shopify/WebhookSubscription/obsolete",
										topic: "ORDERS_PAID",
										uri: "https://old.example.com/orders-paid",
									},
								],
							},
						},
					});
				}
				if (body.query.includes("DeleteOrdersPaidWebhook")) {
					return Response.json({
						data: {
							webhookSubscriptionDelete: {
								deletedWebhookSubscriptionId: body.variables.id,
								userErrors: [],
							},
						},
					});
				}
				return Response.json({
					data: {
						webhookSubscriptionCreate: {
							webhookSubscription: {
								id: "gid://shopify/WebhookSubscription/1",
								topic: "ORDERS_PAID",
								uri: body.variables.uri,
							},
							userErrors: [],
						},
					},
				});
			},
		});

		await client.reconcileOrdersPaidWebhook(
			{
				...operationContext,
				capability: "read_orders",
				grantedScopes: ["read_orders"],
			},
			"https://festival.example.com/api/shopify/webhooks/orders-paid",
		);

		expect(graphQueries.some((query) => query.includes("uri: $uri"))).toBe(
			true,
		);
		expect(graphQueries.some((query) => query.includes("callbackUrl"))).toBe(
			false,
		);
		expect(
			graphQueries.some((query) =>
				query.includes("deletedWebhookSubscriptionId"),
			),
		).toBe(true);
	});

	it("rejects an unconfirmed paid-order webhook creation", async () => {
		const client = new ShopifyAdminApiClient({
			fetch: async (input, init) => {
				if (input.toString().endsWith("/admin/oauth/access_token")) {
					return Response.json({
						access_token: "token",
						expires_in: 3600,
						scope: "read_orders",
					});
				}
				const query = JSON.parse(String(init?.body)).query as string;
				return Response.json({
					data: query.includes("ListOrdersPaidWebhookSubscriptions")
						? { webhookSubscriptions: { nodes: [] } }
						: { webhookSubscriptionCreate: { userErrors: [] } },
				});
			},
		});

		await expect(
			client.reconcileOrdersPaidWebhook(
				{
					...operationContext,
					capability: "read_orders",
					grantedScopes: ["read_orders"],
				},
				"https://festival.example.com/api/shopify/webhooks/orders-paid",
			),
		).rejects.toBeInstanceOf(ShopifyAdminApiError);
	});

	it("rejects non-canonical Shopify destinations before fetch", async () => {
		let calls = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				calls += 1;
				return Response.json({});
			},
		});

		await expect(
			client.readProductsByGid(
				{
					...operationContext,
					verifiedShopDomain: "127.0.0.1",
					credentials: { ...credentials, storeDomain: "127.0.0.1" },
				},
				["gid://shopify/Product/1"],
			),
		).rejects.toBeInstanceOf(ShopifyCredentialsError);
		await expect(
			client.readProductsByGid(
				{
					...operationContext,
					verifiedShopDomain: "evil.test@example.myshopify.com",
					credentials: {
						...credentials,
						storeDomain: "evil.test@example.myshopify.com",
					},
				},
				["gid://shopify/Product/1"],
			),
		).rejects.toBeInstanceOf(ShopifyCredentialsError);
		expect(calls).toBe(0);
	});

	it("uses manual redirects and rejects redirect responses", async () => {
		let redirectMode: RequestRedirect | undefined;
		const client = new ShopifyAdminApiClient({
			fetch: async (_input, init) => {
				redirectMode = init?.redirect;
				return new Response(null, {
					status: 302,
					headers: { Location: "https://attacker.test/token" },
				});
			},
		});

		await expect(client.testCredentials(credentials)).rejects.toThrow(
			"Shopify redirect was rejected.",
		);
		expect(redirectMode).toBe("manual");
	});

	it("aborts timed-out requests with a sanitized failure", async () => {
		const client = new ShopifyAdminApiClient({
			requestTimeoutMs: 5,
			fetch: async (_input, init) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("aborted", "AbortError"));
					});
				}),
		});

		await expect(client.testCredentials(credentials)).rejects.toThrow(
			"Shopify request timed out.",
		);
	});

	it("rejects oversized and malformed JSON responses", async () => {
		const oversized = new ShopifyAdminApiClient({
			maxResponseBytes: 32,
			fetch: async () =>
				Response.json({
					access_token: "x".repeat(64),
					expires_in: 3600,
				}),
		});
		await expect(oversized.testCredentials(credentials)).rejects.toThrow(
			"Shopify response was too large.",
		);

		const malformed = new ShopifyAdminApiClient({
			fetch: async () =>
				new Response("not-json", {
					headers: { "Content-Type": "application/json" },
				}),
		});
		await expect(malformed.testCredentials(credentials)).rejects.toBeInstanceOf(
			ShopifyCredentialsError,
		);
	});

	it("maps bounded GraphQL failures to the Admin API error type", async () => {
		let call = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				call += 1;
				return call === 1
					? Response.json({
							access_token: "token",
							expires_in: 3600,
							scope: "read_products,write_products",
						})
					: new Response("upstream failure", { status: 500 });
			},
		});

		await expect(client.testCredentials(credentials)).rejects.toBeInstanceOf(
			ShopifyAdminApiError,
		);
	});

	it("forces verification refresh, expands implied reads, validates shop identity, and requests no scopes", async () => {
		let tokenRequests = 0;
		const tokenBodies: string[] = [];
		const client = new ShopifyAdminApiClient({
			fetch: async (input, init) => {
				const url = input.toString();
				if (url.endsWith("/admin/oauth/access_token")) {
					tokenRequests += 1;
					tokenBodies.push(String(init?.body));
					return Response.json({
						access_token: `token-${tokenRequests}`,
						expires_in: 3600,
						scope: "read_orders,write_products",
					});
				}
				expect(url).toContain("/admin/api/2026-07/graphql.json");
				return Response.json({
					data: {
						shop: {
							id: "gid://shopify/Shop/1",
							myshopifyDomain: "example.myshopify.com",
						},
					},
				});
			},
		});

		await expect(client.testCredentials(credentials)).resolves.toEqual({
			shopGid: "gid://shopify/Shop/1",
			shopDomain: "example.myshopify.com",
			grantedScopes: ["read_orders", "read_products", "write_products"],
		});
		await client.testCredentials(credentials);
		expect(tokenRequests).toBe(2);
		expect(tokenBodies.every((body) => !body.includes("scope"))).toBeTrue();
	});

	it("authorizes product reads through write_products implied access", async () => {
		const client = new ShopifyAdminApiClient({
			fetch: async (input, init) => {
				if (input.toString().endsWith("/admin/oauth/access_token")) {
					return Response.json({
						access_token: "write-products-token",
						expires_in: 3600,
						scope: "read_orders,write_products",
					});
				}
				const query = JSON.parse(String(init?.body)).query as string;
				return query.includes("ReadShopCurrency")
					? Response.json({ data: { shop: { currencyCode: "USD" } } })
					: Response.json({ data: { nodes: [] } });
			},
		});

		await expect(
			client.readProductsByGid(operationContext, ["gid://shopify/Product/1"]),
		).resolves.toEqual({ value: [] });
	});

	it("rejects a different shop identity", async () => {
		let call = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				call += 1;
				return call === 1
					? Response.json({
							access_token: "token",
							expires_in: 3600,
							scope: "read_products,write_products",
						})
					: Response.json({
							data: {
								shop: {
									id: "gid://shopify/Shop/2",
									myshopifyDomain: "other.myshopify.com",
								},
							},
						});
			},
		});
		await expect(client.testCredentials(credentials)).rejects.toMatchObject({
			failureCategory: "identity_mismatch",
		});
	});

	it("fails closed for missing, non-positive, and non-finite expiry", async () => {
		for (const expires_in of [undefined, 0, -1, Number.POSITIVE_INFINITY]) {
			const client = new ShopifyAdminApiClient({
				fetch: async () =>
					Response.json({
						access_token: "token",
						expires_in,
						scope: "read_products,write_products",
					}),
			});
			await expect(client.testCredentials(credentials)).rejects.toThrow(
				"invalid expiry",
			);
		}
		const missingTokenClient = new ShopifyAdminApiClient({
			fetch: async () =>
				Response.json({
					expires_in: 3600,
					scope: "read_products",
				}),
		});
		await expect(
			missingTokenClient.testCredentials(credentials),
		).rejects.toThrow("did not include an access token");
	});

	it("refreshes at the early-expiry margin and after exact invalidation", async () => {
		let now = 0;
		let tokenRequests = 0;
		const client = new ShopifyAdminApiClient({
			now: () => now,
			fetch: async (input, init) => {
				if (input.toString().endsWith("/admin/oauth/access_token")) {
					tokenRequests += 1;
					return Response.json({
						access_token: `token-${tokenRequests}`,
						expires_in: 120,
						scope: "read_products,write_products",
					});
				}
				const query = JSON.parse(String(init?.body)).query as string;
				return query.includes("ReadShopCurrency")
					? Response.json({ data: { shop: { currencyCode: "USD" } } })
					: Response.json({ data: { nodes: [] } });
			},
		});
		await client.readProductsByGid(operationContext, [
			"gid://shopify/Product/1",
		]);
		now = 60_001;
		await client.readProductsByGid(operationContext, [
			"gid://shopify/Product/1",
		]);
		client.invalidateIntegration("organization-1", 1);
		await client.readProductsByGid(operationContext, [
			"gid://shopify/Product/1",
		]);
		expect(tokenRequests).toBe(3);
	});

	it("isolates cache entries by Festival organization", async () => {
		let tokenRequests = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async (input, init) => {
				if (input.toString().endsWith("/admin/oauth/access_token")) {
					tokenRequests += 1;
					return Response.json({
						access_token: `token-${tokenRequests}`,
						expires_in: 3600,
						scope: "read_products",
					});
				}
				const query = JSON.parse(String(init?.body)).query as string;
				return query.includes("ReadShopCurrency")
					? Response.json({ data: { shop: { currencyCode: "USD" } } })
					: Response.json({ data: { nodes: [] } });
			},
		});
		await client.readProductsByGid(operationContext, [
			"gid://shopify/Product/1",
		]);
		await client.readProductsByGid(
			{
				...operationContext,
				organizationId: "organization-2",
				credentials: { ...credentials, organizationId: "organization-2" },
			},
			["gid://shopify/Product/1"],
		);
		expect(tokenRequests).toBe(2);
	});

	it("denies missing capabilities and older order windows before transport", async () => {
		let fetchCalls = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				fetchCalls += 1;
				return Response.json({});
			},
		});
		await expect(
			client.readProductsByGid(
				{ ...operationContext, grantedScopes: [], capability: "read_products" },
				["gid://shopify/Product/1"],
			),
		).rejects.toThrow("not authorized");
		expect(fetchCalls).toBe(0);
		const revokedScopeClient = new ShopifyAdminApiClient({
			fetch: async () => {
				fetchCalls += 1;
				return Response.json({
					access_token: "token-with-revoked-read-scope",
					expires_in: 3600,
					scope: "read_orders",
				});
			},
		});
		await expect(
			revokedScopeClient.readProductsByGid(operationContext, [
				"gid://shopify/Product/1",
			]),
		).rejects.toMatchObject({ failureCategory: "missing_scope" });
		expect(fetchCalls).toBe(1);

		const orderContext = {
			...operationContext,
			capability: "read_orders" as const,
		};
		expect(() =>
			assertShopifyOrderReadAllowed(
				orderContext,
				new Date("2026-06-01T00:00:00.000Z"),
				new Date("2026-08-12T00:00:00.000Z"),
			),
		).toThrow("most recent 60 days");
		expect(() =>
			assertShopifyOrderReadAllowed(
				{ ...orderContext, grantedScopes: [] },
				new Date("2026-08-01T00:00:00.000Z"),
				new Date("2026-08-12T00:00:00.000Z"),
			),
		).toThrow("not granted");
	});

	it("reads a bounded, tenant-bound paid-order projection without customer PII", async () => {
		let graphqlBody: {
			query: string;
			variables: Record<string, string>;
		} | null = null;
		const client = new ShopifyAdminApiClient({
			fetch: async (input, init) => {
				if (input.toString().endsWith("/admin/oauth/access_token")) {
					return Response.json({
						access_token: "read-orders-token",
						expires_in: 3600,
						scope: "read_orders",
					});
				}
				expect(input.toString()).toContain("/admin/api/2026-07/graphql.json");
				graphqlBody = JSON.parse(String(init?.body)) as {
					query: string;
					variables: Record<string, string>;
				};
				return Response.json(
					{
						data: {
							order: {
								id: "gid://shopify/Order/1",
								fullyPaid: true,
								currencyCode: "USD",
								customer: { id: "gid://shopify/Customer/1" },
								customAttributes: [
									{
										key: "festival_checkout_intent_id",
										value: "correlation-1",
									},
								],
								lineItems: {
									nodes: [
										{
											id: "gid://shopify/LineItem/1",
											product: { id: "gid://shopify/Product/1" },
											variant: { id: "gid://shopify/ProductVariant/1" },
											quantity: 1,
											discountedTotalSet: {
												presentmentMoney: {
													amount: "125.00",
													currencyCode: "USD",
												},
											},
										},
									],
									pageInfo: { hasNextPage: false },
								},
								transactions: [
									{
										kind: "SALE",
										status: "SUCCESS",
										processedAt: "2026-08-28T18:00:00.000Z",
									},
									{
										kind: "CAPTURE",
										status: "SUCCESS",
										processedAt: "2026-08-28T18:01:00.000Z",
									},
								],
							},
						},
					},
					{ headers: { "x-request-id": "read-order-request" } },
				);
			},
		});

		await expect(
			client.readPaidOrderByGid(
				{ ...operationContext, capability: "read_orders" },
				"gid://shopify/Order/1",
			),
		).resolves.toEqual({
			value: {
				id: "gid://shopify/Order/1",
				customerGid: "gid://shopify/Customer/1",
				fullyPaid: true,
				fullyPaidAtIso: "2026-08-28T18:01:00.000Z",
				currencyCode: "USD",
				customAttributes: [
					{
						key: "festival_checkout_intent_id",
						value: "correlation-1",
					},
				],
				lineItems: [
					{
						id: "gid://shopify/LineItem/1",
						productGid: "gid://shopify/Product/1",
						variantGid: "gid://shopify/ProductVariant/1",
						quantity: 1,
						paidAmount: "125.00",
						paidCurrencyCode: "USD",
					},
				],
			},
			requestId: "read-order-request",
		});
		expect(graphqlBody?.variables).toEqual({
			orderId: "gid://shopify/Order/1",
		});
		expect(graphqlBody?.query).toContain("fullyPaid");
		expect(graphqlBody?.query).toContain("discountedTotalSet");
		expect(graphqlBody?.query).toContain("transactions(first: 250)");
		expect(graphqlBody?.query).not.toContain("email");
		expect(graphqlBody?.query).not.toContain("phone");
		expect(graphqlBody?.query).not.toContain("shippingAddress");
	});

	it("fails closed before transport for an unauthorized or malformed order read", async () => {
		let fetchCalls = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				fetchCalls += 1;
				return Response.json({});
			},
		});

		await expect(
			client.readPaidOrderByGid(
				{ ...operationContext, capability: "read_products" },
				"gid://shopify/Order/1",
			),
		).rejects.toThrow("not authorized");
		await expect(
			client.readPaidOrderByGid(
				{ ...operationContext, capability: "read_orders" },
				"not-a-shopify-order-id",
			),
		).rejects.toThrow("order ID is invalid");
		expect(fetchCalls).toBe(0);
	});

	it("does not invent a paid timestamp and rejects incomplete paid-order projections", async () => {
		let call = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				call += 1;
				if (call === 1) {
					return Response.json({
						access_token: "read-orders-token",
						expires_in: 3600,
						scope: "read_orders",
					});
				}
				return Response.json({
					data: {
						order: {
							id: "gid://shopify/Order/1",
							fullyPaid: true,
							currencyCode: "USD",
							customer: { id: "gid://shopify/Customer/1" },
							customAttributes: [],
							lineItems: { nodes: [], pageInfo: { hasNextPage: false } },
							transactions: [
								{ kind: "SALE", status: "PENDING", processedAt: null },
							],
						},
					},
				});
			},
		});

		await expect(
			client.readPaidOrderByGid(
				{ ...operationContext, capability: "read_orders" },
				"gid://shopify/Order/1",
			),
		).rejects.toThrow("successful payment timestamp");
	});

	it("returns an unpaid order without a fabricated fully-paid timestamp", async () => {
		let call = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				call += 1;
				if (call === 1) {
					return Response.json({
						access_token: "read-orders-token",
						expires_in: 3600,
						scope: "read_orders",
					});
				}
				return Response.json({
					data: {
						order: {
							id: "gid://shopify/Order/1",
							fullyPaid: false,
							currencyCode: "USD",
							customer: { id: "gid://shopify/Customer/1" },
							customAttributes: [],
							lineItems: { nodes: [], pageInfo: { hasNextPage: false } },
							transactions: [],
						},
					},
				});
			},
		});

		await expect(
			client.readPaidOrderByGid(
				{ ...operationContext, capability: "read_orders" },
				"gid://shopify/Order/1",
			),
		).resolves.toEqual({
			value: {
				id: "gid://shopify/Order/1",
				customerGid: "gid://shopify/Customer/1",
				fullyPaid: false,
				currencyCode: "USD",
				customAttributes: [],
				lineItems: [],
			},
		});
	});

	it("captures bounded request IDs without exposing raw upstream bodies", async () => {
		let call = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				call += 1;
				if (call === 1) {
					return Response.json({
						access_token: "secret-token-canary",
						expires_in: 3600,
						scope: "read_products",
					});
				}
				if (call === 2) {
					return Response.json({ data: { shop: { currencyCode: "USD" } } });
				}
				return new Response("raw-upstream-secret-canary", {
					status: 403,
					headers: { "x-request-id": "shopify-request-403" },
				});
			},
		});
		try {
			await client.readProductsByGid(operationContext, [
				"gid://shopify/Product/1",
			]);
			throw new Error("Expected request to fail.");
		} catch (error) {
			expect(error).toMatchObject({
				message: "Shopify authorization failed.",
				requestId: "shopify-request-403",
			});
			expect(JSON.stringify(error)).not.toContain("canary");
		}
	});

	it("rejects product deletions that do not confirm the requested product", async () => {
		let call = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				call += 1;
				if (call === 1) {
					return Response.json({
						access_token: "token",
						expires_in: 3600,
						scope: "write_products",
					});
				}
				return Response.json(
					{
						data: {
							productDelete: {
								deletedProductId: "gid://shopify/Product/other",
								userErrors: [],
							},
						},
					},
					{ headers: { "x-request-id": "request-delete-mismatch" } },
				);
			},
		});

		await expect(
			client.deleteProduct(
				{ ...operationContext, capability: "write_products" },
				"gid://shopify/Product/requested",
			),
		).rejects.toMatchObject({
			message: "Shopify product deletion returned no matching product.",
			requestId: "request-delete-mismatch",
		});
	});

	it("classifies token authorization, throttling, GraphQL, and user errors", async () => {
		const unauthorized = new ShopifyAdminApiClient({
			fetch: async () =>
				new Response("credential-secret-canary", { status: 401 }),
		});
		await expect(
			unauthorized.testCredentials(credentials),
		).rejects.toMatchObject({ failureCategory: "credentials" });

		let throttledCall = 0;
		const throttled = new ShopifyAdminApiClient({
			fetch: async () => {
				throttledCall += 1;
				if (throttledCall === 1) {
					return Response.json({
						access_token: "token",
						expires_in: 3600,
						scope: "read_products",
					});
				}
				if (throttledCall === 2) {
					return Response.json({ data: { shop: { currencyCode: "USD" } } });
				}
				return new Response("throttle-secret-canary", {
					status: 429,
					headers: {
						"retry-after": "12",
						"x-shopify-request-id": "request-throttled",
					},
				});
			},
		});
		await expect(
			throttled.readProductsByGid(operationContext, [
				"gid://shopify/Product/1",
			]),
		).rejects.toMatchObject({
			message: "Shopify request was throttled.",
			failureCategory: "upstream",
			requestId: "request-throttled",
			retryAfterSeconds: 12,
		});

		let graphqlCall = 0;
		const graphqlFailure = new ShopifyAdminApiClient({
			fetch: async () => {
				graphqlCall += 1;
				return graphqlCall === 1
					? Response.json({
							access_token: "token",
							expires_in: 3600,
							scope: "read_products,write_products",
						})
					: Response.json(
							{ errors: [{ message: "raw-graphql-secret-canary" }] },
							{ headers: { "x-request-id": "request-graphql" } },
						);
			},
		});
		await expect(
			graphqlFailure.testCredentials(credentials),
		).rejects.toMatchObject({
			message: "Shopify Admin API returned an error.",
			requestId: "request-graphql",
		});

		let mutationCall = 0;
		const mutationFailure = new ShopifyAdminApiClient({
			fetch: async () => {
				mutationCall += 1;
				if (mutationCall === 1) {
					return Response.json({
						access_token: "token",
						expires_in: 3600,
						scope: "read_products,write_products",
					});
				}
				if (mutationCall === 2) {
					return Response.json({ data: { shop: { currencyCode: "USD" } } });
				}
				return Response.json(
					{
						data: {
							productCreate: {
								userErrors: [{ message: "raw-user-secret-canary" }],
							},
						},
					},
					{ headers: { "x-request-id": "request-user-error" } },
				);
			},
		});
		await expect(
			mutationFailure.createProduct(
				{ ...operationContext, capability: "write_products" },
				{ name: "Membership" },
			),
		).rejects.toBeInstanceOf(ShopifyUserError);
	});
});
