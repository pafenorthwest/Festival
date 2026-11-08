import { describe, expect, it } from "bun:test";
import { createPayloadCachedIdempotency } from "../src/pages/checkoutIdempotency.js";

describe("checkoutIdempotency helper", () => {
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
