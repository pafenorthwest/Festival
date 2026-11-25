import { describe, expect, it, mock } from "bun:test";
import { ShopifyMembershipCheckoutClient } from "../src/checkout/shopify-membership-checkout-client.js";
import { CustomerAccountTransport } from "../src/customer/customer-account-transport.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";

describe("ShopifyMembershipCheckoutClient", () => {
	for (const failure of ["missing", "undecryptable"] as const) {
		it(`rejects ${failure} private credentials before sending any Shopify request`, async () => {
			const keyring = ShopifySecretKeyring.fromEnvironment(
				JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64") }),
				"test",
			);
			if (!keyring) throw new Error("keyring");
			const requester = mock(async () => {
				throw new Error("Unexpected Shopify request");
			});
			const client = new ShopifyMembershipCheckoutClient(
				{
					getShopifyIntegration: async () => ({
						storeDomain: "festival.myshopify.com",
						integrationVersion: 1,
						encryptedStorefrontPrivateToken:
							failure === "missing" ? undefined : "corrupt-secret-ciphertext",
					}),
				} as never,
				keyring,
				new CustomerAccountTransport({
					resolver: async () => [
						{ address: "8.8.8.8", family: 4, ttlSeconds: 60 },
					],
					requester,
				}),
			);
			const error = {
				status: 503,
				code: "checkout_storefront_credentials_unavailable",
				message: "Shopify Storefront credentials are unavailable.",
			};
			await expect(
				client.createCart({
					organizationId: "org",
					buyerAccessToken: "buyer-token",
					correlationId: "correlation",
				}),
			).rejects.toMatchObject(error);
			await expect(
				client.checkout({ organizationId: "org", shopifyCartId: "cart" }),
			).rejects.toMatchObject(error);
			await expect(
				client.inspectCart({ organizationId: "org", shopifyCartId: "cart" }),
			).rejects.toMatchObject(error);
			await expect(
				client.updateBuyerIdentity({
					organizationId: "org",
					shopifyCartId: "cart",
					buyerAccessToken: "current-buyer-token",
				}),
			).rejects.toMatchObject(error);
			expect(requester).not.toHaveBeenCalled();
		});
	}

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
					integrationVersion: 3,
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
				expectedStorefrontBinding: {
					shopDomain: "festival.myshopify.com",
					integrationVersion: 3,
				},
				idempotencyKey: "festival-only-do-not-forward",
			} as never),
		).resolves.toEqual({ shopifyCartId: "gid://shopify/Cart/private" });
		expect(body).toContain("festival_checkout_intent_id");
		expect(body).toContain("opaque-intent");
		expect(body).not.toContain("private-token");
		expect(body).not.toContain("festival-only-do-not-forward");
		expect(new Headers(headers).has("Idempotency-Key")).toBe(false);
	});

	function checkoutFixture(responseForQuery: (query: string) => object) {
		const apiDomain = "jrke10-1k.myshopify.com";
		const integrationVersion = 3;
		const queries: string[] = [];
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async (url, _answer, _agent, init) => {
				expect(url.href).toBe(`https://${apiDomain}/api/2026-07/graphql.json`);
				expect(
					new Headers(init?.headers).get("Shopify-Storefront-Private-Token"),
				).toBe("private-token");
				const { query } = JSON.parse(String(init?.body)) as { query: string };
				queries.push(query);
				const response = responseForQuery(query);
				return {
					status: 200,
					body: (async function* () {
						yield new TextEncoder().encode(JSON.stringify(response));
					})(),
				};
			},
		});
		const client = new ShopifyMembershipCheckoutClient(
			{
				getShopifyIntegration: async () => ({
					storeDomain: apiDomain,
					integrationVersion,
					encryptedStorefrontPrivateToken: "ciphertext",
				}),
			} as never,
			{ decrypt: () => "private-token" } as never,
			transport,
		);
		const cart = {
			organizationId: "org",
			shopifyCartId: "gid://shopify/Cart/private",
			expectedStorefrontBinding: { shopDomain: apiDomain, integrationVersion },
		};
		return { client, cart, queries };
	}

	it("queries the primary domain separately for cross-origin membership checkout", async () => {
		const shopPrimaryDomainUrl =
			"https://performing-arts-festival-eastside.myshopify.com";
		const checkoutUrl = `${shopPrimaryDomainUrl}/checkouts/fresh`;
		const { client, cart, queries } = checkoutFixture((query) =>
			query.includes("primaryDomain")
				? { data: { shop: { primaryDomain: { url: shopPrimaryDomainUrl } } } }
				: { data: { cart: { checkoutUrl } } },
		);
		await expect(
			client.checkout({ ...cart, includeShopPrimaryDomain: true }),
		).resolves.toEqual({ checkoutUrl, shopPrimaryDomainUrl });
		expect(queries).toHaveLength(2);
		const [cartQuery, shopQuery] = queries;
		expect(cartQuery).toContain("checkoutUrl");
		expect(cartQuery).not.toContain("primaryDomain");
		expect(shopQuery).toContain("primaryDomain");
		expect(shopQuery).not.toContain("checkoutUrl");

		await expect(client.checkout(cart)).resolves.toEqual({ checkoutUrl });
		expect(queries).toEqual([cartQuery, shopQuery, cartQuery]);
	});

	it("resolves an existing API-domain checkout with cart-only permissions", async () => {
		const checkoutUrl = "https://jrke10-1k.myshopify.com/checkouts/pending";
		const { client, cart, queries } = checkoutFixture((query) =>
			/\bshop\s*\{/.test(query)
				? {
						errors: [
							{
								message: "Access denied for shop field.",
								extensions: { code: "ACCESS_DENIED" },
							},
						],
					}
				: { data: { cart: { checkoutUrl } } },
		);
		await expect(
			client.checkout({ ...cart, includeShopPrimaryDomain: true }),
		).resolves.toEqual({ checkoutUrl });
		expect(queries).toHaveLength(1);
		expect(queries[0]).toContain("checkoutUrl");
		expect(queries[0]).not.toMatch(/\bshop\s*\{/);
	});

	it("rejects a changed Storefront version or shop at the credential read before contacting Shopify", async () => {
		const decrypt = mock(() => "private-token");
		const requester = mock(async () => {
			throw new Error("Unexpected Storefront request");
		});
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester,
		});
		const client = new ShopifyMembershipCheckoutClient(
			{
				getShopifyIntegration: async () => ({
					storeDomain: "festival.myshopify.com",
					integrationVersion: 2,
					encryptedStorefrontPrivateToken: "ciphertext",
				}),
			} as never,
			{ decrypt } as never,
			transport,
		);
		for (const expectedStorefrontBinding of [
			{ shopDomain: "festival.myshopify.com", integrationVersion: 1 },
			{ shopDomain: "other-festival.myshopify.com", integrationVersion: 2 },
		]) {
			const input = { organizationId: "org", expectedStorefrontBinding };
			const cart = { ...input, shopifyCartId: "gid://shopify/Cart/private" };
			const error = { code: "checkout_storefront_binding_changed" };
			await expect(
				client.createCart({
					...input,
					shopifyVariantGid: "gid://shopify/ProductVariant/1",
					buyerAccessToken: "customer-token",
					correlationId: "opaque-intent",
				}),
			).rejects.toMatchObject(error);
			await expect(client.checkout(cart)).rejects.toMatchObject(error);
			await expect(client.inspectCart(cart)).rejects.toMatchObject(error);
			await expect(
				client.updateBuyerIdentity({
					...cart,
					buyerAccessToken: "current-buyer-token",
				}),
			).rejects.toMatchObject(error);
		}
		expect(decrypt).not.toHaveBeenCalled();
		expect(requester).not.toHaveBeenCalled();
	});

	it("passes checkout URL cancellation to the requester and preserves its reason", async () => {
		const started = Promise.withResolvers<AbortSignal | null | undefined>();
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async (_url, _answer, _agent, init) => {
				const signal = init?.signal;
				started.resolve(signal);
				return new Promise((_, reject) => {
					const onAbort = () => reject(new Error("Aborted"));
					signal?.addEventListener("abort", onAbort, { once: true });
				});
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
		const controller = new AbortController();
		const result = client.checkout({
			organizationId: "org",
			shopifyCartId: "gid://shopify/Cart/private",
			signal: controller.signal,
		});
		expect(await started.promise).toBe(controller.signal);
		const reason = new Error("Checkout lookup timed out.");
		controller.abort(reason);
		await expect(result).rejects.toBe(reason);
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

describe("ShopifyMembershipCheckoutClient live checkout recovery", () => {
	const cartId = "gid://shopify/Cart/existing-cart?key=existing-secret";
	const binding = {
		shopDomain: "festival.myshopify.com",
		integrationVersion: 4,
	};

	function fixture(initialPayload: unknown) {
		let payload = initialPayload;
		const requests: Array<{
			url: string;
			address: string;
			body: string;
			headers: Headers;
		}> = [];
		const decrypt = mock(() => "private-storefront-token");
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async (url, answer, _agent, init) => {
				requests.push({
					url: String(url),
					address: answer.address,
					body: String(init?.body),
					headers: new Headers(init?.headers),
				});
				return {
					status: 200,
					body: (async function* () {
						yield new TextEncoder().encode(JSON.stringify(payload));
					})(),
				};
			},
		});
		const client = new ShopifyMembershipCheckoutClient(
			{
				getShopifyIntegration: async () => ({
					storeDomain: binding.shopDomain,
					integrationVersion: binding.integrationVersion,
					encryptedStorefrontPrivateToken: "ciphertext",
				}),
			} as never,
			{ decrypt } as never,
			transport,
		);
		return {
			client,
			requests,
			decrypt,
			respond: (value: unknown) => {
				payload = value;
			},
		};
	}

	function cartPayload(cost?: unknown) {
		return {
			data: {
				cart: {
					attributes: [
						{ key: "festival_checkout_intent_id", value: "original-checkout" },
					],
					buyerIdentity: { customer: { id: "gid://shopify/Customer/12" } },
					...(cost === undefined ? {} : { cost }),
					lines: {
						pageInfo: { hasNextPage: false },
						nodes: [
							{
								quantity: 1,
								attributes: [
									{
										key: "festival_checkout_intent_line_id",
										value: "original-line",
									},
								],
								merchandise: { id: "gid://shopify/ProductVariant/34" },
							},
						],
					},
				},
			},
		};
	}

	it("refreshes only the persisted cart's buyer with the current token and never creates a cart", async () => {
		const { client, requests } = fixture({
			data: {
				cartBuyerIdentityUpdate: { cart: { id: cartId }, userErrors: [] },
			},
		});
		await expect(
			client.updateBuyerIdentity({
				organizationId: "org",
				shopifyCartId: cartId,
				buyerAccessToken: "renewed-session-token",
				expectedStorefrontBinding: binding,
				idempotencyKey: "private-festival-request-key",
				recoveryReference: "private-festival-recovery-reference",
				childId: "private-child-id",
				correlationId: "private-original-correlation",
			} as never),
		).resolves.toBeUndefined();
		expect(requests).toHaveLength(1);
		const request = requests[0];
		expect(request.url).toBe(
			"https://festival.myshopify.com/api/2026-07/graphql.json",
		);
		expect(request.address).toBe("8.8.8.8");
		const body = JSON.parse(request.body);
		expect(body.variables).toEqual({
			cartId,
			buyer: { customerAccessToken: "renewed-session-token" },
		});
		expect(body.query).toContain("cartBuyerIdentityUpdate");
		expect(body.query).not.toContain("cartCreate");
		expect(request.headers.get("Shopify-Storefront-Private-Token")).toBe(
			"private-storefront-token",
		);
		expect(request.headers.has("Idempotency-Key")).toBe(false);
		for (const secret of [
			"private-festival-request-key",
			"private-festival-recovery-reference",
			"private-child-id",
			"private-original-correlation",
			"private-storefront-token",
		]) {
			expect(request.body).not.toContain(secret);
		}
	});

	it("rejects an absent renewed buyer token without decrypting or making a request", async () => {
		const { client, requests, decrypt } = fixture({});
		await expect(
			client.updateBuyerIdentity({
				organizationId: "org",
				shopifyCartId: cartId,
				buyerAccessToken: "",
				expectedStorefrontBinding: binding,
			}),
		).rejects.toMatchObject({ status: 503 });
		expect(requests).toHaveLength(0);
		expect(decrypt).not.toHaveBeenCalled();
	});

	it("rejects user errors, incomplete responses and a different returned cart without fallback creation", async () => {
		const { client, requests, respond } = fixture({});
		for (const payload of [
			{},
			{ data: {} },
			{ data: { cartBuyerIdentityUpdate: null } },
			{ data: { cartBuyerIdentityUpdate: { cart: { id: cartId } } } },
			{
				data: {
					cartBuyerIdentityUpdate: {
						cart: { id: cartId },
						userErrors: [{ message: "buyer token is invalid" }],
					},
				},
			},
			{ data: { cartBuyerIdentityUpdate: { cart: null, userErrors: [] } } },
			{
				data: {
					cartBuyerIdentityUpdate: {
						cart: { id: "gid://shopify/Cart/different-cart" },
						userErrors: [],
					},
				},
			},
			{
				data: {
					cartBuyerIdentityUpdate: { cart: { id: cartId }, userErrors: [] },
				},
				errors: [{ message: "partial Shopify failure" }],
			},
		]) {
			respond(payload);
			const requestCount = requests.length;
			await expect(
				client.updateBuyerIdentity({
					organizationId: "org",
					shopifyCartId: cartId,
					buyerAccessToken: "renewed-session-token",
					expectedStorefrontBinding: binding,
				}),
			).rejects.toMatchObject({ status: 503 });
			expect(requests).toHaveLength(requestCount + 1);
			expect(requests.at(-1)?.body).not.toContain("cartCreate");
		}
	});

	it("returns live estimated cart total separately from payment amounts without forwarding Festival data", async () => {
		const { client, requests } = fixture(
			cartPayload({ totalAmount: { amount: "137.25", currencyCode: "CAD" } }),
		);
		const result = await client.inspectCart({
			organizationId: "org",
			shopifyCartId: cartId,
			expectedStorefrontBinding: binding,
			idempotencyKey: "private-festival-request-key",
			childId: "private-child-id",
			amount: "1.00",
		} as never);
		expect(result).toMatchObject({
			correlationId: "original-checkout",
			customerGid: "gid://shopify/Customer/12",
			estimatedTotal: { amount: "137.25", currencyCode: "CAD" },
			lines: [{ intentLineId: "original-line", quantity: 1 }],
		});
		expect(result).not.toHaveProperty("received");
		expect(result).not.toHaveProperty("outstanding");
		expect(requests).toHaveLength(1);
		const body = JSON.parse(requests[0].body);
		expect(body.variables).toEqual({ id: cartId });
		expect(body.query).toContain("cost { totalAmount");
		expect(body.query).not.toContain("mutation");
		expect(requests[0].body).not.toContain("private-festival-request-key");
		expect(requests[0].body).not.toContain("private-child-id");
	});

	it("does not fabricate an estimated total when Shopify omits or malforms cost", async () => {
		const { client, respond } = fixture({});
		for (const cost of [
			undefined,
			null,
			{},
			{ totalAmount: null },
			{ totalAmount: { amount: 0, currencyCode: "USD" } },
			{ totalAmount: { amount: "NaN", currencyCode: "USD" } },
			{ totalAmount: { amount: "-10.00", currencyCode: "USD" } },
			{ totalAmount: { amount: "1e2", currencyCode: "USD" } },
			{ totalAmount: { amount: "10.00", currencyCode: "usd" } },
			{ totalAmount: { amount: "10.00" } },
		]) {
			respond(cartPayload(cost));
			const result = await client.inspectCart({
				organizationId: "org",
				shopifyCartId: cartId,
				expectedStorefrontBinding: binding,
			});
			expect(result).not.toHaveProperty("estimatedTotal");
			expect(result.lines).toHaveLength(1);
		}
	});
});
