import { describe, expect, it, spyOn } from "bun:test";
import { AppError } from "@festival/common";
import { sql } from "bun";
import type { SessionGuardContext } from "../src/domains/customer-identity/customer-session-guard.js";
import {
	PostgresCustomerSessionRepository,
	resolveDefaultRefreshConcurrency,
} from "../src/domains/customer-identity/customer-session-repository.js";
import { refreshSessionTokens } from "../src/domains/customer-identity/customer-token-refresh.js";
import { RefreshConcurrencyLimiter } from "../src/domains/customer-identity/refresh-concurrency-limiter.js";
import type {
	CustomerAccountIntegrationRecord,
	CustomerSessionRecord,
	CustomerSessionRepository,
	CustomerSessionTokenReplacementInput,
} from "../src/domains/customer-identity/types.js";
import {
	CustomerAccountTransport,
	SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	ShopifySecretKeyring,
} from "../src/infra/s10-infra.js";

const issuer = "https://shopify.com/authentication/shop-1";
const testNow = new Date("2026-06-01T12:00:00.000Z");
const rawKeyring = ShopifySecretKeyring.fromEnvironment(
	JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64") }),
	"test",
);
if (!rawKeyring) throw new Error("keyring");
const keyring: ShopifySecretKeyring = rawKeyring;

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function buildMockSession(sessionId: string): CustomerSessionRecord {
	const iso = (ms: number) => new Date(testNow.getTime() + ms).toISOString();
	return {
		sessionId,
		customerId: "cust-1",
		organizationId: "org-1",
		shopifyCustomerGid: "gid://shopify/Customer/1",
		encryptedTokens: keyring.encrypt(
			JSON.stringify({
				issuer,
				accessToken: `access-${sessionId}-1`,
				refreshToken: `refresh-${sessionId}-1`,
				idToken: "existing-id-token",
				accessExpiresAtIso: iso(-1000),
			}),
			{ organizationId: "org-1", purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE },
		),
		csrfToken: `csrf-${sessionId}`,
		integrationVersion: 1,
		createdAtIso: iso(0),
		lastSeenAtIso: iso(0),
		expiresAtIso: iso(86_400_000),
	};
}

const mockIntegration = {
	organizationId: "org-1",
	storefrontDomain: "refresh.myshopify.com",
	clientId: "customer-client",
	encryptedClientSecret: keyring.encrypt("client-secret", {
		organizationId: "org-1",
		purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	}),
	integrationVersion: 1,
} as CustomerAccountIntegrationRecord;

function createRefreshTestContext(
	sessions: CustomerSessionRepository,
	requester: () => Promise<Response>,
) {
	return {
		idleMs: 7 * 86_400_000,
		now: () => testNow,
		keyring,
		sessions,
		transport: new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async () => ({
				status: 200,
				body: (async function* () {
					yield new Uint8Array(await (await requester()).arrayBuffer());
				})(),
			}),
		}),
		discover: async () => ({
			oidc: { issuer, token_endpoint: "https://accounts.shopify.com/token" },
			api: { graphql_api: "" },
		}),
	} as unknown as SessionGuardContext;
}

const makeLimiter = (maxConcurrent: number, acquireTimeoutMs: number) =>
	new RefreshConcurrencyLimiter({ maxConcurrent, acquireTimeoutMs });

describe("RefreshConcurrencyLimiter", () => {
	it("enforces maxConcurrent strictly and drains queued waiters FIFO", async () => {
		expect(() => new RefreshConcurrencyLimiter({ maxConcurrent: 0 })).toThrow();
		expect(() => makeLimiter(1, 0)).toThrow();
		const limiter = makeLimiter(2, 1_000);
		const gates = Array.from({ length: 4 }, deferred);
		const order: number[] = [];
		const runs = gates.map((g, i) =>
			limiter.run(async () => {
				order.push(i);
				await g.promise;
				return i;
			}),
		);
		const state = () => [limiter.activeCount, limiter.queuedCount];
		expect([...state(), ...order]).toEqual([2, 2, 0, 1]);
		gates[0]?.resolve();
		await runs[0];
		expect([...state(), ...order]).toEqual([2, 1, 0, 1, 2]);
		gates[1]?.resolve();
		await runs[1];
		expect([...state(), ...order]).toEqual([2, 0, 0, 1, 2, 3]);
		for (const g of gates.slice(2)) g.resolve();
		expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
		expect(limiter.activeCount).toBe(0);
	});

	it("rejects timed-out waiters with 503 AppError, cleans queuedCount, and decrements activeCount on throw", async () => {
		const limiter = makeLimiter(1, 40);
		const gate = deferred();
		let timedOutRan = false;
		const active = limiter.run(async () => {
			await gate.promise;
			throw new Error("boom");
		});
		const queued = limiter.run(async () => {
			timedOutRan = true;
			return "never";
		});
		expect([limiter.activeCount, limiter.queuedCount]).toEqual([1, 1]);
		const rejected = await queued.catch((error: unknown) => error);
		expect(rejected).toBeInstanceOf(AppError);
		expect(rejected).toMatchObject({ status: 503 });
		expect(limiter.queuedCount).toBe(0);
		gate.resolve();
		await expect(active).rejects.toThrow("boom");
		expect([limiter.activeCount, timedOutRan]).toEqual([0, false]);
	});
});

