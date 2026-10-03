import { afterEach, describe, expect, it } from "bun:test";
import {
	customerCheckoutRecoverySignInPath,
	getAdminCustomerCheckoutIntents,
	getCustomerCheckoutRecoveryReview,
	invalidateAdminCheckoutIntent,
	recoverAdminCheckoutIntent,
	resumeCustomerCheckoutRecovery,
	searchAdminCustomers,
} from "../src/lib/api.js";
import {
	buildOrgAdminCheckoutRecoveryPath,
	buildOrgCheckoutRecoveryPath,
	isOrganizationPageRoute,
	parseRoute,
} from "../src/lib/routes.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("checkout recovery route helpers", () => {
	it("parses admin and customer checkout recovery routes", () => {
		expect(parseRoute("/org/pafe/admin/checkout-recovery")).toEqual({
			kind: "org-admin-checkout-recovery",
			slug: "pafe",
		});
		expect(parseRoute("/org/pafe/admin/checkout-recovery/")).toEqual({
			kind: "org-admin-checkout-recovery",
			slug: "pafe",
		});
		expect(parseRoute("/org/pafe/checkout-recovery/token-xyz")).toEqual({
			kind: "org-checkout-recovery",
			slug: "pafe",
			token: "token-xyz",
		});
		expect(parseRoute("/org/pafe/checkout-recovery/token-xyz/")).toEqual({
			kind: "org-checkout-recovery",
			slug: "pafe",
			token: "token-xyz",
		});
	});

	it("builds canonical paths for admin and customer recovery", () => {
		expect(buildOrgAdminCheckoutRecoveryPath("pafe")).toBe(
			"/org/pafe/admin/checkout-recovery",
		);
		expect(buildOrgCheckoutRecoveryPath("pafe", "token-xyz")).toBe(
			"/org/pafe/checkout-recovery/token-xyz",
		);
	});

	it("identifies customer recovery as organization page route", () => {
		expect(
			isOrganizationPageRoute({
				kind: "org-checkout-recovery",
				slug: "pafe",
				token: "token-xyz",
			}),
		).toBe(true);
		expect(
			isOrganizationPageRoute({
				kind: "org-admin-checkout-recovery",
				slug: "pafe",
			}),
		).toBe(false);
	});
});

describe("checkout recovery API client", () => {
	it("calls searchAdminCustomers with query and auth token", async () => {
		const calls: { url: string; method: string; auth?: string | null }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: typeof input === "string" ? input : input.toString(),
				method: init?.method ?? "GET",
				auth: new Headers(init?.headers).get("Authorization"),
			});
			return new Response(JSON.stringify({ customers: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await searchAdminCustomers("pafe", "alice@example.com", "id-tok-1");
		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/admin/customers?query=alice%40example.com",
		);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].auth).toBe("Bearer id-tok-1");
	});

	it("calls getAdminCustomerCheckoutIntents with customerId and token", async () => {
		const calls: { url: string; method: string; auth?: string | null }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: typeof input === "string" ? input : input.toString(),
				method: init?.method ?? "GET",
				auth: new Headers(init?.headers).get("Authorization"),
			});
			return new Response(JSON.stringify({ intents: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await getAdminCustomerCheckoutIntents("pafe", "cust-42", "id-tok-2");
		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/admin/customers/cust-42/checkout-intents",
		);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].auth).toBe("Bearer id-tok-2");
	});

	it("calls invalidateAdminCheckoutIntent with CSRF header and optional reason", async () => {
		const calls: {
			url: string;
			method: string;
			csrf?: string | null;
			body?: unknown;
		}[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: typeof input === "string" ? input : input.toString(),
				method: init?.method ?? "GET",
				csrf: new Headers(init?.headers).get("X-CSRF-Token"),
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return new Response(
				JSON.stringify({ success: true, intentId: "intent-1" }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		await invalidateAdminCheckoutIntent(
			"pafe",
			"intent-1",
			"id-tok-3",
			"Customer requested cancel",
		);
		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/admin/checkout-intents/intent-1/invalidate",
		);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].csrf).toBe("id-tok-3");
		expect(calls[0].body).toEqual({ reason: "Customer requested cancel" });
	});

	it("calls recoverAdminCheckoutIntent with intentId and CSRF", async () => {
		const calls: { url: string; method: string; csrf?: string | null }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: typeof input === "string" ? input : input.toString(),
				method: init?.method ?? "GET",
				csrf: new Headers(init?.headers).get("X-CSRF-Token"),
			});
			return new Response(
				JSON.stringify({
					recoveryUrl: "/org/pafe/checkout-recovery/raw-token",
					rawToken: "raw-token",
					tokenHash: "hash-123",
					recoveryRequest: { id: "req-1" },
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		const result = await recoverAdminCheckoutIntent(
			"pafe",
			"intent-1",
			"id-tok-4",
		);
		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/admin/checkout-intents/intent-1/recover",
		);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].csrf).toBe("id-tok-4");
		expect(result.rawToken).toBe("raw-token");
	});

	it("calls getCustomerCheckoutRecoveryReview with token", async () => {
		const calls: { url: string; method: string }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: typeof input === "string" ? input : input.toString(),
				method: init?.method ?? "GET",
			});
			return new Response(
				JSON.stringify({
					recoveryRequest: {
						id: "req-1",
						status: "pending",
						expiresAtIso: "2030-01-01T00:00:00.000Z",
						createdAtIso: "2026-09-27T00:00:00.000Z",
					},
					sourceIntent: { id: "intent-1" },
					offering: null,
					division: null,
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		const review = await getCustomerCheckoutRecoveryReview("pafe", "tok-abc");
		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/customer/checkout-recovery/tok-abc",
		);
		expect(calls[0].method).toBe("GET");
		expect(review.recoveryRequest.id).toBe("req-1");
	});

	it("calls resumeCustomerCheckoutRecovery with token and CSRF header", async () => {
		const calls: { url: string; method: string; csrf?: string | null }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: typeof input === "string" ? input : input.toString(),
				method: init?.method ?? "GET",
				csrf: new Headers(init?.headers).get("X-CSRF-Token"),
			});
			return new Response(
				JSON.stringify({ checkoutUrl: "https://checkout.example.com/c/123" }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		const res = await resumeCustomerCheckoutRecovery(
			"pafe",
			"tok-abc",
			"csrf-tok-9",
		);
		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe(
			"/api/organizations/pafe/customer/checkout-recovery/tok-abc/checkout",
		);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].csrf).toBe("csrf-tok-9");
		expect(res.checkoutUrl).toBe("https://checkout.example.com/c/123");
	});

	it("builds customer recovery sign-in path with returnTo", () => {
		const path = customerCheckoutRecoverySignInPath("pafe", "tok-abc");
		expect(path).toBe(
			"/api/organizations/pafe/customer-auth/start?returnTo=%2Forg%2Fpafe%2Fcheckout-recovery%2Ftok-abc",
		);
	});
});

