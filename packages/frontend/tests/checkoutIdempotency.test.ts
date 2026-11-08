import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	clearCartCheckoutIdempotencyKey,
	createPayloadCachedIdempotency,
	getOrCreateCartCheckoutIdempotencyKey,
} from "../src/pages/checkoutIdempotency.js";

function createMockSessionStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, String(value));
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	};
}

describe("persistent cart checkout idempotency (sessionStorage)", () => {
	let mockStorage: Storage;
	const originalSessionStorage = globalThis.sessionStorage;

	beforeEach(() => {
		mockStorage = createMockSessionStorage();
		// @ts-expect-error test mock
		globalThis.sessionStorage = mockStorage;
	});

	afterEach(() => {
		// @ts-expect-error restore
		globalThis.sessionStorage = originalSessionStorage;
	});

	it("persists entry in sessionStorage under festival-cart-checkout:slug:festivalSlug", () => {
		const lineItems = [{ classId: "class-1", childId: "child-1" }];
		const key = getOrCreateCartCheckoutIdempotencyKey(
			"org-a",
			"fest-1",
			lineItems,
		);
		expect(key).toBeDefined();
		expect(typeof key).toBe("string");

		const storageKey = "festival-cart-checkout:org-a:fest-1";
		const raw = mockStorage.getItem(storageKey);
		expect(raw).not.toBeNull();

		const parsed = JSON.parse(raw ?? "{}");
		expect(parsed.idempotencyKey).toBe(key);
		expect(typeof parsed.payloadHash).toBe("string");
		expect(typeof parsed.timestamp).toBe("number");
		expect(Date.now() - parsed.timestamp).toBeLessThan(1000);
	});

	it("reuses existing idempotency key across simulated remounts with identical payload", () => {
		const lineItems = [{ classId: "c1", pieces: [{ title: "Sonata" }] }];
		// Initial mount / attempt
		const keyFirstMount = getOrCreateCartCheckoutIdempotencyKey(
			"org-a",
			"fest-1",
			lineItems,
		);

		// Component unmounts, new component mounts and calls helper
		const keyRemount = getOrCreateCartCheckoutIdempotencyKey(
			"org-a",
			"fest-1",
			lineItems,
		);
		expect(keyRemount).toBe(keyFirstMount);
	});

	it("generates a new key when lineItems payload changes", () => {
		const lineItems1 = [{ classId: "c1" }];
		const lineItems2 = [{ classId: "c2" }];

		const key1 = getOrCreateCartCheckoutIdempotencyKey(
			"org-a",
			"fest-1",
			lineItems1,
		);
		const key2 = getOrCreateCartCheckoutIdempotencyKey(
			"org-a",
			"fest-1",
			lineItems2,
		);
		expect(key2).not.toBe(key1);

		const storedItem = mockStorage.getItem(
			"festival-cart-checkout:org-a:fest-1",
		);
		const parsed = JSON.parse(storedItem ?? "{}");
		expect(parsed.idempotencyKey).toBe(key2);
	});

	it("reuses key within 30 minutes (1,800,000 ms) and generates fresh key after expiration", () => {
		const lineItems = [{ classId: "c1" }];
		const key1 = getOrCreateCartCheckoutIdempotencyKey(
			"org-a",
			"fest-1",
			lineItems,
		);

		// Advance timestamp within TTL (29 minutes ago)
		const storageKey = "festival-cart-checkout:org-a:fest-1";
		const parsed = JSON.parse(mockStorage.getItem(storageKey) ?? "{}");
		parsed.timestamp = Date.now() - 29 * 60 * 1000;
		mockStorage.setItem(storageKey, JSON.stringify(parsed));

		const keyWithinTTL = getOrCreateCartCheckoutIdempotencyKey(
			"org-a",
			"fest-1",
			lineItems,
		);
		expect(keyWithinTTL).toBe(key1);

		// Advance timestamp past 30-min TTL (31 minutes ago)
		parsed.timestamp = Date.now() - 31 * 60 * 1000;
		mockStorage.setItem(storageKey, JSON.stringify(parsed));

		const keyExpired = getOrCreateCartCheckoutIdempotencyKey(
			"org-a",
			"fest-1",
			lineItems,
		);
		expect(keyExpired).not.toBe(key1);
	});

	it("clears idempotency key on clearCartCheckoutIdempotencyKey", () => {
		const lineItems = [{ classId: "c1" }];
		const storageKey = "festival-cart-checkout:org-a:fest-1";
		getOrCreateCartCheckoutIdempotencyKey("org-a", "fest-1", lineItems);
		expect(mockStorage.getItem(storageKey)).not.toBeNull();

		clearCartCheckoutIdempotencyKey("org-a", "fest-1");
		expect(mockStorage.getItem(storageKey)).toBeNull();
	});

	it("gracefully falls back to memory cache when sessionStorage is unavailable or throws", () => {
		// @ts-expect-error test unavailable
		globalThis.sessionStorage = undefined;

		const lineItems = [{ classId: "c1" }];
		const key1 = getOrCreateCartCheckoutIdempotencyKey(
			"org-fallback",
			"fest-fallback",
			lineItems,
		);
		expect(key1).toBeDefined();

		const key2 = getOrCreateCartCheckoutIdempotencyKey(
			"org-fallback",
			"fest-fallback",
			lineItems,
		);
		expect(key2).toBe(key1);

		clearCartCheckoutIdempotencyKey("org-fallback", "fest-fallback");
		const key3 = getOrCreateCartCheckoutIdempotencyKey(
			"org-fallback",
			"fest-fallback",
			lineItems,
		);
		expect(key3).not.toBe(key1);
	});

	it("gracefully handles sessionStorage when setItem throws (quota/security error)", () => {
		mockStorage.setItem = () => {
			throw new Error("QuotaExceededError");
		};

		const lineItems = [{ classId: "c1" }];
		const key1 = getOrCreateCartCheckoutIdempotencyKey(
			"org-err",
			"fest-err",
			lineItems,
		);
		expect(key1).toBeDefined();
		expect(typeof key1).toBe("string");
	});
});

