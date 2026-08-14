import { describe, expect, it } from "bun:test";
import type { Agent } from "node:https";
import { BoundedAsyncCache } from "../src/customer/bounded-async-cache.js";
import {
	type CustomerAccountRawResponse,
	CustomerAccountTransport,
	type DnsAnswer,
	isGlobalAddress,
} from "../src/customer/customer-account-transport.js";

function raw(value: unknown): CustomerAccountRawResponse {
	const bytes = Buffer.from(JSON.stringify(value));
	return {
		status: 200,
		contentLength: bytes.byteLength,
		body: (async function* () {
			yield bytes;
		})(),
	};
}

describe("CustomerAccountTransport", () => {
	it("rejects non-global, reserved, mapped, and malformed DNS answers", () => {
		for (const answer of [
			{ address: "127.0.0.1", family: 4, ttlSeconds: 60 },
			{ address: "10.0.0.1", family: 4, ttlSeconds: 60 },
			{ address: "169.254.169.254", family: 4, ttlSeconds: 60 },
			{ address: "192.0.2.1", family: 4, ttlSeconds: 60 },
			{ address: "::1", family: 6, ttlSeconds: 60 },
			{ address: "::ffff:8.8.8.8", family: 6, ttlSeconds: 60 },
			{ address: "fc00::1", family: 6, ttlSeconds: 60 },
			{ address: "8.8.8.8", family: 6, ttlSeconds: 60 },
			{ address: "not-an-address", family: 4, ttlSeconds: 60 },
		] as DnsAnswer[])
			expect(isGlobalAddress(answer)).toBe(false);
		expect(
			isGlobalAddress({ address: "8.8.8.8", family: 4, ttlSeconds: 60 }),
		).toBe(true);
	});

	it("pins requests to validated answers and rotates the connection at DNS expiry", async () => {
		let now = 0;
		let resolves = 0;
		const seen: Array<{ address: string; agent: Agent }> = [];
		const transport = new CustomerAccountTransport({
			now: () => now,
			dnsTtlMs: 60_000,
			resolver: async () => {
				resolves++;
				return [
					{
						address: resolves === 1 ? "8.8.8.8" : "1.1.1.1",
						family: 4,
						ttlSeconds: 2,
					},
				];
			},
			requester: async (_url, answer, agent) => {
				seen.push({ address: answer.address, agent });
				return raw({ ok: true });
			},
		});
		const url = new URL("https://store.example.com/metadata");
		await transport.json(url, "store.example.com");
		now = 1_000;
		await transport.json(url, "store.example.com");
		now = 2_001;
		await transport.json(url, "store.example.com");
		expect(seen.map((value) => value.address)).toEqual([
			"8.8.8.8",
			"8.8.8.8",
			"1.1.1.1",
		]);
		expect(seen[0]?.agent).toBe(seen[1]?.agent);
		expect(seen[2]?.agent).not.toBe(seen[1]?.agent);
		expect(resolves).toBe(2);
	});

	it("retires an expired pool without aborting a response already in flight", async () => {
		let now = 0;
		let resolves = 0;
		let releaseFirstBody: (() => void) | undefined;
		let markFirstBodyStarted: (() => void) | undefined;
		const firstBodyStarted = new Promise<void>((resolve) => {
			markFirstBodyStarted = resolve;
		});
		const firstBodyReleased = new Promise<void>((resolve) => {
			releaseFirstBody = resolve;
		});
		const agents: Agent[] = [];
		const destroyCalls = new Map<Agent, number>();
		const transport = new CustomerAccountTransport({
			now: () => now,
			dnsTtlMs: 1_000,
			resolver: async () => {
				resolves++;
				return [{ address: "8.8.8.8", family: 4, ttlSeconds: 1 }];
			},
			requester: async (_url, _answer, agent) => {
				if (!destroyCalls.has(agent)) {
					agents.push(agent);
					destroyCalls.set(agent, 0);
					const destroy = agent.destroy.bind(agent);
					agent.destroy = () => {
						destroyCalls.set(agent, (destroyCalls.get(agent) ?? 0) + 1);
						destroy();
					};
				}
				if (agents.length !== 1) return raw({ request: "second" });
				return {
					status: 200,
					body: (async function* () {
						markFirstBodyStarted?.();
						await firstBodyReleased;
						yield Buffer.from(JSON.stringify({ request: "first" }));
					})(),
				};
			},
		});
		const url = new URL("https://store.example.com/metadata");
		const first = transport.json(url, "store.example.com");
		await firstBodyStarted;

		now = 1_001;
		/* A metrics read expires cache entries and must not kill the active socket. */
		expect(transport.metrics().expirations).toBe(1);
		expect(destroyCalls.get(agents[0] as Agent)).toBe(0);
		expect(await transport.json(url, "store.example.com")).toEqual({
			request: "second",
		});
		expect(agents).toHaveLength(2);
		expect(destroyCalls.get(agents[0] as Agent)).toBe(0);

		releaseFirstBody?.();
		expect(await first).toEqual({ request: "first" });
		expect(destroyCalls.get(agents[0] as Agent)).toBe(1);
		expect(destroyCalls.get(agents[1] as Agent)).toBe(0);
		expect(resolves).toBe(2);
	});

	it("rejects a mixed safe/private answer set before opening a request", async () => {
		let requests = 0;
		const transport = new CustomerAccountTransport({
			resolver: async () => [
				{ address: "8.8.8.8", family: 4, ttlSeconds: 60 },
				{ address: "127.0.0.1", family: 4, ttlSeconds: 60 },
			],
			requester: async () => {
				requests++;
				return raw({ ok: true });
			},
		});
		await expect(
			transport.json(
				new URL("https://store.example.com/metadata"),
				"store.example.com",
			),
		).rejects.toThrow("Unsafe");
		expect(requests).toBe(0);
	});

	it("rejects unsafe endpoint relationships and redirects", async () => {
		let requests = 0;
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async () => {
				requests++;
				return { ...raw({}), status: 302 };
			},
		});
		for (const url of [
			"http://store.example.com/path",
			"https://user:password@store.example.com/path",
			"https://store.example.com:8443/path",
			"https://evil.example.com/path",
			"https://127.0.0.1/path",
		])
			await expect(
				transport.json(new URL(url), "store.example.com"),
			).rejects.toThrow("Unsafe");
		expect(requests).toBe(0);
		await expect(
			transport.json(
				new URL("https://store.example.com/redirect"),
				"store.example.com",
			),
		).rejects.toThrow("upstream");
		expect(requests).toBe(1);
	});

	it("does not cache a failed DNS validation", async () => {
		let resolves = 0;
		const transport = new CustomerAccountTransport({
			resolver: async () => [
				{
					address: ++resolves === 1 ? "127.0.0.1" : "8.8.8.8",
					family: 4,
					ttlSeconds: 60,
				},
			],
			requester: async () => raw({ ok: true }),
		});
		const url = new URL("https://store.example.com/path");
		await expect(transport.json(url, "store.example.com")).rejects.toThrow(
			"Unsafe",
		);
		expect(await transport.json(url, "store.example.com")).toEqual({
			ok: true,
		});
		expect(resolves).toBe(2);
	});

	it("coalesces same-host DNS work without serializing different hosts", async () => {
		const releases = new Map<string, () => void>();
		const calls: string[] = [];
		const transport = new CustomerAccountTransport({
			resolver: (hostname) =>
				new Promise((resolve) => {
					calls.push(hostname);
					releases.set(hostname, () =>
						resolve([{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }]),
					);
				}),
			requester: async () => raw({ ok: true }),
		});
		const same = Array.from({ length: 8 }, () =>
			transport.json(new URL("https://one.example.com/x"), "one.example.com"),
		);
		const other = transport.json(
			new URL("https://two.example.com/x"),
			"two.example.com",
		);
		await Promise.resolve();
		expect(calls.sort()).toEqual(["one.example.com", "two.example.com"]);
		releases.get("one.example.com")?.();
		releases.get("two.example.com")?.();
		await Promise.all([...same, other]);
		expect(transport.metrics().coalesced).toBe(7);
	});

	it("enforces the response limit while streaming", async () => {
		const transport = new CustomerAccountTransport({
			resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
			requester: async () => ({
				status: 200,
				body: (async function* () {
					yield new Uint8Array(513 * 1_024);
				})(),
			}),
		});
		await expect(
			transport.json(
				new URL("https://store.example.com/large"),
				"store.example.com",
			),
		).rejects.toThrow("too large");
	});
});

