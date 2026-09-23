import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { MembershipCheckoutService } from "../src/checkout/membership-checkout-service.js";
import type { MembershipStatusService } from "../src/commerce/membership-status-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import {
	buildCustomerMembershipRoutes,
	type CustomerMembershipRoutesOptions,
} from "../src/routes/customer/customer-membership.routes.js";
import type { AccompanistMembershipService } from "../src/services/accompanist-membership-service.js";
import type { OrganizationService } from "../src/services/organization-service.js";
import type { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";

type Headers = Record<string, string>;

const AUTH = { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess_1` };
const JSON_HDR = { "Content-Type": "application/json" };
const VALID_UUID = "12345678-1234-4234-8234-1234567890ab";

function createFakeServices() {
	const calls: Record<string, unknown[]> = {
		recordConsent: [],
		startCheckout: [],
		acquireAccompanist: [],
	};

	const customerAccountService = {
		session: async (_slug: string, sessionId?: string) => ({
			session: { authenticated: sessionId === "sess_1" },
		}),
		checkoutAccess: async (
			_slug: string,
			cookie?: string,
			_csrf?: string,
			_origin?: string,
		) => {
			if (!cookie) throw new AppError("Customer session is invalid.", 401);
			return {
				organizationId: "org_1",
				customerId: "cust_1",
				shopifyCustomerAccessToken: "buyer_token",
			};
		},
		recordCheckoutStaffAccessConsent: async (
			organizationId: string,
			customerId: string,
		) => {
			calls.recordConsent.push({ organizationId, customerId });
		},
		customerReadAccess: async (_slug: string, cookie?: string) => {
			if (!cookie) throw new AppError("Customer session is invalid.", 401);
			return { organizationId: "org_1", customerId: "cust_1" };
		},
		formAccess: async (
			_slug: string,
			cookie?: string,
			_csrf?: string,
			_origin?: string,
		) => {
			if (!cookie) throw new AppError("Customer session is invalid.", 401);
			return { organizationId: "org_1", customerId: "cust_1" };
		},
	} as unknown as CustomerAccountService;

	const publicMembershipProductService = {
		resolvePurchasable: async (slug: string, offeringId: string) => ({
			purchasable: true,
			slug,
			offeringId,
		}),
	} as unknown as PublicMembershipProductService;

	const membershipCheckoutService = {
		start: async (input: unknown) => {
			calls.startCheckout.push(input);
			return { checkoutUrl: "https://checkout.test" };
		},
	} as unknown as MembershipCheckoutService;

	const membershipStatusService = {
		listForCustomer: async (organizationId: string, customerId: string) => ({
			memberships: [{ organizationId, customerId }],
		}),
	} as unknown as MembershipStatusService;

	const accompanistMembershipService = {
		acquire: async (input: unknown) => {
			calls.acquireAccompanist.push(input);
			return { acquired: true };
		},
	} as unknown as AccompanistMembershipService;

	const organizationService = {
		getAccompanistDivisionPolicy: async (organizationId: string) => ({
			organizationId,
			allowAll: true,
		}),
		listDivisions: async (organizationId: string, active?: boolean) => [
			{ id: "div_1", organizationId, active },
		],
	} as unknown as OrganizationService;

	return {
		customerAccountService,
		publicMembershipProductService,
		membershipCheckoutService,
		membershipStatusService,
		accompanistMembershipService,
		organizationService,
		calls,
	};
}

function createTestApp(options: CustomerMembershipRoutesOptions = {}) {
	const app = new Hono();
	app.route(
		"/organizations/:slug/customer",
		buildCustomerMembershipRoutes(options),
	);
	return app;
}

function req(
	app: Hono,
	method: string,
	path: string,
	headers?: Headers,
	body?: string,
) {
	return app.request(`/organizations/fest/customer${path}`, {
		method,
		headers,
		body,
	});
}

describe("Customer Membership Routes", () => {
	describe("GET /membership-purchase/:offeringId", () => {
		it("handles valid authenticated session", async () => {
			const services = createFakeServices();
			const app = createTestApp(services);
			const res = await req(app, "GET", "/membership-purchase/off_1", AUTH);
			expect(res.status).toBe(200);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
			expect(await res.json()).toEqual({
				purchasable: true,
				slug: "fest",
				offeringId: "off_1",
			});
		});

		it("returns 401 for unauthenticated session", async () => {
			const services = createFakeServices();
			const app = createTestApp(services);
			const res = await req(app, "GET", "/membership-purchase/off_1");
			expect(res.status).toBe(401);
		});

		it("returns 503 when service is missing", async () => {
			const app = createTestApp({});
			const res = await req(app, "GET", "/membership-purchase/off_1", AUTH);
			expect(res.status).toBe(503);
		});
	});

	describe("POST /checkout", () => {
		const validHeaders = {
			...AUTH,
			...JSON_HDR,
			"Idempotency-Key": VALID_UUID,
			"X-CSRF-Token": "csrf_token",
			Origin: "https://example.com",
		};
		const validPayload = {
			offeringId: "off_1",
			divisionId: "div_1",
			staffAccessConsent: true,
		};

		it("handles valid checkout with idempotency and CSRF", async () => {
			const services = createFakeServices();
			const app = createTestApp(services);
			const res = await req(
				app,
				"POST",
				"/checkout",
				validHeaders,
				JSON.stringify(validPayload),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
			expect(await res.json()).toEqual({
				checkoutUrl: "https://checkout.test",
			});
			expect(services.calls.recordConsent).toEqual([
				{ organizationId: "org_1", customerId: "cust_1" },
			]);
			expect(services.calls.startCheckout[0]).toEqual({
				organizationId: "org_1",
				customerId: "cust_1",
				shopifyCustomerAccessToken: "buyer_token",
				buyerAccessToken: "buyer_token",
				idempotencyKey: VALID_UUID,
				offeringId: "off_1",
				divisionId: "div_1",
				staffAccessConsent: true,
			});
		});

		it("returns 400 for invalid idempotency key", async () => {
			const services = createFakeServices();
			const app = createTestApp(services);
			const res = await req(
				app,
				"POST",
				"/checkout",
				{ ...validHeaders, "Idempotency-Key": "invalid-uuid" },
				JSON.stringify(validPayload),
			);
			expect(res.status).toBe(400);
		});

		it("returns 400 for missing staff access consent", async () => {
			const services = createFakeServices();
			const app = createTestApp(services);
			const res = await req(
				app,
				"POST",
				"/checkout",
				validHeaders,
				JSON.stringify({ ...validPayload, staffAccessConsent: false }),
			);
			expect(res.status).toBe(400);
		});

		it("returns 503 when service is missing", async () => {
			const app = createTestApp({});
			const res = await req(
				app,
				"POST",
				"/checkout",
				validHeaders,
				JSON.stringify(validPayload),
			);
			expect(res.status).toBe(503);
		});
	});

	describe("GET /membership-status", () => {
		it("handles valid session", async () => {
			const services = createFakeServices();
			const app = createTestApp(services);
			const res = await req(app, "GET", "/membership-status", AUTH);
			expect(res.status).toBe(200);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
			expect(await res.json()).toEqual({
				memberships: [{ organizationId: "org_1", customerId: "cust_1" }],
			});
		});

		it("returns 503 when service is missing", async () => {
			const app = createTestApp({});
			const res = await req(app, "GET", "/membership-status", AUTH);
			expect(res.status).toBe(503);
		});
	});

	describe("GET /accompanist-membership", () => {
		it("handles valid session and returns policy and divisions", async () => {
			const services = createFakeServices();
			const app = createTestApp(services);
			const res = await req(app, "GET", "/accompanist-membership", AUTH);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				policy: { organizationId: "org_1", allowAll: true },
				divisions: [{ id: "div_1", organizationId: "org_1", active: true }],
			});
		});

		it("returns 503 when service is missing", async () => {
			const app = createTestApp({});
			const res = await req(app, "GET", "/accompanist-membership", AUTH);
			expect(res.status).toBe(503);
		});
	});

	describe("POST /accompanist-membership", () => {
		const validHeaders = {
			...AUTH,
			...JSON_HDR,
			"X-CSRF-Token": "csrf_token",
			Origin: "https://example.com",
		};
		const payload = { divisionIds: ["div_1"] };

		it("handles valid session and CSRF to acquire", async () => {
			const services = createFakeServices();
			const app = createTestApp(services);
			const res = await req(
				app,
				"POST",
				"/accompanist-membership",
				validHeaders,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get("Cache-Control")).toBe("no-store");
			expect(await res.json()).toEqual({ acquired: true });
			expect(services.calls.acquireAccompanist[0]).toEqual({
				organizationId: "org_1",
				customerId: "cust_1",
				payload,
			});
		});

		it("returns 503 when service is missing", async () => {
			const app = createTestApp({});
			const res = await req(
				app,
				"POST",
				"/accompanist-membership",
				validHeaders,
				JSON.stringify(payload),
			);
			expect(res.status).toBe(503);
		});
	});

	describe("Bearer authorization guard", () => {
		it("returns 400 when Authorization header is provided", async () => {
			const services = createFakeServices();
			const app = createTestApp(services);
			const endpoints = [
				["GET", "/membership-purchase/off_1"],
				["POST", "/checkout"],
				["GET", "/membership-status"],
				["GET", "/accompanist-membership"],
				["POST", "/accompanist-membership"],
			] as const;

			for (const [method, path] of endpoints) {
				const res = await req(app, method, path, {
					Authorization: "Bearer token",
				});
				expect(res.status).toBe(400);
			}
		});
	});
});