describe("checkoutIdempotency helper (in-memory manager legacy)", () => {
	it("generates a fresh UUID on first call", () => {
		const manager = createPayloadCachedIdempotency();
		const key = manager.getOrGenerateKey([{ classId: "c1" }]);
		expect(key).toBeDefined();
		expect(typeof key).toBe("string");
		expect(key.length).toBeGreaterThan(10);
	});

	it("reuses idempotency key for identical payload retries within 30 min", () => {
		const manager = createPayloadCachedIdempotency();
		const payload = [{ classId: "c1", childId: "k1" }];
		const key1 = manager.getOrGenerateKey(payload);
		const key2 = manager.getOrGenerateKey(payload);
		expect(key2).toBe(key1);
	});

	it("generates fresh UUID when payload changes", () => {
		const manager = createPayloadCachedIdempotency();
		const key1 = manager.getOrGenerateKey([{ classId: "c1" }]);
		const key2 = manager.getOrGenerateKey([{ classId: "c2" }]);
		expect(key2).not.toBe(key1);
	});

	it("generates fresh UUID after TTL expiration", () => {
		const manager = createPayloadCachedIdempotency(10); // 10ms TTL
		const payload = [{ classId: "c1" }];
		const key1 = manager.getOrGenerateKey(payload);
		// simulate time passing
		const entry = manager.peek();
		if (entry) {
			entry.timestamp = Date.now() - 20;
		}
		const key2 = manager.getOrGenerateKey(payload);
		expect(key2).not.toBe(key1);
	});

	it("clears cached key when clear() is called", () => {
		const manager = createPayloadCachedIdempotency();
		const payload = [{ classId: "c1" }];
		const key1 = manager.getOrGenerateKey(payload);
		manager.clear();
		expect(manager.peek()).toBeNull();
		const key2 = manager.getOrGenerateKey(payload);
		expect(key2).not.toBe(key1);
	});
});