describe("checkout recovery UI components wiring", () => {
	it("wires Checkout Recovery card in AdminHomePage", async () => {
		const homePage = await read("../src/pages/AdminHomePage.tsx");
		expect(homePage).toContain("buildOrgAdminCheckoutRecoveryPath");
		expect(homePage).toContain("Checkout Recovery");
		expect(homePage).toContain(
			"buildOrgAdminCheckoutRecoveryPath(props.app.slug)",
		);
	});

	it("implements AdminCheckoutRecoveryPage with customer search and intent actions", async () => {
		const adminPage = await read("../src/pages/AdminCheckoutRecoveryPage.tsx");
		expect(adminPage).toContain("searchAdminCustomers");
		expect(adminPage).toContain("getAdminCustomerCheckoutIntents");
		expect(adminPage).toContain("invalidateAdminCheckoutIntent");
		expect(adminPage).toContain("recoverAdminCheckoutIntent");
		expect(adminPage).toContain("Date");
		expect(adminPage).toContain("Type / Offering");
		expect(adminPage).toContain("Division");
		expect(adminPage).toContain("Amount");
		expect(adminPage).toContain("Status");
		expect(adminPage).toContain("Diagnostic State");
		expect(adminPage).toContain("Invalidate");
		expect(adminPage).toContain("Attempt Recovery");
		expect(adminPage).toContain("navigator.clipboard.writeText");

		const lineCount = adminPage.split("\n").length;
		expect(lineCount).toBeLessThan(400);
	});

	it("implements CustomerCheckoutRecoveryPage gated on customerSession with resume and clean error states", async () => {
		const customerPage = await read(
			"../src/pages/CustomerCheckoutRecoveryPage.tsx",
		);
		expect(customerPage).toContain("props.app.customerSession()");
		expect(customerPage).toContain("customerCheckoutRecoverySignInPath");
		expect(customerPage).toContain("getCustomerCheckoutRecoveryReview");
		expect(customerPage).toContain("resumeCustomerCheckoutRecovery");
		expect(customerPage).toContain("Earlier Interrupted Checkout");
		expect(customerPage).toContain("Purchase Summary");
		expect(customerPage).toContain("Resume Purchase");
		expect(customerPage).toContain("expired");
		expect(customerPage).toContain("consumed");

		const lineCount = customerPage.split("\n").length;
		expect(lineCount).toBeLessThan(350);
	});

	it("mounts recovery pages in App.tsx", async () => {
		const app = await read("../src/App.tsx");
		expect(app).toContain("<AdminCheckoutRecoveryPage");
		expect(app).toContain('app.route().kind === "org-admin-checkout-recovery"');
		expect(app).toContain("<CustomerCheckoutRecoveryPage");
		expect(app).toContain('app.route().kind === "org-checkout-recovery"');
	});
});
