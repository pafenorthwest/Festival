import { describe, expect, it, spyOn } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import {
	CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	deriveFestivalMetadataCutoff,
} from "@festival/common";
import { Hono } from "hono";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import type {
	CustomerAccountRepository,
	CustomerSessionTokenReplacementInput,
	CustomerSessionTouchInput,
} from "../src/customer/customer-account-repository.js";
import { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { CustomerAccountTransport } from "../src/customer/customer-account-transport.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryRepertoireRepository } from "../src/repertoire/index.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildCustomerAuthRoutes } from "../src/routes/customer-auth/customer-auth.routes.js";
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

type MockFetcher = (
	input: URL | RequestInfo,
	init?: RequestInit,
) => Promise<Response>;

function transportFor(fetcher: MockFetcher, now: () => Date) {
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
class PausedTouchRepository extends InMemoryCustomerAccountRepository {
	private markStarted!: () => void;
	private markReplaced!: () => void;
	private resume!: () => void;
	readonly started = new Promise<void>((resolve) => {
		this.markStarted = resolve;
	});
	private released = new Promise<void>((resolve) => {
		this.resume = resolve;
	});
	readonly replaced = new Promise<void>((resolve) => {
		this.markReplaced = resolve;
	});
	release() {
		this.resume();
	}
	override async touchSession(input: CustomerSessionTouchInput) {
		this.markStarted();
		await this.released;
		return super.touchSession(input);
	}
	override async replaceSessionTokens(
		input: CustomerSessionTokenReplacementInput,
	) {
		const updated = await super.replaceSessionTokens(input);
		this.markReplaced();
		return updated;
	}
}

async function fixture(
	repository = new InMemoryCustomerAccountRepository(),
	commerce?: InMemoryMembershipCommerceRepository,
	checkout?: InMemoryCheckoutRepository,
) {
	const organizations = new InMemoryOrganizationRepository();
	const commerceRepo =
		commerce ?? new InMemoryMembershipCommerceRepository(organizations);
	const checkoutRepo = checkout ?? new InMemoryCheckoutRepository();
	const repertoire = new InMemoryRepertoireRepository();
	const org = await organizations.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	const other = await organizations.createOrganization({
		name: "Other",
		slug: "other",
	});
	let nonce = "";
	let tokenCalls = 0;
	let denyOrders = false;
	let orderErrorCode: string | undefined;
	let invalidOrders = false;
	let tokenClaims: Record<string, unknown> = {};
	let tokenKid = "test";
	let jwksKid = "test";
	let jwksCalls = 0;
	let discoveryCalls = 0;
	let discoveryUnavailable = false;
	let discoveryIssuer = issuer;
	let authorizationEndpoint = "https://accounts.shopify.com/auth";
	let graphqlApi = "https://accounts.shopify.com/customer/api/2026-07/graphql";
	const graphqlRequests: { method: string | undefined; url: string }[] = [];
	let now = new Date();
	const fetcher: MockFetcher = async (input, init) => {
		const url = new URL(input.toString());
		if (url.pathname === "/.well-known/openid-configuration") {
			discoveryCalls++;
			if (discoveryUnavailable) return response({}, 503);
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
			return response({ graphql_api: graphqlApi });
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
			graphqlRequests.push({ method: init?.method, url: url.toString() });
			const body = JSON.parse(String(init?.body));
			if (body.query.includes("FestivalCustomerIdentity"))
				return response({
					data: { customer: { id: "gid://shopify/Customer/42" } },
				});
			if (denyOrders)
				return response({
					data: { customer: null },
					errors: [
						{
							message: "protected data denied",
							token: "must-not-leak",
							extensions: { code: orderErrorCode },
						},
					],
				});
			if (invalidOrders) return response({ data: { customer: null } });
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
											{
												title: "Additional entry",
												quantity: 1,
												totalPrice: null,
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
	const createService = (catalog?: InMemoryRepertoireRepository) =>
		new CustomerAccountService(
			repository,
			organizations,
			keyring,
			{
				publicOrigin: "https://festival.example.com",
				transport: transportFor(fetcher, () => now),
				now: () => now,
			},
			commerceRepo,
			checkoutRepo,
			catalog,
		);
	const service = createService(repertoire);
	await service.saveAndVerify(org.id, org.slug, {
		storefrontDomain: "store.example.com",
		clientId: "customer-client",
		clientSecret: "customer-secret",
	});
	async function begin(returnTo?: string, offeringId?: string) {
		const authorization = await service.start("festival", returnTo, offeringId);
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
		createService,
		repository,
		organizations,
		commerce: commerceRepo,
		checkout: checkoutRepo,
		repertoire,
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
		setOrderErrorCode: (value: string) => {
			orderErrorCode = value;
		},
		setInvalidOrders: (value: boolean) => {
			invalidOrders = value;
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
		setDiscoveryUnavailable: (value: boolean) => {
			discoveryUnavailable = value;
		},
		setAuthorizationEndpoint: (value: string) => {
			authorizationEndpoint = value;
		},
		setGraphqlApi: (value: string) => {
			graphqlApi = value;
		},
		tokenCalls: () => tokenCalls,
		discoveryCalls: () => discoveryCalls,
		jwksCalls: () => jwksCalls,
		graphqlRequests: () => [...graphqlRequests],
	};
}

function customerOAuthApp(service: CustomerAccountService) {
	return new Hono().route(
		"/api",
		buildCustomerAuthRoutes({ customerAccountService: service }),
	);
}

async function startBrowserOAuth(app: ReturnType<typeof customerOAuthApp>) {
	const response = await app.request(
		"/api/organizations/festival/customer-auth/start",
	);
	expect(response.status).toBe(302);
	const authorization = new URL(response.headers.get("location") ?? "");
	const state = authorization.searchParams.get("state") ?? "";
	const nonce = authorization.searchParams.get("nonce") ?? "";
	const rawCookie = response.headers.getSetCookie()[0] ?? "";
	expect(state).not.toBe("");
	expect(nonce).not.toBe("");
	return { state, nonce, rawCookie, cookie: rawCookie.split(";")[0] };
}

describe("customer OAuth browser binding", () => {
	it("rejects another browser before consuming state, then authenticates the initiating browser once", async () => {
		const f = await fixture();
		const app = customerOAuthApp(f.service);
		const flow = await startBrowserOAuth(app);
		const anotherBrowser = await startBrowserOAuth(app);
		const callback = `/api/customer-auth/callback?state=${flow.state}&code=code`;
		for (const cookie of [
			"",
			anotherBrowser.cookie,
			flow.cookie.replace(/=.*/, "=wrong"),
		]) {
			const rejected = await app.request(callback, {
				headers: { Cookie: cookie },
			});
			expect(rejected.status).toBe(400);
			expect(rejected.headers.get("set-cookie")).toBeNull();
		}
		expect(f.tokenCalls()).toBe(0);
		f.setTokenClaims({ nonce: flow.nonce });
		const accepted = await app.request(callback, {
			headers: { Cookie: flow.cookie },
		});
		expect(accepted.status).toBe(302);
		const cookies = accepted.headers.getSetCookie();
		const sessionCookie = cookies.find((cookie) =>
			cookie.startsWith("festival_customer_session="),
		);
		const sessionId = sessionCookie?.split(";")[0].split("=")[1];
		expect(
			(await f.service.session("festival", sessionId)).session.authenticated,
		).toBe(true);
		expect(
			cookies.some(
				(cookie) =>
					cookie.startsWith(flow.cookie.split("=")[0]) &&
					cookie.includes("Max-Age=0"),
			),
		).toBe(true);
		const replay = await app.request(callback, {
			headers: { Cookie: flow.cookie },
		});
		expect(replay.status).toBe(400);
		expect(replay.headers.get("set-cookie")).not.toContain(
			"festival_customer_session=",
		);
		expect(f.tokenCalls()).toBe(1);
	});

	it("binds OAuth denial to the initiating browser and consumes its state", async () => {
		const f = await fixture();
		const app = customerOAuthApp(f.service);
		const flow = await startBrowserOAuth(app);
		const anotherBrowser = await startBrowserOAuth(app);
		const callback = `/api/customer-auth/callback?state=${flow.state}&error=access_denied`;
		for (const cookie of ["", anotherBrowser.cookie]) {
			const rejected = await app.request(callback, {
				headers: { Cookie: cookie },
			});
			expect(rejected.status).toBe(400);
			expect(rejected.headers.get("set-cookie")).toBeNull();
		}
		const denied = await app.request(callback, {
			headers: { Cookie: flow.cookie },
		});
		expect(denied.status).toBe(302);
		expect(denied.headers.get("location")).toBe(
			"/org/festival/account?authError=authentication",
		);
		expect(denied.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(denied.headers.get("set-cookie")).not.toContain(
			"festival_customer_session=",
		);
		const replay = await app.request(callback, {
			headers: { Cookie: flow.cookie },
		});
		expect(replay.status).toBe(400);
		expect(f.tokenCalls()).toBe(0);
	});

	it("preserves concurrent sign-ins completed in reverse order and clears only the completed flow", async () => {
		const f = await fixture();
		const app = customerOAuthApp(f.service);
		const first = await startBrowserOAuth(app);
		const second = await startBrowserOAuth(app);
		expect(first.cookie.split("=")[0]).not.toBe(second.cookie.split("=")[0]);
		const jar = `${first.cookie}; ${second.cookie}`;
		for (const flow of [second, first]) {
			f.setTokenClaims({ nonce: flow.nonce });
			const response = await app.request(
				`/api/customer-auth/callback?state=${flow.state}&code=code`,
				{
					headers: { Cookie: jar },
				},
			);
			expect(response.status).toBe(302);
			const cleared = response.headers
				.getSetCookie()
				.filter((cookie) => cookie.startsWith("__Host-"));
			expect(cleared).toHaveLength(1);
			expect(cleared[0]).toStartWith(`${flow.cookie.split("=")[0]}=`);
			expect(cleared[0]).toContain("Max-Age=0");
		}
		expect(f.tokenCalls()).toBe(2);
	});

	it("sets a short-lived host-only secure cookie and rejects expired state even if the cookie is retained", async () => {
		const f = await fixture();
		const app = customerOAuthApp(f.service);
		const flow = await startBrowserOAuth(app);
		expect(flow.rawCookie).toStartWith("__Host-festival_customer_oauth_");
		for (const flag of [
			"HttpOnly",
			"Secure",
			"SameSite=Lax",
			"Path=/",
			"Max-Age=600",
		]) {
			expect(flow.rawCookie).toContain(flag);
		}
		expect(flow.rawCookie).not.toContain("Domain=");
		f.setNow(new Date(Date.now() + 11 * 60_000));
		const response = await app.request(
			`/api/customer-auth/callback?state=${flow.state}&code=code`,
			{
				headers: { Cookie: flow.cookie },
			},
		);
		expect(response.status).toBe(400);
		expect(response.headers.get("set-cookie")).not.toContain(
			"festival_customer_session=",
		);
		expect(f.tokenCalls()).toBe(0);
	});
});

describe("CustomerAccountService", () => {
	it("creates and refreshes age snapshots without retaining birthdays", async () => {
		const f = await fixture();
		await f.organizations.updateRegistrationAgeConfiguration({
			organizationId: f.org.id,
			registrationAgeDate: "2026-06-01",
		});
		const auth = await f.authenticate();
		const session = await f.repository.getSession(auth.sessionId);
		if (!session) throw new Error("session");
		const created = await f.service.createChild(
			"festival",
			auth.sessionId,
			session.csrfToken,
			"https://festival.example.com",
			{ displayName: "Alex", birthday: "2016-06-01" },
		);
		expect(created.ageSnapshot.age).toBe(10);
		expect(JSON.stringify(created)).not.toContain("2016-06-01");
		const refreshed = await f.service.refreshChildAgeSnapshot(
			"festival",
			auth.sessionId,
			session.csrfToken,
			"https://festival.example.com",
			created.child.id,
			{ birthday: "2015-06-02" },
		);
		expect(refreshed.ageSnapshot.age).toBe(10);
		const snapshots = await f.repository.listChildAgeSnapshots(
			f.org.id,
			created.child.id,
		);
		expect(snapshots).toHaveLength(2);
		expect(snapshots[0]?.supersededAtIso).toBeDefined();
	});
	it("calculates registration ages at before, on, and after birthday boundaries", async () => {
		const f = await fixture();
		f.setNow(new Date("2026-01-01T00:00:00.000Z"));
		await f.organizations.updateRegistrationAgeConfiguration({
			organizationId: f.org.id,
			registrationAgeDate: "2026-06-01",
		});
		const auth = await f.authenticate();
		const session = await f.repository.getSession(auth.sessionId);
		if (!session) throw new Error("session");
		const create = (displayName: string, birthday: string) =>
			f.service.createChild(
				"festival",
				auth.sessionId,
				session.csrfToken,
				"https://festival.example.com",
				{ displayName, birthday },
			);
		expect((await create("Before", "2016-05-31")).ageSnapshot.age).toBe(10);
		expect((await create("On", "2016-06-01")).ageSnapshot.age).toBe(10);
		expect((await create("After", "2016-06-02")).ageSnapshot.age).toBe(9);
		const created = await create("Validity", "2016-01-01");
		expect(created.ageSnapshot.validUntilIso).toBe("2026-04-01T00:00:00.000Z");
	});
	it("rejects calendar-invalid birthdays without normalizing them", async () => {
		const f = await fixture();
		await f.organizations.updateRegistrationAgeConfiguration({
			organizationId: f.org.id,
			registrationAgeDate: "2026-06-01",
		});
		const auth = await f.authenticate();
		const session = await f.repository.getSession(auth.sessionId);
		if (!session) throw new Error("session");
		await expect(
			f.service.createChild(
				"festival",
				auth.sessionId,
				session.csrfToken,
				"https://festival.example.com",
				{ displayName: "Invalid", birthday: "2016-02-31" },
			),
		).rejects.toMatchObject({ status: 400 });
		const created = await f.service.createChild(
			"festival",
			auth.sessionId,
			session.csrfToken,
			"https://festival.example.com",
			{ displayName: "Leap", birthday: "2016-02-29" },
		);
		expect(created.ageSnapshot.age).toBe(10);
		await expect(
			f.service.refreshChildAgeSnapshot(
				"festival",
				auth.sessionId,
				session.csrfToken,
				"https://festival.example.com",
				created.child.id,
				{ birthday: "2015-02-29" },
			),
		).rejects.toMatchObject({ status: 400 });
	});
	it("rejects child writes without the customer CSRF boundary", async () => {
		const f = await fixture();
		await f.organizations.updateRegistrationAgeConfiguration({
			organizationId: f.org.id,
			registrationAgeDate: "2026-06-01",
		});
		const auth = await f.authenticate();
		await expect(
			f.service.createChild(
				"festival",
				auth.sessionId,
				"wrong",
				"https://festival.example.com",
				{ displayName: "Alex", birthday: "2016-06-01" },
			),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			f.service.createChild(
				"festival",
				auth.sessionId,
				"",
				"https://festival.example.com",
				{ displayName: "Alex", birthday: "2016-06-01" },
			),
		).rejects.toMatchObject({ status: 403 });
	});
	it("does not allow a parent to refresh another parent's child", async () => {
		const f = await fixture();
		await f.organizations.updateRegistrationAgeConfiguration({
			organizationId: f.org.id,
			registrationAgeDate: "2026-06-01",
		});
		const auth = await f.authenticate();
		const session = await f.repository.getSession(auth.sessionId);
		if (!session) throw new Error("session");
		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: "other-parent",
			displayName: "Other",
		});
		await expect(
			f.service.refreshChildAgeSnapshot(
				"festival",
				auth.sessionId,
				session.csrfToken,
				"https://festival.example.com",
				child.id,
				{ birthday: "2016-06-01" },
			),
		).rejects.toMatchObject({ status: 404 });
	});
	it("does not allow a customer session to read children across tenants", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		await expect(
			f.service.listChildren("other", auth.sessionId),
		).rejects.toMatchObject({ status: 401 });
	});
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
	it("uses Festival's pinned API version for a matching Customer Account discovery endpoint", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		await f.service.orders("festival", auth.sessionId);
		expect(f.graphqlRequests()).toEqual([
			{
				method: "POST",
				url: "https://accounts.shopify.com/customer/api/2026-07/graphql",
			},
			{
				method: "POST",
				url: "https://accounts.shopify.com/customer/api/2026-07/graphql",
			},
		]);
	});
	it("normalizes a newer discovered Customer Account GraphQL API version to Festival's pin", async () => {
		const f = await fixture();
		f.setGraphqlApi(
			"https://shopify.com/123456789/account/customer/api/2026-10/graphql",
		);
		const result = await f.service.saveAndVerify(f.org.id, "festival", {
			storefrontDomain: "store.example.com",
			clientId: "customer-client",
			clientSecret: "customer-secret",
		});
		expect(result.settings.readiness).toBe("ready");
		const auth = await f.authenticate();
		await f.service.orders("festival", auth.sessionId);
		expect(f.graphqlRequests()).toEqual([
			{
				method: "POST",
				url: "https://shopify.com/123456789/account/customer/api/2026-07/graphql",
			},
			{
				method: "POST",
				url: "https://shopify.com/123456789/account/customer/api/2026-07/graphql",
			},
		]);
	});
	it("rejects malformed or pre-pin Customer Account discovery GraphQL endpoints", async () => {
		const f = await fixture();
		for (const graphqlApi of [
			"https://accounts.shopify.com/customer/api/2026-10/graphql/extra",
			"https://accounts.shopify.com/customer/api/2026-11/graphql",
			"https://accounts.shopify.com/customer/api/2026-10/graphql?unexpected=true",
			"https://accounts.shopify.com/customer/api/2026-04/graphql",
			"https://shopify.com/123456789//account/customer/api/2026-10/graphql",
			"https://shopify.com/123456789/account/../account/customer/api/2026-10/graphql",
			"https://shopify.com/123456789/account/%2e%2e/account/customer/api/2026-10/graphql",
		]) {
			f.setGraphqlApi(graphqlApi);
			const result = await f.service.saveAndVerify(f.org.id, "festival", {
				storefrontDomain: "store.example.com",
				clientId: "customer-client",
				clientSecret: "customer-secret",
			});
			expect(result.settings.readiness).toBe("failed");
		}
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
				{ title: "Additional entry", quantity: 1, total: null },
			],
		});
		expect(JSON.stringify(orders)).not.toContain("gid://shopify/Customer");
	});
	it("records only a verified Shopify identity email when the customer signs in", async () => {
		const f = await fixture();
		f.setTokenClaims({
			email: " Eric@Example.com ",
			email_verified: true,
		});
		const authenticated = await f.authenticate();
		const session = await f.repository.getSession(authenticated.sessionId);
		if (!session) throw new Error("session");
		expect(
			await f.repository.getCustomer(f.org.id, session.customerId),
		).toMatchObject({
			email: { value: "eric@example.com", source: "shopify" },
		});
		const customerSession = await f.service.session(
			"festival",
			authenticated.sessionId,
		);
		if (!customerSession.session.authenticated) throw new Error("session");
		expect(
			await f.service.formAccess(
				"festival",
				authenticated.sessionId,
				customerSession.session.csrfToken,
				"https://festival.example.com",
			),
		).toMatchObject({ verifiedShopifyCustomerEmail: "eric@example.com" });
		await f.repository.applyCustomerProfile({
			organizationId: f.org.id,
			customerId: session.customerId,
			source: "festival",
			updatedAtIso: "2026-08-01T00:00:00.000Z",
			profile: { email: "local@example.com" },
		});
		f.setTokenClaims({
			email: "updated@example.com",
			email_verified: true,
		});
		await f.authenticate();
		expect(
			await f.repository.getCustomer(f.org.id, session.customerId),
		).toMatchObject({
			email: { value: "updated@example.com", source: "shopify" },
		});

		const unverified = await fixture();
		unverified.setTokenClaims({
			email: "eric@example.com",
			email_verified: false,
		});
		const unauthenticated = await unverified.authenticate();
		const unverifiedSession = await unverified.repository.getSession(
			unauthenticated.sessionId,
		);
		if (!unverifiedSession) throw new Error("session");
		expect(
			await unverified.repository.getCustomer(
				unverified.org.id,
				unverifiedSession.customerId,
			),
		).toMatchObject({ email: { value: null, source: null } });

		const missing = await fixture();
		missing.setTokenClaims({ email_verified: true });
		const missingEmail = await missing.authenticate();
		const missingSession = await missing.repository.getSession(
			missingEmail.sessionId,
		);
		if (!missingSession) throw new Error("session");
		expect(
			await missing.repository.getCustomer(
				missing.org.id,
				missingSession.customerId,
			),
		).toMatchObject({ email: { value: null, source: null } });
	});
	it("resolves one durable customer before every session and exposes only the local profile", async () => {
		const f = await fixture();
		const first = await f.authenticate();
		const second = await f.authenticate();
		const firstSession = await f.repository.getSession(first.sessionId);
		const secondSession = await f.repository.getSession(second.sessionId);
		expect(firstSession?.customerId).toBe(secondSession?.customerId);
		if (!firstSession) throw new Error("session");

		const customer = await f.repository.getCustomer(
			f.org.id,
			firstSession.customerId,
		);
		expect(customer?.shopifyCustomerGid).toBe("gid://shopify/Customer/42");
		const initial = await f.service.customerProfile(
			"festival",
			first.sessionId,
		);
		expect(initial).toEqual({
			profile: {
				name: null,
				email: null,
				mailingAddress: null,
				phone: null,
				updatedAtIso: customer?.updatedAtIso ?? null,
			},
		});
		expect(initial).not.toHaveProperty("customerId");
		expect(JSON.stringify(initial)).not.toContain("gid://shopify/Customer");
	});
	it("returns null for missing or outdated Admin consent while preserving the existing 404 contract", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		const session = await f.repository.getSession(auth.sessionId);
		if (!session) throw new Error("session");
		for (const outdatedConsent of [false, true]) {
			if (outdatedConsent) {
				await f.repository.recordStaffAccessConsent({
					organizationId: f.org.id,
					customerId: session.customerId,
					privacyNoticeVersion: "obsolete-privacy-notice",
					consentedAtIso: new Date().toISOString(),
				});
			}
			expect(
				await f.service.findAdminCustomerProfile(
					f.org.id,
					session.customerId,
					"admin-uid",
				),
			).toBeNull();
			await expect(
				f.service.adminCustomerProfile(
					f.org.id,
					session.customerId,
					"admin-uid",
				),
			).rejects.toMatchObject({ status: 404 });
		}
		expect(f.repository.profileAccessAudits).toEqual([]);
	});
	it("keeps consent tenant-bound and audits a successful nullable Admin profile read", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		const session = await f.repository.getSession(auth.sessionId);
		if (!session) throw new Error("session");
		await f.repository.recordStaffAccessConsent({
			organizationId: f.org.id,
			customerId: session.customerId,
			privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
			consentedAtIso: new Date().toISOString(),
		});
		expect(
			await f.service.findAdminCustomerProfile(
				f.other.id,
				session.customerId,
				"other-admin",
			),
		).toBeNull();
		expect(f.repository.profileAccessAudits).toEqual([]);
		const visible = await f.service.findAdminCustomerProfile(
			f.org.id,
			session.customerId,
			"verified-admin-uid",
		);
		expect(visible?.customerId).toBe(session.customerId);
		expect(f.repository.profileAccessAudits).toEqual([
			{
				organizationId: f.org.id,
				actorUid: "verified-admin-uid",
				action: "view",
				targetCustomerId: session.customerId,
				occurredAtIso: expect.any(String),
			},
		]);
	});
	it("does not return an Admin profile when consent lookup or access auditing fails", async () => {
		for (const failure of ["read", "audit"] as const) {
			const f = await fixture();
			const auth = await f.authenticate();
			const session = await f.repository.getSession(auth.sessionId);
			if (!session) throw new Error("session");
			await f.repository.recordStaffAccessConsent({
				organizationId: f.org.id,
				customerId: session.customerId,
				privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
				consentedAtIso: new Date().toISOString(),
			});
			const fail = async () => {
				throw new Error("unavailable consent boundary");
			};
			if (failure === "read") f.repository.getConsentedCustomer = fail;
			else f.repository.recordCustomerProfileAccessAudit = fail;
			await expect(
				f.service.findAdminCustomerProfile(
					f.org.id,
					session.customerId,
					"admin-uid",
				),
			).rejects.toThrow("unavailable consent boundary");
			await expect(
				f.service.adminCustomerProfile(
					f.org.id,
					session.customerId,
					"admin-uid",
				),
			).rejects.toThrow("unavailable consent boundary");
		}
	});
	it("protects Festival profile edits and gates audited Admin access on consent", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		const storedSession = await f.repository.getSession(auth.sessionId);
		if (!storedSession) throw new Error("session");
		await f.repository.applyCustomerProfile({
			organizationId: f.org.id,
			customerId: storedSession.customerId,
			source: "shopify",
			updatedAtIso: "2026-08-01T00:00:00.000Z",
			profile: { name: "Shopify Name", email: "shopify@example.com" },
		});
		const session = await f.service.session("festival", auth.sessionId);
		if (!session.session.authenticated) throw new Error("session");
		await expect(
			f.service.updateCustomerProfile(
				"festival",
				auth.sessionId,
				"wrong",
				"https://festival.example.com",
				{},
			),
		).rejects.toThrow("CSRF");
		const updated = await f.service.updateCustomerProfile(
			"festival",
			auth.sessionId,
			session.session.csrfToken,
			"https://festival.example.com",
			{
				name: " Local Name ",
				email: "LOCAL@EXAMPLE.COM",
				phone: "+1 555 0100",
				mailingAddress: {
					line1: "1 Main St",
					city: "Seattle",
					region: "WA",
					postalCode: "98101",
					countryCode: "us",
				},
			},
		);
		expect(updated.profile.name).toBe("Local Name");
		expect(updated.profile.email).toBe("local@example.com");
		expect(updated.profile.mailingAddress?.countryCode).toBe("US");
		await f.repository.applyCustomerProfile({
			organizationId: f.org.id,
			customerId: storedSession.customerId,
			source: "shopify",
			updatedAtIso: "2026-09-01T00:00:00.000Z",
			profile: { name: "Later Shopify Name", email: "later@example.com" },
		});
		expect(
			(await f.service.customerProfile("festival", auth.sessionId)).profile
				.name,
		).toBe("Local Name");

		await expect(
			f.service.adminCustomerProfile(
				f.org.id,
				storedSession.customerId,
				"admin-uid",
			),
		).rejects.toThrow("not found");
		expect(
			(await f.service.searchAdminCustomers(f.org.id, "Local", "admin-uid"))
				.customers,
		).toEqual([]);
		await f.service.recordStaffAccessConsent(
			"festival",
			auth.sessionId,
			session.session.csrfToken,
			"https://festival.example.com",
		);
		const visible = await f.service.adminCustomerProfile(
			f.org.id,
			storedSession.customerId,
			"admin-uid",
		);
		expect(visible.customerId).toBe(storedSession.customerId);
		const search = await f.service.searchAdminCustomers(
			f.org.id,
			"555",
			"admin-uid",
		);
		expect(search.customers).toHaveLength(1);
		expect(search.customers[0]).not.toHaveProperty("mailingAddress");
		expect(search.customers[0]).not.toHaveProperty("profile");
		expect(f.repository.profileAccessAudits).toEqual([
			{
				organizationId: f.org.id,
				actorUid: "admin-uid",
				action: "search",
				resultCount: 0,
				occurredAtIso: expect.any(String),
			},
			{
				organizationId: f.org.id,
				actorUid: "admin-uid",
				action: "view",
				targetCustomerId: storedSession.customerId,
				occurredAtIso: expect.any(String),
			},
			{
				organizationId: f.org.id,
				actorUid: "admin-uid",
				action: "search",
				resultCount: 1,
				occurredAtIso: expect.any(String),
			},
		]);
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
	it("preserves the exact account processing return through OAuth and rejects variations", async () => {
		const f = await fixture();
		const authorization = await f.begin(
			"/org/festival/account?checkout=processing",
		);
		const result = await f.service.callback(
			authorization.searchParams.get("state") ?? "",
			"code",
		);
		expect(result.returnTo).toBe("/org/festival/account?checkout=processing");
		for (const target of [
			"/org/other/account?checkout=processing",
			"/org/festival/account?checkout=approved",
			"/org/festival/account?checkout=processing&returnTo=https://evil.example",
			"https://festival.example.com/org/festival/account?checkout=processing",
		])
			await expect(f.service.start("festival", target)).rejects.toThrow(
				"Return target",
			);
	});

	it("preserves the exact accompanist membership return through OAuth", async () => {
		const f = await fixture();
		const authorization = await f.begin("/org/festival/accompanist-membership");
		const result = await f.service.callback(
			authorization.searchParams.get("state") ?? "",
			"code",
		);
		expect(result.returnTo).toBe("/org/festival/accompanist-membership");
		await expect(
			f.service.start(
				"festival",
				"/org/festival/accompanist-membership?foo=bar",
			),
		).rejects.toThrow("Return target");
	});

	it("preserves the exact checkout recovery return through OAuth and rejects invalid tokens", async () => {
		const f = await fixture();
		const recoveryReturn = "/org/festival/checkout-recovery/valid-token_123";
		const authorization = await f.begin(recoveryReturn);
		const result = await f.service.callback(
			authorization.searchParams.get("state") ?? "",
			"code",
		);
		expect(result.returnTo).toBe(recoveryReturn);
		await expect(
			f.service.start("festival", "/org/festival/checkout-recovery/bad token"),
		).rejects.toThrow("Return target");
		await expect(
			f.service.start(
				"festival",
				"/org/festival/checkout-recovery/token?extra=1",
			),
		).rejects.toThrow("Return target");
	});

	it("preserves exact festival registration and cart returns through OAuth and rejects invalid targets", async () => {
		const f = await fixture();
		const regReturn = "/org/festival/festival/festival-2026/register";
		const regAuth = await f.begin(regReturn);
		const regResult = await f.service.callback(
			regAuth.searchParams.get("state") ?? "",
			"code",
		);
		expect(regResult.returnTo).toBe(regReturn);

		for (const cartReturn of [
			"/org/festival/festival/festival_slug-123/register/cart",
			"/org/festival/festival/festival_slug-123/cart",
		]) {
			const cartAuth = await f.begin(cartReturn);
			const cartResult = await f.service.callback(
				cartAuth.searchParams.get("state") ?? "",
				"code",
			);
			expect(cartResult.returnTo).toBe(cartReturn);
		}

		await expect(
			f.service.start(
				"festival",
				"/org/festival/festival/festival-2026/invalid",
			),
		).rejects.toThrow("Return target");
		await expect(
			f.service.start("festival", "/org/festival/festival/bad slug!/register"),
		).rejects.toThrow("Return target");
		await expect(
			f.service.start("festival", "/org/other/festival/festival-2026/register"),
		).rejects.toThrow("Return target");
		await expect(
			f.service.start(
				"festival",
				"/org/other/festival/festival-2026/register/cart",
			),
		).rejects.toThrow("Return target");
		await expect(
			f.service.start(
				"festival",
				"/org/festival/festival/festival-2026/register?tab=details",
			),
		).rejects.toThrow("Return target");
	});

	it("preserves one bounded local offering in one-time tenant OAuth state", async () => {
		const f = await fixture();
		const authUrl = await f.begin(undefined, "offering_123");
		const result = await f.service.callback(
			authUrl.searchParams.get("state") ?? "",
			"code-1",
			async () => {},
		);
		expect(result).toMatchObject({
			organizationSlug: "festival",
			offeringId: "offering_123",
			returnTo: "/org/festival/membership?purchase=offering_123",
		});
		await expect(
			f.service.callback(authUrl.searchParams.get("state") ?? "", "code-1"),
		).rejects.toThrow("invalid");
		await expect(
			f.service.start("festival", undefined, "gid://shopify/Product/1"),
		).rejects.toThrow("selection is invalid");
		await expect(
			f.service.start(
				"festival",
				"/org/other/membership?purchase=offering_123",
				"offering_123",
			),
		).rejects.toThrow("Return target is invalid");
	});
	it("consumes purchase OAuth state and returns a safe local authentication-failure target", async () => {
		const f = await fixture();
		const authUrl = await f.begin(undefined, "offering_123");
		const state = authUrl.searchParams.get("state") ?? "";
		expect(await f.service.authenticationFailure(state)).toBe(
			"/org/festival/membership?purchaseError=authentication",
		);
		await expect(f.service.authenticationFailure(state)).rejects.toThrow(
			"invalid",
		);
	});
	it("revalidates a resumed offering before token exchange or session creation", async () => {
		const f = await fixture();
		const authUrl = await f.begin(undefined, "offering_123");
		await expect(
			f.service.callback(
				authUrl.searchParams.get("state") ?? "",
				"code-1",
				async () => {
					throw new Error("offering changed");
				},
			),
		).rejects.toThrow("offering changed");
		expect(f.tokenCalls()).toBe(0);
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
	it("preserves a customer session during a discovery outage and refreshes its tokens on retry", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		const original = await f.repository.getSession(auth.sessionId);
		if (!original) throw new Error("session");
		f.setNow(new Date(Date.now() + 6 * 60_000));
		f.setDiscoveryUnavailable(true);

		await expect(
			f.service.orders("festival", auth.sessionId),
		).rejects.toMatchObject({
			status: 503,
		});
		expect(f.tokenCalls()).toBe(1);
		const duringOutage = await f.repository.getSession(auth.sessionId);
		expect(duringOutage?.revokedAtIso).toBeUndefined();
		expect(duringOutage?.encryptedTokens).toBe(original.encryptedTokens);
		expect(await f.service.session("festival", auth.sessionId)).toMatchObject({
			session: { authenticated: true, csrfToken: original.csrfToken },
		});

		f.setDiscoveryUnavailable(false);
		const orders = await f.service.orders("festival", auth.sessionId);
		expect(orders.orders[0]?.orderNumber).toBe("1001");
		expect(f.tokenCalls()).toBe(2);
		const refreshed = await f.repository.getSession(auth.sessionId);
		if (!refreshed) throw new Error("session");
		expect(refreshed.revokedAtIso).toBeUndefined();
		expect(refreshed.csrfToken).toBe(original.csrfToken);
		const tokens = JSON.parse(
			f.keyring.decrypt(refreshed.encryptedTokens, {
				organizationId: f.org.id,
				purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
			}),
		);
		expect(tokens).toMatchObject({
			accessToken: "access-2",
			refreshToken: "refresh-2",
		});
	});
	it("cannot resurrect a session revoked while its activity touch is pending", async () => {
		const repository = new PausedTouchRepository();
		const f = await fixture(repository);
		const auth = await f.authenticate();
		const pending = f.service.session("festival", auth.sessionId);
		await repository.started;
		await repository.revokeSession(auth.sessionId, new Date().toISOString());
		repository.release();
		expect((await pending).session.authenticated).toBe(false);
		expect(
			(await repository.getSession(auth.sessionId))?.revokedAtIso,
		).toBeDefined();
	});
	it("does not let a pending activity touch overwrite rotated tokens", async () => {
		const repository = new PausedTouchRepository();
		const f = await fixture(repository);
		const auth = await f.authenticate();
		const pendingSession = f.service.session("festival", auth.sessionId);
		await repository.started;
		f.setNow(new Date(Date.now() + 61_000));
		const pendingOrders = f.service.orders("festival", auth.sessionId);
		await repository.replaced;
		repository.release();
		expect((await pendingSession).session.authenticated).toBe(true);
		await pendingOrders;
		const stored = await repository.getSession(auth.sessionId);
		if (!stored) throw new Error("session");
		const tokens = JSON.parse(
			f.keyring.decrypt(stored.encryptedTokens, {
				organizationId: f.org.id,
				purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
			}),
		);
		expect(tokens.accessToken).toBe("access-2");
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
	for (const [providerCode, status, code] of [
		["ACCESS_DENIED", 403, "customer_account_access_denied"],
		["THROTTLED", 503, "customer_account_throttled"],
	] as const) {
		it(`reports the ${providerCode} order failure without changing authentication or retrying`, async () => {
			const f = await fixture();
			const auth = await f.authenticate();
			f.setDeny(true);
			f.setOrderErrorCode(providerCode);
			const warning = spyOn(console, "warn").mockImplementation(() => {});
			try {
				await expect(
					f.service.orders("festival", auth.sessionId),
				).rejects.toMatchObject({ status, code });
				expect(JSON.parse(String(warning.mock.calls[0]?.[0]))).toMatchObject({
					operation: "customer_orders",
					codes: [providerCode],
				});
				expect(await f.repository.getIntegration(f.org.id)).toMatchObject({
					readiness: "ready",
					canReadOrders: false,
				});
				expect(
					(await f.repository.getSession(auth.sessionId))?.revokedAtIso,
				).toBeUndefined();
				expect(f.graphqlRequests()).toHaveLength(2);
			} finally {
				warning.mockRestore();
			}
		});
	}

	it("keeps sign-in and existing sessions available after customer order denial", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		await f.service.orders("festival", auth.sessionId);
		const before = await f.repository.getIntegration(f.org.id);
		f.setDeny(true);
		await expect(
			f.service.orders("festival", auth.sessionId),
		).rejects.toMatchObject({ status: 403 });
		const after = await f.repository.getIntegration(f.org.id);
		expect(after).toMatchObject({
			readiness: "ready",
			canReadOrders: false,
			integrationVersion: before?.integrationVersion,
			encryptedClientSecret: before?.encryptedClientSecret,
			verifiedAtIso: before?.verifiedAtIso,
		});
		const fresh = await f.authenticate();
		expect(
			(await f.service.session("festival", fresh.sessionId)).session
				.authenticated,
		).toBe(true);
		expect(
			(await f.service.session("festival", auth.sessionId)).session
				.authenticated,
		).toBe(true);
		f.setDeny(false);
		await f.service.orders("festival", fresh.sessionId);
		expect((await f.repository.getIntegration(f.org.id))?.canReadOrders).toBe(
			true,
		);
	});

	for (const readiness of ["failed", "unknown"] as const) {
		it(`recovers configured ${readiness} sign-in only after fresh validated discovery`, async () => {
			const f = await fixture();
			const original = await f.repository.getIntegration(f.org.id);
			if (!original) throw new Error("integration");
			if (readiness === "failed")
				await f.repository.setIntegrationReadiness(f.org.id, {
					readiness,
					canReadOrders: false,
					lastError: "Customer order access is unavailable.",
				});
			else await f.repository.upsertIntegration(original);
			const before = await f.repository.getIntegration(f.org.id);
			const discoveries = f.discoveryCalls();
			const auth = await f.begin("/org/festival");
			expect(auth.hostname).toBe("accounts.shopify.com");
			expect(f.discoveryCalls()).toBe(discoveries + 2);
			expect(await f.repository.getIntegration(f.org.id)).toMatchObject({
				readiness: "ready",
				canReadOrders: false,
				integrationVersion: before?.integrationVersion,
				encryptedClientSecret: before?.encryptedClientSecret,
				lastError: undefined,
			});
		});
	}

	for (const failure of ["outage", "issuer", "endpoint"] as const) {
		it(`does not create OAuth state when recovery discovery fails: ${failure}`, async () => {
			const f = await fixture();
			await f.repository.setIntegrationReadiness(f.org.id, {
				readiness: "failed",
				canReadOrders: false,
			});
			if (failure === "outage") f.setDiscoveryUnavailable(true);
			if (failure === "issuer")
				f.setDiscoveryIssuer("https://untrusted.example/authentication/shop");
			if (failure === "endpoint")
				f.setAuthorizationEndpoint("http://accounts.shopify.com/auth");
			const states = spyOn(f.repository, "putOAuthState");
			await expect(f.begin()).rejects.toMatchObject({ status: 503 });
			expect(states).not.toHaveBeenCalled();
			expect((await f.repository.getIntegration(f.org.id))?.readiness).toBe(
				"failed",
			);
		});
	}

	it("cannot repair or create OAuth state for an integration rotated during discovery recovery", async () => {
		const f = await fixture();
		await f.repository.setIntegrationReadiness(f.org.id, {
			readiness: "failed",
			canReadOrders: false,
		});
		const record = f.repository.recordIntegrationHealth.bind(f.repository);
		spyOn(f.repository, "recordIntegrationHealth").mockImplementation(
			async (...args) => {
				if (args[2].kind === "discovery_verified") {
					const old = await f.repository.getIntegration(f.org.id);
					if (!old) throw new Error("integration");
					await f.repository.upsertIntegration({
						...old,
						clientId: "rotated-client",
					});
				}
				return record(...args);
			},
		);
		const states = spyOn(f.repository, "putOAuthState");
		await expect(f.begin()).rejects.toMatchObject({ status: 503 });
		expect(states).not.toHaveBeenCalled();
		expect(await f.repository.getIntegration(f.org.id)).toMatchObject({
			readiness: "unknown",
			clientId: "rotated-client",
			integrationVersion: 2,
		});
	});

	it("marks order capability unavailable for an invalid success payload without disabling sign-in", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		await f.service.orders("festival", auth.sessionId);
		f.setInvalidOrders(true);
		await expect(
			f.service.orders("festival", auth.sessionId),
		).rejects.toMatchObject({ status: 503 });
		expect(await f.repository.getIntegration(f.org.id)).toMatchObject({
			readiness: "ready",
			canReadOrders: false,
		});
		expect((await f.begin()).hostname).toBe("accounts.shopify.com");
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
		await expect(
			f.service.logout(
				"festival",
				auth.sessionId,
				session.session.csrfToken,
				"https://evil.example.com",
			),
		).rejects.toThrow("CSRF");
		await expect(
			f.service.logout(
				"festival",
				auth.sessionId,
				session.session.csrfToken,
				undefined,
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

	it("enforces cutoff boundary, customer ownership, pieces validation, and accompanist update on updateRegistrationMetadata", async () => {
		const f = await fixture();
		await f.organizations.updateOrganizationTimezone(
			f.org.id,
			"America/Los_Angeles",
		);

		const festival = await f.organizations.createFestival({
			id: "fest-1",
			organizationId: f.org.id,
			code: "SPF26",
			name: "Spring Festival 2026",
			shortName: "spring-2026",
			startDate: "2026-05-15",
			endDate: "2026-05-20",
		});

		const classConfig = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: festival.id,
			displayName: "Solo Piano",
			classSubtypeId: "piano",
			divisionId: "div_1",
			minimumAge: 5,
			maximumAge: 18,
			price: "30.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 20,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
		});

		const auth = await f.authenticate();
		const { session } = await f.service.session("festival", auth.sessionId);
		const storedSession = await f.repository.getSession(auth.sessionId);
		if (!storedSession) throw new Error("session");
		const customerId = storedSession.customerId;
		if (!session.authenticated) throw new Error("Expected authenticated");
		const csrfToken = session.csrfToken;
		const origin = "https://festival.example.com";

		const entitlement = await f.commerce.createClassEntitlement({
			organizationId: f.org.id,
			festivalId: festival.id,
			festivalClassId: classConfig.id,
			parentCustomerId: customerId,
			childId: "child-1",
			checkoutIntentId: "intent-1",
			shopifyOrderGid: "gid://shopify/Order/1",
			shopifyOrderLineGid: "gid://shopify/LineItem/1",
			paidAmountCents: 3000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		await f.checkout.insertRegistrationMetadata({
			id: "reg-meta-1",
			organizationId: f.org.id,
			festivalId: festival.id,
			checkoutIntentId: "intent-1",
			teacherMembershipId: "teacher-1",
			accompanistMembershipId: null,
			repertoireJson: [
				{
					title: "Sonata 1",
					composer: "Mozart",
					durationSeconds: 120,
				},
			],
		});
		await f.checkout.linkRegistrationMetadataToEntitlement({
			checkoutIntentId: "intent-1",
			classEntitlementId: entitlement.id,
		});

		const accompanistGrant =
			await f.organizations.createAccompanistMembershipGrant({
				organizationId: f.org.id,
				customerId: "acc-customer-1",
				normalizedEmail: "accompanist@example.com",
				offeringNameSnapshot: "Accompanist Annual",
				source: "accompanist_form",
				contact: {
					name: "Jane Accompanist",
					email: "accompanist@example.com",
					city: "Seattle",
					phone: "555-0100",
				},
				divisions: [],
				startsOn: "2026-01-01",
				endsOn: "2026-12-31",
			});

		const cutoff = deriveFestivalMetadataCutoff(
			"2026-05-15",
			"America/Los_Angeles",
		);
		const validPieces = [
			{
				title: "Nocturne",
				composer: "Chopin",
				durationSeconds: 180,
			},
		];

		// 1. Cutoff boundary: before cutoff succeeds
		f.setNow(new Date(cutoff.getTime() - 1000));
		const beforeCutoff = await f.service.listClassRegistrations(
			"festival",
			auth.sessionId,
			"spring-2026",
		);
		expect(beforeCutoff.registrations[0]).toMatchObject({
			metadata: { teacherName: null },
			metadataEditCutoffIso: "2026-04-03T07:00:00.000Z",
			canEditMetadata: true,
		});
		const successRes = await f.service.updateRegistrationMetadata(
			"festival",
			"spring-2026",
			entitlement.id,
			auth.sessionId,
			csrfToken,
			origin,
			{ pieces: validPieces },
		);
		expect(successRes.metadata.repertoireJson[0].title).toBe("Nocturne");
		expect(successRes.metadata.repertoireJson[0].composer).toBe("Chopin");

		// 1b. Cutoff boundary: at cutoff throws 422
		f.setNow(new Date(cutoff.getTime()));
		const atCutoff = await f.service.listClassRegistrations(
			"festival",
			auth.sessionId,
		);
		expect(atCutoff.registrations[0].canEditMetadata).toBe(false);
		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{ pieces: validPieces },
			),
		).rejects.toThrow(
			"Registration metadata edits are closed for this festival.",
		);

		// 1c. Cutoff boundary: after cutoff throws 422
		f.setNow(new Date(cutoff.getTime() + 1000));
		const afterCutoff = await f.service.listClassRegistrations(
			"festival",
			auth.sessionId,
			"spring-2026",
		);
		expect(afterCutoff.registrations[0].canEditMetadata).toBe(false);
		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{ pieces: validPieces },
			),
		).rejects.toThrow(
			"Registration metadata edits are closed for this festival.",
		);

		// Reset time to before cutoff for remaining tests
		f.setNow(new Date(cutoff.getTime() - 1000));

		// 2. Entitlement customer check: non-existent registration throws 404
		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				"non-existent-id",
				auth.sessionId,
				csrfToken,
				origin,
				{ pieces: validPieces },
			),
		).rejects.toThrow("Registration not found.");

		// 2b. Entitlement customer check: entitlement belonging to another customer throws 404
		const otherEntitlement = await f.commerce.createClassEntitlement({
			organizationId: f.org.id,
			festivalId: festival.id,
			festivalClassId: classConfig.id,
			parentCustomerId: "someone-else-customer-id",
			childId: "child-2",
			checkoutIntentId: "intent-2",
			shopifyOrderGid: "gid://shopify/Order/2",
			shopifyOrderLineGid: "gid://shopify/LineItem/2",
			paidAmountCents: 3000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});
		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				otherEntitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{ pieces: validPieces },
			),
		).rejects.toThrow("Registration not found.");

		// 3. Pieces validation
		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{ pieces: [] },
			),
		).rejects.toThrow("Repertoire pieces must be a non-empty array.");

		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{
					pieces: [
						{ title: "Piece 1", composer: "C1", durationSeconds: 60 },
						{ title: "Piece 2", composer: "C2", durationSeconds: 60 },
						{ title: "Piece 3", composer: "C3", durationSeconds: 60 },
					],
				},
			),
		).rejects.toThrow("exceeds the maximum allowed");

		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{
					pieces: [{ title: "Piece 1", composer: "   ", durationSeconds: 60 }],
				},
			),
		).rejects.toThrow("Each repertoire piece must have a valid composer.");

		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{
					pieces: [{ title: "Piece 1", composer: "C1", durationSeconds: 0 }],
				},
			),
		).rejects.toThrow(
			"Each repertoire piece must have a positive whole-number duration in seconds.",
		);

		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{
					pieces: [
						{ title: "Long piece", composer: "Bach", durationSeconds: 700 },
					],
				},
			),
		).rejects.toThrow("Total performance duration");

		// 4. Accompanist update: valid accompanist grant
		const accRes = await f.service.updateRegistrationMetadata(
			"festival",
			"spring-2026",
			entitlement.id,
			auth.sessionId,
			csrfToken,
			origin,
			{
				pieces: validPieces,
				accompanistMembershipId: accompanistGrant.id,
			},
		);
		expect(accRes.metadata.accompanistMembershipId).toBe(accompanistGrant.id);

		// 4b. Accompanist update: invalid accompanist throws 400
		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{
					pieces: validPieces,
					accompanistMembershipId: "invalid-accompanist-id",
				},
			),
		).rejects.toThrow(
			"Selected accompanist does not have an active membership.",
		);

		// 4c. Accompanist update: clear accompanist to null
		const clearRes = await f.service.updateRegistrationMetadata(
			"festival",
			"spring-2026",
			entitlement.id,
			auth.sessionId,
			csrfToken,
			origin,
			{
				pieces: validPieces,
				accompanistMembershipId: null,
			},
		);
		expect(clearRes.metadata.accompanistMembershipId).toBeNull();

		// 4d. Lookup without festivalShortName
		const noFestRes = await f.service.updateRegistrationMetadata(
			"festival",
			undefined,
			entitlement.id,
			auth.sessionId,
			csrfToken,
			origin,
			{ pieces: validPieces },
		);
		expect(noFestRes.metadata.id).toBe("reg-meta-1");

		// Historical registrations remain listable when their class/festival is absent.
		f.organizations.listFestivalClassConfigurations = async () => [];
		const missingClass = await f.service.listClassRegistrations(
			"festival",
			auth.sessionId,
		);
		expect(missingClass.registrations[0]).toMatchObject({
			metadataEditCutoffIso: "2026-04-03T07:00:00.000Z",
			canEditMetadata: false,
		});
		f.organizations.listFestivals = async () => [];
		const missingFestival = await f.service.listClassRegistrations(
			"festival",
			auth.sessionId,
		);
		expect(missingFestival.registrations[0]).toMatchObject({
			metadataEditCutoffIso: null,
			canEditMetadata: false,
		});
	});

	it("does not allow reading Shopify order history without a session, or across tenants", async () => {
		const f = await fixture();
		await expect(f.service.orders("festival", undefined)).rejects.toMatchObject(
			{ status: 401 },
		);
		const auth = await f.authenticate();
		await expect(
			f.service.orders("other", auth.sessionId),
		).rejects.toMatchObject({ status: 401 });
	});

	it("does not allow a customer session to list class registrations across tenants", async () => {
		const f = await fixture();
		const auth = await f.authenticate();
		await expect(
			f.service.listClassRegistrations("other", auth.sessionId),
		).rejects.toMatchObject({ status: 401 });
	});

	it("only lists the authenticated parent's own class registrations, not another parent's", async () => {
		const f = await fixture();
		const festival = await f.organizations.createFestival({
			id: "fest-1",
			organizationId: f.org.id,
			code: "SPF26",
			name: "Spring Festival 2026",
			shortName: "spring-2026",
			startDate: "2026-05-15",
			endDate: "2026-05-20",
		});
		const classConfig = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: festival.id,
			displayName: "Solo Piano",
			classSubtypeId: "piano",
			divisionId: "div_1",
			minimumAge: 5,
			maximumAge: 18,
			price: "30.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 20,
			shopifyProductGid: "gid://shopify/Product/2",
			shopifyVariantGid: "gid://shopify/ProductVariant/2",
		});
		const auth = await f.authenticate();

		await f.commerce.createClassEntitlement({
			organizationId: f.org.id,
			festivalId: festival.id,
			festivalClassId: classConfig.id,
			parentCustomerId: "a-different-parent",
			childId: "someone-elses-child",
			checkoutIntentId: "intent-other-parent",
			shopifyOrderGid: "gid://shopify/Order/999",
			shopifyOrderLineGid: "gid://shopify/LineItem/999",
			paidAmountCents: 3000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		const result = await f.service.listClassRegistrations(
			"festival",
			auth.sessionId,
		);
		expect(result.registrations).toEqual([]);
	});

	it("exposes the verified Shopify paid time on a class registration, and null when no payment evidence exists yet", async () => {
		const f = await fixture();
		const festival = await f.organizations.createFestival({
			id: "fest-1",
			organizationId: f.org.id,
			code: "SPF26",
			name: "Spring Festival 2026",
			shortName: "spring-2026",
			startDate: "2026-05-15",
			endDate: "2026-05-20",
		});
		const classConfig = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: festival.id,
			displayName: "Solo Piano",
			classSubtypeId: "piano",
			divisionId: "div_1",
			minimumAge: 5,
			maximumAge: 18,
			price: "30.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 20,
			shopifyProductGid: "gid://shopify/Product/3",
			shopifyVariantGid: "gid://shopify/ProductVariant/3",
		});
		const auth = await f.authenticate();
		const storedSession = await f.repository.getSession(auth.sessionId);
		if (!storedSession) throw new Error("session");
		const customerId = storedSession.customerId;
		const unpaidChild = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: customerId,
			displayName: "Unpaid-Evidence Child",
		});

		const paidEntitlement = await f.commerce.createClassEntitlement({
			organizationId: f.org.id,
			festivalId: festival.id,
			festivalClassId: classConfig.id,
			parentCustomerId: customerId,
			childId: "child-with-paid-order",
			checkoutIntentId: "intent-paid",
			shopifyOrderGid: "gid://shopify/Order/paid-1",
			shopifyOrderLineGid: "gid://shopify/LineItem/paid-1",
			paidAmountCents: 3000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});
		await f.commerce.upsertOrderProjection({
			organizationId: f.org.id,
			shopifyOrderGid: "gid://shopify/Order/paid-1",
			fullyPaidAtIso: "2026-05-01T12:00:00.000Z",
			updatedAtIso: "2026-05-01T12:00:00.000Z",
		});

		const noProjectionEntitlement = await f.commerce.createClassEntitlement({
			organizationId: f.org.id,
			festivalId: festival.id,
			festivalClassId: classConfig.id,
			parentCustomerId: customerId,
			childId: unpaidChild.id,
			checkoutIntentId: "intent-no-projection",
			checkoutIntentLineId: "intent-line-no-projection",
			shopifyOrderGid: "gid://shopify/Order/no-projection-1",
			shopifyOrderLineGid: "gid://shopify/LineItem/no-projection-1",
			paidAmountCents: 3000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		f.setNow(new Date("2026-04-02T00:00:00.000Z"));
		const result = await f.service.listClassRegistrations(
			"festival",
			auth.sessionId,
		);
		const paid = result.registrations.find(
			(r) => r.entitlement.id === paidEntitlement.id,
		);
		const noProjection = result.registrations.find(
			(r) => r.entitlement.id === noProjectionEntitlement.id,
		);
		expect(paid?.paidAtIso).toBe("2026-05-01T12:00:00.000Z");
		expect(noProjection?.paidAtIso).toBeNull();
		expect(noProjection?.canEditMetadata).toBe(false);
		expect(noProjection?.metadataEditCutoffIso).toBe(
			"2026-04-03T00:00:00.000Z",
		);
		for (const item of result.registrations) {
			expect(item.entitlement).not.toHaveProperty("shopifyOrderGid");
			expect(item.entitlement).not.toHaveProperty("shopifyOrderLineGid");
			expect(item.entitlement).not.toHaveProperty("checkoutIntentId");
			expect(item.entitlement).not.toHaveProperty("checkoutIntentLineId");
		}
	});

	it("updates manual and linked concerto registration repertoire", async () => {
		const f = await fixture();
		await f.organizations.updateOrganizationTimezone(
			f.org.id,
			"America/Los_Angeles",
		);

		const festival = await f.organizations.createFestival({
			id: "fest-concerto",
			organizationId: f.org.id,
			code: "SPF26",
			name: "Spring Festival 2026",
			shortName: "spring-2026",
			startDate: "2026-05-15",
			endDate: "2026-05-20",
		});

		const concertoSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.org.id,
				kind: "class_subtype",
				displayName: "Concerto",
				normalizedName: "concerto",
			});

		const classInput = {
			organizationId: f.org.id,
			festivalId: festival.id,
			divisionId: "div_1",
			minimumAge: 5,
			maximumAge: 18,
			price: "45.00",
			maximumPerformancePieces: 1 as const,
			performanceMinutes: 15,
			capacity: 20,
		};
		const concertoClass =
			await f.organizations.createFestivalClassConfiguration({
				...classInput,
				displayName: "Junior Piano Concerto",
				classSubtypeId: concertoSubtype.id,
				shopifyProductGid: "gid://shopify/Product/4",
				shopifyVariantGid: "gid://shopify/ProductVariant/4",
			});

		const auth = await f.authenticate();
		const { session } = await f.service.session("festival", auth.sessionId);
		const storedSession = await f.repository.getSession(auth.sessionId);
		if (!storedSession) throw new Error("session");
		const customerId = storedSession.customerId;
		if (!session.authenticated) throw new Error("Expected authenticated");
		const csrfToken = session.csrfToken;
		const origin = "https://festival.example.com";

		async function createRegistration(
			festivalClassId: string,
			reference: string,
		) {
			const checkoutIntentId = `intent-${reference}`;
			const entitlement = await f.commerce.createClassEntitlement({
				organizationId: f.org.id,
				festivalId: festival.id,
				festivalClassId,
				parentCustomerId: customerId,
				childId: "child-1",
				checkoutIntentId,
				shopifyOrderGid: `gid://shopify/Order/${reference}`,
				shopifyOrderLineGid: `gid://shopify/LineItem/${reference}`,
				paidAmountCents: 4500,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});
			await f.checkout.insertRegistrationMetadata({
				id: `reg-meta-${reference}`,
				organizationId: f.org.id,
				festivalId: festival.id,
				checkoutIntentId,
				teacherMembershipId: "teacher-1",
				accompanistMembershipId: null,
				repertoireJson: [
					{
						title: "Initial piece",
						composer: "Grieg",
						durationSeconds: 300,
					},
				],
			});
			await f.checkout.linkRegistrationMetadataToEntitlement({
				checkoutIntentId,
				classEntitlementId: entitlement.id,
			});
			return entitlement;
		}
		const entitlement = await createRegistration(
			concertoClass.id,
			"concerto-1",
		);

		const cutoff = deriveFestivalMetadataCutoff(
			"2026-05-15",
			"America/Los_Angeles",
		);
		f.setNow(new Date(cutoff.getTime() - 10_000));

		const manualPiece = {
			title: "Piano Concerto in A minor".padEnd(200, "x"),
			composer: "Edvard Grieg",
			durationSeconds: 305,
		};
		const manualUpdate = await f.service.updateRegistrationMetadata(
			"festival",
			"spring-2026",
			entitlement.id,
			auth.sessionId,
			csrfToken,
			origin,
			{ pieces: [manualPiece] },
		);
		expect(manualUpdate.metadata.repertoireJson).toEqual([manualPiece]);
		expect(manualUpdate.metadata.repertoireItems[0]?.catalogWorkId).toBeNull();
		const registrations = await f.service.listClassRegistrations(
			"festival",
			auth.sessionId,
			"spring-2026",
		);
		expect(registrations.registrations[0]?.metadata?.repertoireJson).toEqual([
			manualPiece,
		]);

		// 2. Catalog work not classified as concerto is rejected with 400
		f.repertoire.seedCanonicalWork({
			id: "work-sonata-1",
			organizationId: f.org.id,
			title: "Piano Sonata in C",
			composerName: "Mozart",
			classifications: ["sonata"],
			isActive: true,
		});

		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{
					pieces: [
						{
							title: "Piano Sonata in C",
							composer: "Mozart",
							durationSeconds: 300,
							catalogWorkId: "work-sonata-1",
						} as unknown as {
							title: string;
							composer: string;
							durationSeconds: number;
						},
					],
				},
			),
		).rejects.toMatchObject({ status: 400 });

		// 3. Catalog work classified as concerto is accepted and persists catalogWorkId
		const linkedPiece = {
			title: "Piano Concerto No. 2, Op. 18".padEnd(300, "x"),
			composer: "Sergei Rachmaninoff",
			movement: "I. Moderato",
			durationSeconds: 420,
			catalogWorkId: "work-concerto-valid",
		};
		f.repertoire.seedCanonicalWork({
			id: linkedPiece.catalogWorkId,
			organizationId: f.org.id,
			title: linkedPiece.title,
			composerName: linkedPiece.composer,
			classifications: ["concerto"],
			isActive: true,
		});

		const updated = await f.service.updateRegistrationMetadata(
			"festival",
			"spring-2026",
			entitlement.id,
			auth.sessionId,
			csrfToken,
			origin,
			{ pieces: [linkedPiece] },
		);

		expect(updated.metadata.repertoireJson).toEqual([linkedPiece]);
		expect(updated.metadata.repertoireItems[0]?.catalogWorkId).toBe(
			linkedPiece.catalogWorkId,
		);
		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{ pieces: [{ ...linkedPiece, catalogWorkId: null }] },
			),
		).rejects.toMatchObject({
			status: 400,
			message: "Repertoire piece title cannot exceed 200 characters.",
		});
		const linkedRegistrations = await f.service.listClassRegistrations(
			"festival",
			auth.sessionId,
			"spring-2026",
		);
		expect(
			linkedRegistrations.registrations[0]?.metadata?.repertoireJson,
		).toEqual([linkedPiece]);

		// 4. Cross-tenant catalogWorkId is rejected with 400
		f.repertoire.seedCanonicalWork({
			id: "work-other-org",
			organizationId: f.other.id,
			title: "Other Org Concerto",
			composerName: "Rachmaninoff",
			classifications: ["concerto"],
			isActive: true,
		});
		await expect(
			f.service.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				entitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{
					pieces: [
						{
							title: "Other Org Concerto",
							composer: "Rachmaninoff",
							durationSeconds: 300,
							catalogWorkId: "work-other-org",
						} as unknown as {
							title: string;
							composer: string;
							durationSeconds: number;
						},
					],
				},
			),
		).rejects.toMatchObject({ status: 400 });

		// A different class subtype still requires a verifiable link for the longer title.
		const soloSubtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.org.id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});
		const soloClass = await f.organizations.createFestivalClassConfiguration({
			...classInput,
			displayName: "Junior Piano Solo",
			classSubtypeId: soloSubtype.id,
		});
		const soloEntitlement = await createRegistration(soloClass.id, "solo-1");
		const serviceWithoutRepertoire = f.createService();
		await expect(
			serviceWithoutRepertoire.updateRegistrationMetadata(
				"festival",
				"spring-2026",
				soloEntitlement.id,
				auth.sessionId,
				csrfToken,
				origin,
				{ pieces: [linkedPiece] },
			),
		).rejects.toMatchObject({ status: 400, code: "catalog_work_invalid" });
	});

	it("caches organization lookup and registration age configuration in bounded caches", async () => {
		const f = await fixture();
		await f.organizations.updateRegistrationAgeConfiguration({
			organizationId: f.org.id,
			registrationAgeDate: "2026-06-01",
		});
		const auth = await f.authenticate();
		const session = await f.repository.getSession(auth.sessionId);
		if (!session) throw new Error("session");

		const initialMetrics = f.service.cacheMetrics();
		expect(initialMetrics.organizationBySlug).toBeDefined();
		expect(initialMetrics.registrationAgeConfig).toBeDefined();
		const initialOrgHits = initialMetrics.organizationBySlug.hits;
		const initialAgeHits = initialMetrics.registrationAgeConfig.hits;

		await f.service.session("festival", auth.sessionId);
		expect(f.service.cacheMetrics().organizationBySlug.hits).toBeGreaterThan(
			initialOrgHits,
		);

		const hitsBeforeProfile = f.service.cacheMetrics().organizationBySlug.hits;
		await f.service.customerProfile("festival", auth.sessionId);
		expect(f.service.cacheMetrics().organizationBySlug.hits).toBeGreaterThan(
			hitsBeforeProfile,
		);

		const created = await f.service.createChild(
			"festival",
			auth.sessionId,
			session.csrfToken,
			"https://festival.example.com",
			{ displayName: "Kiddo", birthday: "2016-06-01" },
		);

		await f.service.refreshChildAgeSnapshot(
			"festival",
			auth.sessionId,
			session.csrfToken,
			"https://festival.example.com",
			created.child.id,
			{ birthday: "2016-06-01" },
		);
		expect(f.service.cacheMetrics().registrationAgeConfig.hits).toBeGreaterThan(
			initialAgeHits,
		);
	});
	it("falls back to separate repository calls when optimized methods are not available", async () => {
		const f = await fixture();
		await f.organizations.updateRegistrationAgeConfiguration({
			organizationId: f.org.id,
			registrationAgeDate: "2026-06-01",
		});
		const auth = await f.authenticate();
		const session = await f.repository.getSession(auth.sessionId);
		if (!session) throw new Error("session");

		delete (f.repository as Partial<CustomerAccountRepository>)
			.findSessionCustomerAndIntegration;
		delete (f.repository as Partial<CustomerAccountRepository>)
			.createChildWithAgeSnapshot;

		const sessionResult = await f.service.session("festival", auth.sessionId);
		expect(sessionResult.session.authenticated).toBe(true);

		const created = await f.service.createChild(
			"festival",
			auth.sessionId,
			session.csrfToken,
			"https://festival.example.com",
			{ displayName: "FallbackChild", birthday: "2016-06-01" },
		);
		expect(created.child.displayName).toBe("FallbackChild");
		expect(created.ageSnapshot.age).toBe(10);
	});
});
