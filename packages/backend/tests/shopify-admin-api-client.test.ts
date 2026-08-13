import { afterEach, describe, expect, it } from "bun:test";
import { ShopifyAdminApiClient } from "../src/shopify/admin-api-client.js";
import {
	ShopifyAdminApiError,
	ShopifyCredentialsError,
} from "../src/shopify/errors.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("ShopifyAdminApiClient", () => {
	const credentials = {
		storeDomain: "example.myshopify.com",
		clientId: "client-id",
		clientSecret: "client-secret",
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

	it("rejects non-canonical Shopify destinations before fetch", async () => {
		let calls = 0;
		const client = new ShopifyAdminApiClient({
			fetch: async () => {
				calls += 1;
				return Response.json({});
			},
		});

		await expect(
			client.readProductsByGid({ ...credentials, storeDomain: "127.0.0.1" }, [
				"gid://shopify/Product/1",
			]),
		).rejects.toBeInstanceOf(ShopifyCredentialsError);
		await expect(
			client.readProductsByGid(
				{ ...credentials, storeDomain: "evil.test@example.myshopify.com" },
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
					? Response.json({ access_token: "token", expires_in: 3600 })
					: new Response("upstream failure", { status: 500 });
			},
		});

		await expect(client.testCredentials(credentials)).rejects.toBeInstanceOf(
			ShopifyAdminApiError,
		);
	});
});
