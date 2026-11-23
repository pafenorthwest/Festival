import { expect, mock, spyOn, test } from "bun:test";
import { sql } from "bun";
import { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { CustomerAccountTransport } from "../src/customer/customer-account-transport.js";
import { PostgresCustomerAccountRepository } from "../src/customer/postgres-customer-account-repository.js";
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
const currentSchema = currentPostgresFixture("token_refresh");
const origin = "https://festival.example.com";
const issuer = "https://shopify.com/authentication/shop-1";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function fixture(exchange: (body: URLSearchParams) => Promise<Response>) {
	const schema = await currentSchema();
	await resetPostgresFixture(schema);
	const organizations = new PostgresOrganizationRepository(schema);
	const firstRepository = new PostgresCustomerAccountRepository(schema);
	const secondRepository = new PostgresCustomerAccountRepository(schema);
	const org = await organizations.createOrganization({
		name: "Refresh",
		slug: "refresh",
	});
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64") }),
		"test",
	);
	if (!keyring) throw new Error("keyring");
	const now = new Date();
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
	const tokenBundle = {
		issuer,
		accessToken: "access-1",
		refreshToken: "refresh-1",
		idToken: "existing-id-token",
		accessExpiresAtIso: new Date(now.getTime() - 1000).toISOString(),
	};
	const session = (
		await firstRepository.createCustomerSession({
			sessionId: "refresh-session",
			organizationId: org.id,
			shopifyCustomerGid: "gid://shopify/Customer/1",
			encryptedTokens: keyring.encrypt(JSON.stringify(tokenBundle), {
				organizationId: org.id,
				purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
			}),
			csrfToken: "csrf-refresh",
			integrationVersion: integration.integrationVersion,
			createdAtIso: now.toISOString(),
			lastSeenAtIso: now.toISOString(),
			expiresAtIso: new Date(now.getTime() + 86_400_000).toISOString(),
		})
	).session;
	const createService = (repository: PostgresCustomerAccountRepository) =>
		new CustomerAccountService(repository, organizations, keyring, {
			publicOrigin: origin,
			now: () => now,
			transport: new CustomerAccountTransport({
				resolver: async () => [
					{ address: "8.8.8.8", family: 4, ttlSeconds: 60 },
				],
				requester: async (url, _answer, _agent, init) => {
					let response: Response;
					if (url.pathname === "/token")
						response = await exchange(new URLSearchParams(String(init?.body)));
					else if (url.pathname === "/.well-known/openid-configuration")
						response = Response.json({
							issuer,
							authorization_endpoint: "https://accounts.shopify.com/authorize",
							token_endpoint: "https://accounts.shopify.com/token",
							end_session_endpoint: "https://accounts.shopify.com/logout",
							jwks_uri: "https://accounts.shopify.com/jwks",
						});
					else
						response = Response.json({
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
			}),
		});
	const first = createService(firstRepository);
	const second = createService(secondRepository);
	const checkout = (service = first) =>
		service.checkoutAccess(
			org.slug,
			session.sessionId,
			session.csrfToken,
			origin,
		);
	return {
		schema,
		org,
		keyring,
		tokenBundle,
		session,
		firstRepository,
		secondRepository,
		first,
		second,
		checkout,
	};
}

const freshTokens = () =>
	Response.json({
		access_token: "access-2",
		refresh_token: "refresh-2",
		expires_in: 3600,
	});

for (const failure of [503, 429, 403, "unknown-400", "network"] as const) {
	integrationTest(
		`preserves the local session and CSRF after ${failure} refresh failure and permits a peer retry`,
		async () => {
			let requests = 0;
			const f = await fixture(async () => {
				requests++;
				if (requests > 1) return freshTokens();
				if (failure === "network")
					throw new Error("temporary transport failure");
				return Response.json(
					{ error: "temporarily_unavailable" },
					{ status: failure === "unknown-400" ? 400 : failure },
				);
			});
			try {
				await expect(f.checkout()).rejects.toMatchObject({ status: 503 });
				expect(
					await f.firstRepository.getSession(f.session.sessionId),
				).toMatchObject({
					encryptedTokens: f.session.encryptedTokens,
					revokedAtIso: undefined,
				});
				expect(
					(await f.first.session(f.org.slug, f.session.sessionId)).session,
				).toMatchObject({
					authenticated: true,
					csrfToken: f.session.csrfToken,
				});
				expect(await f.checkout(f.second)).toMatchObject({
					shopifyCustomerAccessToken: "access-2",
				});
				expect(requests).toBe(2);
			} finally {
				await resetPostgresFixture(f.schema);
			}
		},
	);
}

for (const status of [400, 401, 200, "invalid-json"] as const) {
	integrationTest(
		`invalid token credentials or malformed success (${status}) revoke the session`,
		async () => {
			const f = await fixture(async () =>
				status === "invalid-json"
					? new Response("invalid-json")
					: Response.json(status === 200 ? {} : { error: "invalid_grant" }, {
							status,
						}),
			);
			try {
				await expect(f.checkout()).rejects.toMatchObject({ status: 401 });
				expect(
					(await f.first.session(f.org.slug, f.session.sessionId)).session,
				).toEqual({ authenticated: false });
			} finally {
				await resetPostgresFixture(f.schema);
			}
		},
	);
}

integrationTest(
	"serializes two repository and service instances before consuming a single-use refresh token",
	async () => {
		const started = deferred();
		const release = deferred();
		let availableToken = "refresh-1";
		let requests = 0;
		const f = await fixture(async (body) => {
			requests++;
			if (body.get("refresh_token") !== availableToken)
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			availableToken = "refresh-2";
			started.resolve();
			await release.promise;
			return freshTokens();
		});
		try {
			const winner = f.checkout();
			await started.promise;
			const peer = f.checkout(f.second);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(requests).toBe(1);
			release.resolve();
			const results = await Promise.all([winner, peer]);
			expect(
				results.map((result) => result.shopifyCustomerAccessToken),
			).toEqual(["access-2", "access-2"]);
			expect(requests).toBe(1);
			expect(
				(await f.second.session(f.org.slug, f.session.sessionId)).session,
			).toMatchObject({ authenticated: true, csrfToken: f.session.csrfToken });
		} finally {
			release.resolve();
			await resetPostgresFixture(f.schema);
		}
	},
);

for (const action of ["logout", "integration rotation"] as const) {
	integrationTest(
		`does not restore a session after concurrent ${action} during token refresh`,
		async () => {
			const started = deferred();
			const release = deferred();
			const f = await fixture(async () => {
				started.resolve();
				await release.promise;
				return freshTokens();
			});
			try {
				const pending = f.checkout();
				await started.promise;
				if (action === "logout")
					await f.second.logout(
						f.org.slug,
						f.session.sessionId,
						f.session.csrfToken,
						origin,
					);
				else
					await f.secondRepository.upsertIntegration({
						organizationId: f.org.id,
						storefrontDomain: "refresh.myshopify.com",
						clientId: "rotated-client",
						encryptedClientSecret: "rotated-secret",
					});
				release.resolve();
				await expect(pending).rejects.toMatchObject({ status: 401 });
				const stored = await f.firstRepository.getSession(f.session.sessionId);
				expect(stored?.encryptedTokens).toBe(f.session.encryptedTokens);
				expect(stored?.revokedAtIso).toBeDefined();
				expect(
					(await f.second.session(f.org.slug, f.session.sessionId)).session,
				).toEqual({ authenticated: false });
			} finally {
				release.resolve();
				await resetPostgresFixture(f.schema);
			}
		},
	);
}

integrationTest(
	"a lost conditional token replacement preserves a peer's refreshed session",
	async () => {
		const started = deferred();
		const release = deferred();
		const f = await fixture(async () => {
			started.resolve();
			await release.promise;
			return freshTokens();
		});
		try {
			const pending = f.checkout();
			await started.promise;
			const seenAt = new Date().toISOString();
			await f.secondRepository.replaceSessionTokens({
				sessionId: f.session.sessionId,
				organizationId: f.org.id,
				integrationVersion: f.session.integrationVersion,
				seenAtIso: seenAt,
				idleCutoffIso: new Date(Date.now() - 86_400_000).toISOString(),
				expectedEncryptedTokens: f.session.encryptedTokens,
				replacementExpiresAtIso: f.session.expiresAtIso,
				replacementEncryptedTokens: f.keyring.encrypt(
					JSON.stringify({
						...f.tokenBundle,
						accessToken: "peer-access",
						refreshToken: "peer-refresh",
						accessExpiresAtIso: new Date(Date.now() + 3600_000).toISOString(),
					}),
					{
						organizationId: f.org.id,
						purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
					},
				),
			});
			release.resolve();
			expect(await pending).toMatchObject({
				shopifyCustomerAccessToken: "peer-access",
			});
			await f.secondRepository.revokeSession(
				f.session.sessionId,
				new Date().toISOString(),
				f.session.encryptedTokens,
			);
			expect(
				(await f.first.session(f.org.slug, f.session.sessionId)).session,
			).toMatchObject({ authenticated: true, csrfToken: f.session.csrfToken });
		} finally {
			release.resolve();
			await resetPostgresFixture(f.schema);
		}
	},
);

integrationTest(
	"releases the PostgreSQL refresh lock when its operation fails",
	async () => {
		const f = await fixture(async () => freshTokens());
		try {
			await expect(
				f.firstRepository.withSessionRefreshLock(
					f.session.sessionId,
					async () => {
						throw new Error("operation failed");
					},
				),
			).rejects.toThrow("operation failed");
			expect(
				await f.secondRepository.withSessionRefreshLock(
					f.session.sessionId,
					async () => "released",
				),
			).toBe("released");
		} finally {
			await resetPostgresFixture(f.schema);
		}
	},
);

integrationTest(
	"discards a reserved connection if unlock fails and cleans up uncertain acquisition",
	async () => {
		const f = await fixture(async () => freshTokens());
		try {
			for (const failure of ["unlock", "acquire"] as const) {
				const close = mock(async () => {});
				const release = mock(() => {});
				const unsafe = mock(async (query: string) => {
					if (query.includes("pg_try_advisory_lock")) {
						if (failure === "acquire") throw new Error("uncertain acquisition");
						return [{ acquired: true }];
					}
					if (failure === "unlock") throw new Error("unlock failed");
					return [{ pg_advisory_unlock: true }];
				});
				const reserve = spyOn(sql, "reserve").mockResolvedValueOnce({
					unsafe,
					close,
					release,
				} as unknown as Awaited<ReturnType<typeof sql.reserve>>);
				try {
					await expect(
						f.firstRepository.withSessionRefreshLock(
							f.session.sessionId,
							async () => "done",
						),
					).rejects.toThrow(
						failure === "unlock" ? "unlock failed" : "uncertain acquisition",
					);
					expect(unsafe.mock.calls[1][0]).toContain("pg_advisory_unlock");
					expect(close.mock.calls.length).toBe(failure === "unlock" ? 1 : 0);
					expect(release.mock.calls.length).toBe(failure === "unlock" ? 0 : 1);
				} finally {
					reserve.mockRestore();
				}
			}
		} finally {
			await resetPostgresFixture(f.schema);
		}
	},
);
