import { afterEach, describe, expect, it } from "bun:test";
import {
	ApiError,
	getPendingClassCheckout,
	resumePendingClassCheckout,
} from "../src/lib/api.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("pending class checkout customer API", () => {
	it("discovers the account checkout with cookie authentication and no old request key", async () => {
		let request: { url: string; init?: RequestInit } | undefined;
		globalThis.fetch = (async (input, init) => {
			request = { url: String(input), init };
			return Response.json({ checkout: null });
		}) as typeof fetch;
		expect(await getPendingClassCheckout("music org")).toEqual({
			checkout: null,
		});
		expect(request?.url).toBe(
			"/api/organizations/music%20org/customer/pending-checkout",
		);
		expect(request?.init?.method).toBe("GET");
		expect(request?.init?.credentials).toBe("include");
		const headers = new Headers(request?.init?.headers);
		expect(headers.get("Authorization")).toBeNull();
		expect(headers.get("X-CSRF-Token")).toBeNull();
		expect(headers.get("Idempotency-Key")).toBeNull();
	});

	it("resumes an opaque reference with current-session CSRF and no original checkout payload", async () => {
		let request: { url: string; init?: RequestInit } | undefined;
		globalThis.fetch = (async (input, init) => {
			request = { url: String(input), init };
			return Response.json({
				checkoutUrl: "https://shop.example/checkout/existing",
			});
		}) as typeof fetch;
		expect(
			await resumePendingClassCheckout(
				"pafe",
				"opaque-reference",
				"new-session-csrf",
			),
		).toEqual({
			checkoutUrl: "https://shop.example/checkout/existing",
		});
		expect(request?.url).toBe(
			"/api/organizations/pafe/customer/pending-checkout/opaque-reference/resume",
		);
		expect(request?.init?.method).toBe("POST");
		expect(request?.init?.credentials).toBe("include");
		expect(JSON.parse(String(request?.init?.body))).toEqual({});
		const headers = new Headers(request?.init?.headers);
		expect(headers.get("X-CSRF-Token")).toBe("new-session-csrf");
		expect(headers.get("Idempotency-Key")).toBeNull();
		expect(headers.get("Authorization")).toBeNull();
	});

	it("surfaces a failed verification instead of returning an empty cart", async () => {
		globalThis.fetch = (async () =>
			Response.json(
				{ error: "Checkout cannot currently be verified." },
				{ status: 503 },
			)) as typeof fetch;
		await expect(getPendingClassCheckout("pafe")).rejects.toBeInstanceOf(
			ApiError,
		);
	});

	it("sends an optional browser submission key only as a header and retains the server match proof", async () => {
		let request: { url: string; init?: RequestInit } | undefined;
		globalThis.fetch = (async (input, init) => {
			request = { url: String(input), init };
			return Response.json({
				checkoutUrl: "https://shop.example/checkout/existing",
				submissionMatched: true,
			});
		}) as typeof fetch;
		expect(
			await resumePendingClassCheckout(
				"pafe",
				"reference",
				"current-csrf",
				"original-browser-key",
			),
		).toEqual({
			checkoutUrl: "https://shop.example/checkout/existing",
			submissionMatched: true,
		});
		expect(new Headers(request?.init?.headers).get("Idempotency-Key")).toBe(
			"original-browser-key",
		);
		expect(new Headers(request?.init?.headers).get("X-CSRF-Token")).toBe(
			"current-csrf",
		);
		expect(JSON.parse(String(request?.init?.body))).toEqual({});
		expect(request?.url).not.toContain("original-browser-key");
	});
});
