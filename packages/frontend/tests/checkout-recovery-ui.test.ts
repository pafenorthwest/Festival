import { afterEach, describe, expect, it } from "bun:test";
import {
	ApiError,
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
import {
	CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE,
	CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE,
	isClassCheckoutRecoveryUnsupported,
	resolveErrorMessage,
	shouldHideResumeAction,
} from "../src/pages/CustomerCheckoutRecoveryPage.js";

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

describe("customer checkout recovery error handling and unsupported class recovery", () => {
	it("resolveErrorMessage returns restart guidance for class_checkout_recovery_unsupported code or message", () => {
		const apiErrWithCode = new ApiError(
			"Conflict",
			409,
			CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE,
		);
		expect(resolveErrorMessage(apiErrWithCode)).toBe(
			CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE,
		);

		expect(
			resolveErrorMessage({
				code: "class_checkout_recovery_unsupported",
			}),
		).toBe(CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE);

		expect(
			resolveErrorMessage(new Error("class_checkout_recovery_unsupported")),
		).toBe(CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE);

		expect(
			resolveErrorMessage(
				new Error("Failed: class_checkout_recovery_unsupported error occurred"),
			),
		).toBe(CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE);

		expect(
			isClassCheckoutRecoveryUnsupported(
				CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE,
			),
		).toBe(true);
		expect(isClassCheckoutRecoveryUnsupported(apiErrWithCode)).toBe(true);
	});

	it("general 409 with arbitrary message does NOT return link already used message, but passes message through", () => {
		const arbitrary409 = new ApiError(
			"Membership division is unavailable.",
			409,
		);
		expect(resolveErrorMessage(arbitrary409)).toBe(
			"Membership division is unavailable.",
		);

		expect(
			resolveErrorMessage({
				status: 409,
				message: "Some arbitrary conflict message",
			}),
		).toBe("Some arbitrary conflict message");

		const consumedMsgErr = new ApiError(
			"Recovery request has already been used.",
			409,
		);
		expect(resolveErrorMessage(consumedMsgErr)).toBe(
			"This recovery link has already been used to resume checkout.",
		);

		const consumedCodeErr = new ApiError("Request consumed", 409, "consumed");
		expect(resolveErrorMessage(consumedCodeErr)).toBe(
			"This recovery link has already been used to resume checkout.",
		);
	});

	it("hides Resume Purchase action when error is class_checkout_recovery_unsupported for both loadError and resumeError", async () => {
		expect(shouldHideResumeAction(null, null)).toBe(false);

		// loadError triggers hiding
		const loadErr = resolveErrorMessage(
			new ApiError(
				"Unsupported",
				409,
				CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE,
			),
		);
		expect(shouldHideResumeAction(loadErr, null)).toBe(true);

		// resumeError triggers hiding
		const resumeErr = resolveErrorMessage(
			new Error("class_checkout_recovery_unsupported"),
		);
		expect(shouldHideResumeAction(null, resumeErr)).toBe(true);

		// general non-class error does NOT hide action
		const otherErr = resolveErrorMessage(
			new ApiError("Membership division unavailable", 409),
		);
		expect(shouldHideResumeAction(null, otherErr)).toBe(false);
		expect(shouldHideResumeAction(otherErr, null)).toBe(false);

		// verify CustomerCheckoutRecoveryPage source wiring
		const customerPage = await read(
			"../src/pages/CustomerCheckoutRecoveryPage.tsx",
		);
		expect(customerPage).toContain("isClassRecoveryUnsupported");
		expect(customerPage).toMatch(
			/<Show[\s\S]*?when=\{!isClassRecoveryUnsupported\(\)\}>[\s\S]*?<div class="recovery-actions">/,
		);
		expect(customerPage).toContain(
			"CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_MESSAGE",
		);
	});

	it("reactively updates action visibility in Solid root for loadError and resumeError transitions", async () => {
		const solidClient = await import("solid-js/dist/solid.js");
		const { createSignal, createRoot } = solidClient;

		createRoot((dispose) => {
			const [loadError, setLoadError] = createSignal<string | null>(null);
			const [resumeError, setResumeError] = createSignal<string | null>(null);
			const isResumeActionVisible = () =>
				!shouldHideResumeAction(loadError(), resumeError());

			expect(isResumeActionVisible()).toBe(true);

			// loadError with class_checkout_recovery_unsupported hides action
			setLoadError(
				resolveErrorMessage(
					new ApiError("err", 409, CLASS_CHECKOUT_RECOVERY_UNSUPPORTED_CODE),
				),
			);
			expect(isResumeActionVisible()).toBe(false);

			// clearing loadError restores action
			setLoadError(null);
			expect(isResumeActionVisible()).toBe(true);

			// resumeError with class_checkout_recovery_unsupported hides action
			setResumeError(
				resolveErrorMessage(new Error("class_checkout_recovery_unsupported")),
			);
			expect(isResumeActionVisible()).toBe(false);

			// arbitrary error keeps action visible
			setResumeError(
				resolveErrorMessage(new ApiError("Generic network error", 500)),
			);
			expect(isResumeActionVisible()).toBe(true);

			dispose();
		});
	});
});
