import { expect, test } from "bun:test";
import { sql } from "bun";
import { CustomerAccountTransport } from "../src/customer/customer-account-transport.js";
import { PostgresCustomerAccountRepository } from "../src/customer/postgres-customer-account-repository.js";
import { CustomerOAuthSessionService } from "../src/domains/customer-identity/customer-oauth-session-service.js";
import { PostgresCustomerSessionRepository } from "../src/domains/customer-identity/customer-session-repository.js";
import { RefreshConcurrencyLimiter } from "../src/domains/customer-identity/refresh-concurrency-limiter.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import {
	SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
const currentSchema = currentPostgresFixture("refresh_concurrency");
const origin = "https://festival.example.com";
const issuer = "https://shopify.com/authentication/shop-1";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const freshTokens = () =>
	Response.json({
		access_token: "access-2",
		refresh_token: "refresh-2",
		expires_in: 3600,
	});

function createMockTransport(
	exchange: (body: URLSearchParams) => Promise<Response>,
) {
	return new CustomerAccountTransport({
		resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
		requester: async (url, _answer, _agent, init) => {
			const response =
				url.pathname === "/token"
					? await exchange(new URLSearchParams(String(init?.body)))
					: url.pathname === "/.well-known/openid-configuration"
						? Response.json({
								issuer,
								authorization_endpoint:
									"https://accounts.shopify.com/authorize",
								token_endpoint: "https://accounts.shopify.com/token",
								end_session_endpoint: "https://accounts.shopify.com/logout",
								jwks_uri: "https://accounts.shopify.com/jwks",
							})
						: Response.json({
								graphql_api:
									"https://accounts.shopify.com/customer/api/2026-07/graphql",
							});
			const bytes = new Uint8Array(await response.arrayBuffer());
			return {
				status: response.status,
				body: (async function* () {
					yield bytes;
				})(),
			};
		},
	});
}

async function seedIntegrationOrg(schema: string) {
	const organizations = new PostgresOrganizationRepository(schema);
	const firstRepository = new PostgresCustomerAccountRepository(schema);
	const org = await organizations.createOrganization({
		name: "Refresh Concurrency",
		slug: "refresh-concurrency",
	});
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64") }),
		"test",
	);
	if (!keyring) throw new Error("keyring");
	const integration = await firstRepository.upsertIntegration({
		organizationId: org.id,
		storefrontDomain: "refresh.myshopify.com",
		clientId: "customer-client",
		encryptedClientSecret: keyring.encrypt("client-secret", {
			organizationId: org.id,
			purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
		}),
	});
	await firstRepository.setIntegrationReadiness(org.id, {
		readiness: "ready",
		canReadOrders: true,
	});
	const now = new Date();
	return { org, organizations, firstRepository, keyring, integration, now };
}

type SeededOrg = Awaited<ReturnType<typeof seedIntegrationOrg>>;

async function seedExpiredOrFreshSession(
	seeded: SeededOrg,
	sessionId: string,
	expired: boolean,
) {
	const { firstRepository, keyring, org, integration, now } = seeded;
	return (
		await firstRepository.createCustomerSession({
			sessionId,
			organizationId: org.id,
			shopifyCustomerGid: "gid://shopify/Customer/1",
			encryptedTokens: keyring.encrypt(
				JSON.stringify({
					issuer,
					accessToken: `access-${sessionId}`,
					refreshToken: `refresh-${sessionId}`,
					idToken: "existing-id-token",
					accessExpiresAtIso: new Date(
						now.getTime() + (expired ? -1_000 : 3_600_000),
					).toISOString(),
				}),
				{ organizationId: org.id, purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE },
			),
			csrfToken: `csrf-${sessionId}`,
			integrationVersion: integration.integrationVersion,
			createdAtIso: now.toISOString(),
			lastSeenAtIso: now.toISOString(),
			expiresAtIso: new Date(now.getTime() + 86_400_000).toISOString(),
		})
	).session;
}