describe("BoundedAsyncCache", () => {
	it("uses LRU bounds and does not serve stale values after loader errors", async () => {
		const cache = new BoundedAsyncCache<string, string>({
			maxEntries: 2,
			maxEntryBytes: 10,
			maxTotalBytes: 10,
		});
		cache.set("a", "a", 60_000, 4);
		cache.set("b", "b", 60_000, 4);
		expect(cache.get("a")).toBe("a");
		cache.set("c", "c", 60_000, 4);
		expect(cache.get("b")).toBeUndefined();
		await expect(
			cache.getOrLoad(
				"a",
				async () => {
					throw new Error("upstream failed");
				},
				true,
			),
		).rejects.toThrow("upstream failed");
		expect(cache.get("a")).toBeUndefined();
		expect(cache.metrics()).toMatchObject({
			evictions: 1,
			errors: 1,
			entries: 1,
		});
	});

	it("stays within entry and retained-byte bounds under churn", () => {
		const cache = new BoundedAsyncCache<number, string>({
			maxEntries: 3,
			maxEntryBytes: 6,
			maxTotalBytes: 12,
		});
		for (let key = 0; key < 100; key++) cache.set(key, `${key}`, 60_000, 4);
		expect(cache.metrics()).toMatchObject({
			entries: 3,
			retainedBytes: 12,
			evictions: 97,
		});
		expect(() => cache.set(101, "oversized", 60_000, 7)).toThrow("bounds");
	});
});
