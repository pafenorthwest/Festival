import { afterEach, describe, expect, it } from "bun:test";
import {
	listAdminClassCheckoutRecoveries,
	resolveAdminClassCheckoutRecovery,
	sweepAdminClassCheckoutRecoveries,
} from "../src/lib/api/class-checkout-recovery.js";
import { ApiError } from "../src/lib/api/client.js";

interface Call {
	url: URL;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

let calls: Call[] = [];
const originalFetch = globalThis.fetch;

function mockFetch(body: unknown, status = 200) {
	calls = [];
	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
		const raw =
			typeof url === "string"
				? url
				: url instanceof URL
					? url.toString()
					: url.url;
		calls.push({
			url: new URL(raw, "http://localhost"),
			method: init?.method ?? "GET",
			headers: (init?.headers ?? {}) as Record<string, string>,
			body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
		});
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}) as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	calls = [];
});

describe("class checkout recovery API", () => {
	it("lists recoveries with a plain read request", async () => {
		mockFetch({ recoveries: [] });
		const result = await listAdminClassCheckoutRecoveries("pafe", {
			idToken: "tok",
		});
		expect(result).toEqual({ recoveries: [] });
		const [call] = calls;
		expect(call.method).toBe("GET");
		expect(call.url.pathname).toBe(
			"/api/organizations/pafe/admin/class-checkout-recoveries",
		);
		expect(call.url.searchParams.has("customerId")).toBe(false);
		expect(call.headers.Authorization).toBe("Bearer tok");
		expect(call.headers["X-CSRF-Token"]).toBeUndefined();
	});

	it("filters by customer when one is given", async () => {
		mockFetch({ recoveries: [] });
		await listAdminClassCheckoutRecoveries("pafe", {
			customerId: "cust 1",
			idToken: "tok",
		});
		expect(calls[0].url.searchParams.get("customerId")).toBe("cust 1");
	});

	it("sweeps with the operator CSRF header", async () => {
		mockFetch({ recoveredCount: 3 });
		const result = await sweepAdminClassCheckoutRecoveries("pafe", "tok");
		expect(result.recoveredCount).toBe(3);
		const [call] = calls;
		expect(call.method).toBe("POST");
		expect(call.url.pathname).toBe(
			"/api/organizations/pafe/admin/class-checkout-recoveries/reap",
		);
		expect(call.headers["X-CSRF-Token"]).toBeTruthy();
		expect(call.headers.Authorization).toBe("Bearer tok");
	});

	it("resolves one recovery with the operator's decision in the body", async () => {
		mockFetch({
			recovery: {
				status: "resolved",
				recoveryReference: "ref/1",
				reasonCode: "checkout_abandoned",
				retryAllowed: false,
				generation: 5,
				intentId: "i1",
				customerId: "c1",
			},
		});
		const input = {
			expectedGeneration: 4,
			reason: "Parent confirmed no payment.",
			action: "abandon_unknown" as const,
			acknowledgeUnknown: true,
		};
		const result = await resolveAdminClassCheckoutRecovery(
			"pafe",
			"ref/1",
			input,
			"tok",
		);
		expect(result.recovery.status).toBe("resolved");
		const [call] = calls;
		expect(call.method).toBe("POST");
		expect(call.url.pathname).toBe(
			"/api/organizations/pafe/admin/class-checkout-recoveries/ref%2F1/resolve",
		);
		expect(call.body).toEqual(input);
		expect(call.headers["X-CSRF-Token"]).toBeTruthy();
	});

	it("turns an error response into an ApiError that keeps the code", async () => {
		mockFetch(
			{
				error: "Checkout recovery state changed concurrently.",
				code: "checkout_recovery_conflict",
			},
			409,
		);
		const attempt = resolveAdminClassCheckoutRecovery(
			"pafe",
			"ref-1",
			{ expectedGeneration: 1, reason: "x", action: "abandon_unknown" },
			"tok",
		);
		await expect(attempt).rejects.toBeInstanceOf(ApiError);
		await attempt.catch((error: ApiError) => {
			expect(error.status).toBe(409);
			expect(error.code).toBe("checkout_recovery_conflict");
		});
	});
});