async function concurrencyFixture(
	exchange: (body: URLSearchParams) => Promise<Response>,
) {
	const schema = await currentSchema();
	await resetPostgresFixture(schema);
	const seeded = await seedIntegrationOrg(schema);
	const { org, organizations, firstRepository, keyring, now } = seeded;
	const sessions = new PostgresCustomerSessionRepository(schema, sql, {
		refreshLimiter: new RefreshConcurrencyLimiter({
			maxConcurrent: 2,
			acquireTimeoutMs: 250,
		}),
		refreshTimeoutMs: 250,
	});
	const oauthService = new CustomerOAuthSessionService(
		{
			integrations: firstRepository,
			sessions,
			profiles: firstRepository,
			organizations,
			keyring,
		},
		{
			publicOrigin: origin,
			now: () => now,
			transport: createMockTransport(exchange),
		},
	);
	const [s1, s2, s3, fresh] = await Promise.all(
		["session-1", "session-2", "session-3", "session-fresh"].map((id) =>
			seedExpiredOrFreshSession(seeded, id, id !== "session-fresh"),
		),
	);
	const checkout = (s: { sessionId: string; csrfToken: string }) =>
		oauthService.checkoutAccess(org.slug, s.sessionId, s.csrfToken, origin);
	return { schema, ...seeded, oauthService, s1, s2, s3, fresh, checkout };
}

const makeStartedGates = () =>
	new Map([
		["refresh-session-1", deferred()],
		["refresh-session-2", deferred()],
	]);

integrationTest(
	"slow refreshes leave DB pool capacity open for unrelated queries",
	async () => {
		const started = makeStartedGates();
		const release = deferred();
		let released = false;
		const f = await concurrencyFixture(async (body) => {
			started.get(body.get("refresh_token") ?? "")?.resolve();
			await release.promise;
			return freshTokens();
		});
		try {
			const [refresh1, refresh2] = [f.checkout(f.s1), f.checkout(f.s2)];
			await Promise.all([...started.values()].map((g) => g.promise));
			const results = await Promise.all(
				Array.from({ length: 10 }, () => [
					f.organizations.findOrganizationBySlug(f.org.slug),
					f.oauthService.session(f.org.slug, f.fresh.sessionId),
				]).flat(),
			);
			expect(released).toBe(false);
			expect(results).toHaveLength(20);
			for (let i = 0; i < 10; i++) {
				expect(results[i * 2]).toMatchObject({ slug: f.org.slug });
				expect(results[i * 2 + 1]).toMatchObject({
					session: { authenticated: true, csrfToken: f.fresh.csrfToken },
				});
			}
			released = true;
			release.resolve();
			const refreshed = await Promise.all([refresh1, refresh2]);
			expect(refreshed.map((r) => r.shopifyCustomerAccessToken)).toEqual([
				"access-2",
				"access-2",
			]);
		} finally {
			release.resolve();
			await resetPostgresFixture(f.schema);
		}
	},
);

integrationTest(
	"bounded wait throws retryable 503 without revoking session, and retries cleanly",
	async () => {
		const started = makeStartedGates();
		const release = deferred();
		const f = await concurrencyFixture(async (body) => {
			const token = body.get("refresh_token") ?? "";
			if (started.has(token)) {
				started.get(token)?.resolve();
				await release.promise;
			}
			return freshTokens();
		});
		try {
			const [refresh1, refresh2] = [f.checkout(f.s1), f.checkout(f.s2)];
			await Promise.all([...started.values()].map((g) => g.promise));
			await expect(f.checkout(f.s3)).rejects.toMatchObject({ status: 503 });
			expect(await f.firstRepository.getSession(f.s3.sessionId)).toMatchObject({
				encryptedTokens: f.s3.encryptedTokens,
				revokedAtIso: undefined,
			});
			release.resolve();
			await Promise.all([refresh1, refresh2]);
			expect(await f.checkout(f.s3)).toMatchObject({
				shopifyCustomerAccessToken: "access-2",
			});
		} finally {
			release.resolve();
			await resetPostgresFixture(f.schema);
		}
	},
);