function createStubSessions() {
	const stored = new Map<string, CustomerSessionRecord>();
	const gates = new Map<string, ReturnType<typeof deferred>>();
	const lockCalls: string[] = [];
	const limiter = makeLimiter(2, 1_000);
	const sessions = {
		getSession: async (id: string) => stored.get(id) ?? null,
		replaceSessionTokens: async (i: CustomerSessionTokenReplacementInput) => {
			const cur = stored.get(i.sessionId);
			if (!cur) return null;
			const next = { ...cur, encryptedTokens: i.replacementEncryptedTokens };
			stored.set(i.sessionId, next);
			return next;
		},
		withSessionRefreshLock: <T>(
			id: string,
			op: (repo: CustomerSessionRepository) => Promise<T>,
		) => {
			lockCalls.push(id);
			return limiter.run(() =>
				Promise.resolve(gates.get(id)?.promise).then(() => op(sessions)),
			);
		},
	} as unknown as CustomerSessionRepository;
	const seed = (id: string) => {
		const s = buildMockSession(id);
		stored.set(id, s);
		gates.set(id, deferred());
		return s;
	};
	return { gates, lockCalls, limiter, sessions, seed };
}

describe("refreshSessionTokens coalescing", () => {
	it("coalesces concurrent refreshes per (sessions, sessionId) and runs distinct sessionIds independently", async () => {
		const { gates, lockCalls, limiter, sessions, seed } = createStubSessions();
		let counter = 0;
		const ctx = createRefreshTestContext(sessions, async () =>
			Response.json({
				access_token: `access-${++counter}`,
				refresh_token: `refresh-${++counter}`,
				expires_in: 3600,
			}),
		);
		const [s1, s2, s3] = ["s-1", "s-2", "s-3"].map(seed);
		const runs = [s1, s1, s1, s2, s3].map((s) =>
			refreshSessionTokens(ctx, s, mockIntegration),
		);
		await Promise.resolve();
		expect(lockCalls).toEqual(["s-1", "s-2", "s-3"]);
		expect([limiter.activeCount, limiter.queuedCount]).toEqual([2, 1]);
		for (const gate of gates.values()) gate.resolve();
		const settled = await Promise.all(runs);
		expect(settled[0]?.encryptedTokens).toBe(settled[1]?.encryptedTokens);
		expect(settled[1]?.encryptedTokens).toBe(settled[2]?.encryptedTokens);
		expect(lockCalls).toHaveLength(3);
	});
});

describe("PostgresCustomerSessionRepository default limiter", () => {
	it("permits 10 concurrent slots after sql.options.max becomes 80 instead of staying at 2", async () => {
		const originalMax = sql.options.max;
		sql.options.max = 10;
		const repo = new PostgresCustomerSessionRepository("festival");
		const ready = spyOn(repo, "ensureReady").mockResolvedValue();
		const reserve = spyOn(sql, "reserve").mockResolvedValue({
			unsafe: async () => [{ acquired: true }],
			release: () => {},
		} as never);
		let gate = deferred();
		const assertLimit = async (max: number, limit: number) => {
			sql.options.max = max;
			expect(resolveDefaultRefreshConcurrency()).toBe(limit);
			gate = deferred();
			const done = deferred();
			let active = 0;
			const locks = Array.from({ length: limit + 1 }, (_, i) =>
				repo.withSessionRefreshLock(`s-${limit}-${i}`, async () => {
					if (++active === limit) done.resolve();
					await gate.promise;
				}),
			);
			await done.promise;
			for (let i = 0; i < 6; i++) await Promise.resolve();
			expect(active).toBe(limit);
			gate.resolve();
			await Promise.all(locks);
			expect(active).toBe(limit + 1);
		};
		try {
			await assertLimit(10, 2);
			await assertLimit(80, 10);
		} finally {
			gate.resolve();
			sql.options.max = originalMax;
			reserve.mockRestore();
			ready.mockRestore();
		}
	});
});
