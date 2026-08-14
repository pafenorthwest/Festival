import { describe, expect, it } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { CustomerAccountTransport } from "../src/customer/customer-account-transport.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = keys.publicKey.export({ format: "jwk" });
const issuer = "https://shopify.com/authentication/shop-1";
function jwt(
	nonce?: string,
	overrides: Record<string, unknown> = {},
	kid = "test",
) {
	const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString(
		"base64url",
	);
	const payload = Buffer.from(
		JSON.stringify({
			iss: issuer,
			aud: "customer-client",
			exp: Math.floor(Date.now() / 1000) + 3600,
			nonce,
			...overrides,
		}),
	).toString("base64url");
	const body = `${header}.${payload}`;
	return `${body}.${sign("RSA-SHA256", Buffer.from(body), keys.privateKey).toString("base64url")}`;
}
function response(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function transportFor(fetcher: typeof fetch, now: () => Date) {
	return new CustomerAccountTransport({
		resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
		now: () => now().getTime(),
		requester: async (url, _answer, _agent, init) => {
			const result = await fetcher(url, init);
			const bytes = new Uint8Array(await result.arrayBuffer());
			return {
				status: result.status,
				contentLength: bytes.byteLength,
				body: (async function* () {
					yield bytes;
				})(),
			};
		},
	});
}

async function fixture() {
	const organizations = new InMemoryOrganizationRepository();
	const org = await organizations.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	const other = await organizations.createOrganization({
		name: "Other",
		slug: "other",
	});
	const repository = new InMemoryCustomerAccountRepository();
	let nonce = "";
	let tokenCalls = 0;
	let denyOrders = false;
	let tokenClaims: Record<string, unknown> = {};
	let tokenKid = "test";
	let jwksKid = "test";
	let jwksCalls = 0;
	let discoveryCalls = 0;
	let discoveryIssuer = issuer;
	let authorizationEndpoint = "https://accounts.shopify.com/auth";
	let now = new Date();
	const fetcher: typeof fetch = async (input, init) => {
		const url = new URL(input.toString());
		if (url.pathname === "/.well-known/openid-configuration") {
			discoveryCalls++;
			return response({
				issuer: discoveryIssuer,
				authorization_endpoint: authorizationEndpoint,
				token_endpoint: "https://accounts.shopify.com/token",
				end_session_endpoint: "https://accounts.shopify.com/logout",
				jwks_uri: "https://accounts.shopify.com/jwks",
			});
		}
		if (url.pathname === "/.well-known/customer-account-api") {
			discoveryCalls++;
			return response({
				graphql_api:
					"https://accounts.shopify.com/customer/api/2026-07/graphql",
			});
		}
		if (url.pathname === "/jwks") {
			jwksCalls++;
			return response({
				keys: [{ ...jwk, kid: jwksKid, alg: "RS256", use: "sig" }],
			});
		}
		if (url.pathname === "/token") {
			tokenCalls++;
			const body = String(init?.body);
			return response({
				access_token: `access-${tokenCalls}`,
				refresh_token: `refresh-${tokenCalls}`,
				...(body.includes("authorization_code")
					? { id_token: jwt(nonce, tokenClaims, tokenKid) }
					: {}),
				expires_in: 60,
			});
		}
		if (url.pathname.endsWith("/graphql")) {
			const body = JSON.parse(String(init?.body));
			if (body.query.includes("FestivalCustomerIdentity"))
				return response({
					data: { customer: { id: "gid://shopify/Customer/42" } },
				});
			if (denyOrders)
				return response({
					data: { customer: null },
					errors: [
						{ message: "protected data denied", token: "must-not-leak" },
					],
				});
			return response({
				data: {
					customer: {
						orders: {
							nodes: [
								{
									number: "1001",
									createdAt: "2026-08-01T00:00:00.000Z",
									totalPrice: { amount: "25.00", currencyCode: "USD" },
									financialStatus: "PAID",
									fulfillmentStatus: "FULFILLED",
									cancelledAt: null,
									cancelReason: null,
									totalRefunded: { amount: "0.00", currencyCode: "USD" },
									lineItems: {
										nodes: [
											{
												title: "Festival entry",
												quantity: 1,
												totalPrice: { amount: "25.00", currencyCode: "USD" },
											},
										],
									},
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
		throw new Error(`Unexpected URL ${url}`);
	};
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64") }),
		"test",
	);
	if (!keyring) throw new Error("keyring");
	const service = new CustomerAccountService(
		repository,
		organizations,
		keyring,
		{
			publicOrigin: "https://festival.example.com",
			transport: transportFor(fetcher, () => now),
			now: () => now,
		},
	);
	await service.saveAndVerify(org.id, org.slug, {
		storefrontDomain: "store.example.com",
		clientId: "customer-client",
		clientSecret: "customer-secret",
	});
	async function begin() {
		const authorization = await service.start("festival");
		const authUrl = new URL(authorization);
		nonce = authUrl.searchParams.get("nonce") ?? "";
		return authUrl;
	}
	async function authenticate() {
		const authUrl = await begin();
		return service.callback(authUrl.searchParams.get("state") ?? "", "code-1");
	}
	return {
		service,
		repository,
		org,
		other,
		keyring,
		begin,
		authenticate,
		setNow: (value: Date) => {
			now = value;
		},
		setDeny: (value: boolean) => {
			denyOrders = value;
		},
		setTokenClaims: (value: Record<string, unknown>) => {
			tokenClaims = value;
		},
		setSigningKid: (value: string) => {
			tokenKid = value;
			jwksKid = value;
		},
		setDiscoveryIssuer: (value: string) => {
			discoveryIssuer = value;
		},
		setAuthorizationEndpoint: (value: string) => {
			authorizationEndpoint = value;
		},
		tokenCalls: () => tokenCalls,
		discoveryCalls: () => discoveryCalls,
		jwksCalls: () => jwksCalls,
	};
}

describe("CustomerAccountService", () => {
	it("keeps configuration separate, validates discovery, and never returns the secret", async () => {
		const f = await fixture();
		const stored = await f.repository.getIntegration(f.org.id);
		expect(stored?.encryptedClientSecret).not.toContain("customer-secret");
		const settings = await f.service.getSettings(f.org.id, "festival");
		expect(settings.settings?.callbackUrl).toBe(
			"https://festival.example.com/api/customer-auth/callback",
		);
		expect(settings.settings).not.toHaveProperty("clientSecret");
	});
	it("uses one-time state, encrypted tokens, tenant-bound opaque sessions, and allowlisted orders", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		expect(auth.sessionId).not.toContain("gid://");
		const replay = await f.service
			.callback("invalid", "code")
			.catch((error) => error);
		expect(replay.status).toBe(400);
		const stored = await f.repository.getSession(auth.sessionId);
		expect(stored?.encryptedTokens).not.toContain("access-1");
		if (!stored) throw new Error("session");
		expect(() =>
			f.keyring.decrypt(stored.encryptedTokens, {
				organizationId: f.other.id,
				purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
			}),
		).toThrow();
		expect(
			(await f.service.session("other", auth.sessionId)).session.authenticated,
		).toBe(false);
		const orders = await f.service.orders("festival", auth.sessionId);
		expect(orders.orders[0]).toEqual({
			orderNumber: "1001",
			createdAtIso: "2026-08-01T00:00:00.000Z",
			total: { amount: "25.00", currencyCode: "USD" },
			financialStatus: "PAID",
			fulfillmentStatus: "FULFILLED",
			cancellation: null,
			refund: null,
			lineItems: [
				{
					title: "Festival entry",
					quantity: 1,
					total: { amount: "25.00", currencyCode: "USD" },
				},
			],
		});
		expect(JSON.stringify(orders)).not.toContain("gid://shopify/Customer");
	});
	it("rejects replay, nonce, issuer, audience, and open-return-target failures", async () => {
		const replayFixture = await fixture();
		const replayUrl = await replayFixture.begin();
		const state = replayUrl.searchParams.get("state") ?? "";
		await replayFixture.service.callback(state, "code");
		await expect(replayFixture.service.callback(state, "code")).rejects.toThrow(
			"invalid",
		);
		expect(replayFixture.tokenCalls()).toBe(1);
		for (const claims of [
			{ nonce: "wrong" },
			{ iss: "https://evil.example" },
			{ aud: "other-client" },
		]) {
			const f = await fixture();
			const url = await f.begin();
			f.setTokenClaims(claims);
			await expect(
				f.service.callback(url.searchParams.get("state") ?? "", "code"),
			).rejects.toThrow("invalid");
		}
		const target = await fixture();
		await expect(
			target.service.start("festival", "https://evil.example/callback"),
		).rejects.toThrow("Return target");
	});
	it("serializes refresh within one backend process and rotates encrypted tokens", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		f.setNow(new Date(Date.now() + 61_000));
		await Promise.all([
			f.service.orders("festival", auth.sessionId),
			f.service.orders("festival", auth.sessionId),
		]);
		expect(f.tokenCalls()).toBe(2);
		const stored = await f.repository.getSession(auth.sessionId);
		expect(stored?.encryptedTokens).not.toContain("refresh-2");
	});
	it("invalidates a session when later discovery resolves to a different Shopify issuer", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		f.setDiscoveryIssuer("https://shopify.com/authentication/shop-2");
		f.setNow(new Date(Date.now() + 6 * 60_000));
		await expect(f.service.orders("festival", auth.sessionId)).rejects.toThrow(
			"invalid",
		);
		expect(
			(await f.service.session("festival", auth.sessionId)).session
				.authenticated,
		).toBe(false);
	});
	it("fails closed on protected-data denial and enforces CSRF and exact origin for logout", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		f.setDeny(true);
		const denial = await f.service
			.orders("festival", auth.sessionId)
			.catch((error) => error);
		expect(denial.status).toBe(403);
		expect(denial.message).not.toContain("must-not-leak");
		const session = await f.service.session("festival", auth.sessionId);
		if (!session.session.authenticated) throw new Error("session");
		await expect(
			f.service.logout(
				"festival",
				auth.sessionId,
				"wrong",
				"https://festival.example.com",
			),
		).rejects.toThrow("CSRF");
		const redirect = await f.service.logout(
			"festival",
			auth.sessionId,
			session.session.csrfToken,
			"https://festival.example.com",
		);
		expect(redirect).toContain("id_token_hint=");
		expect(
			(await f.service.session("festival", auth.sessionId)).session
				.authenticated,
		).toBe(false);
	});
	it("reuses metadata, refreshes an unknown signing key once, and invalidates on integration change", async () => {
		const f = await fixture();
		expect(f.discoveryCalls()).toBe(2);
		await Promise.all([f.begin(), f.begin(), f.begin()]);
		expect(f.discoveryCalls()).toBe(2);
		await f.authenticate();
		await f.authenticate();
		expect(f.jwksCalls()).toBe(1);
		f.setSigningKid("rotated");
		await f.authenticate();
		expect(f.jwksCalls()).toBe(2);
		const result = await f.service.saveAndVerify(f.org.id, "festival", {
			storefrontDomain: "store.example.com",
			clientId: "customer-client",
			clientSecret: "customer-secret",
		});
		expect(result.settings.readiness).toBe("ready");
		expect(f.discoveryCalls()).toBe(4);
		expect(JSON.stringify(f.service.cacheMetrics())).not.toContain(
			"store.example.com",
		);
	});
	it("rejects unsafe discovery destinations", async () => {
		const f = await fixture();
		const result = await f.service.saveAndVerify(f.other.id, "other", {
			storefrontDomain: "127.0.0.1",
			clientId: "customer-client",
			clientSecret: "secret",
		});
		expect(result.settings.readiness).toBe("failed");
		f.setAuthorizationEndpoint("https://accounts.shopify.com:443/auth");
		const explicitPort = await f.service.saveAndVerify(f.org.id, "festival", {
			storefrontDomain: "store.example.com",
			clientId: "customer-client",
			clientSecret: "secret",
		});
		expect(explicitPort.settings.readiness).toBe("failed");
	});
});
