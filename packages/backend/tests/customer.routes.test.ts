import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import {
	buildCustomerRoutes,
	type CustomerRoutesOptions,
} from "../src/routes/customer/customer.routes.js";

type Spy = Record<string, unknown>;
type Headers = Record<string, string>;

const OK_PROFILE = { profile: { name: "User", email: "user@example.com" } };
const LOGOUT_URL = "https://accounts.shopify.com/logout";
const AUTH = { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess_1` };
const JSON_HDR = { "Content-Type": "application/json" };
const FORM_HDR = { "Content-Type": "application/x-www-form-urlencoded" };
const ERR_503 = { error: "Customer Account integration is not configured." };
const ERR_400 = {
	error: "Bearer authorization is not accepted on customer routes.",
};

function createFakeCustomerAccountService() {
	const calls = {
		session: [] as Spy[],
		profile: [] as Spy[],
		update: [] as Spy[],
		orders: [] as Spy[],
		logout: [] as Spy[],
	};
	const chk = (s?: string, c?: string) => {
		if (!s) throw new AppError("Customer session is invalid.", 401);
		if (c !== undefined && c !== "valid-csrf")
			throw new AppError("CSRF validation failed.", 403);
	};
	const service = {
		session: async (slug: string, sessionId?: string) => {
			calls.session.push({ slug, sessionId });
			return {
				session: sessionId
					? { authenticated: true, csrfToken: "valid-csrf" }
					: { authenticated: false },
			};
		},
		customerProfile: async (slug: string, s?: string) => {
			chk(s);
			calls.profile.push({ slug, sessionId: s });
			return OK_PROFILE;
		},
		updateCustomerProfile: async (
			slug: string,
			s?: string,
			c?: string,
			o?: string,
			input?: unknown,
		) => {
			chk(s, c ?? "");
			calls.update.push({ slug, sessionId: s, csrf: c, origin: o, input });
			return OK_PROFILE;
		},
		orders: async (slug: string, s?: string, after?: string) => {
			calls.orders.push({ slug, sessionId: s, after });
			chk(s);
			return { orders: [], pageInfo: { hasNextPage: false, endCursor: null } };
		},
		logout: async (slug: string, s?: string, c?: string, o?: string) => {
			chk(s, c ?? "");
			calls.logout.push({ slug, sessionId: s, csrf: c, origin: o });
			return LOGOUT_URL;
		},
	} as unknown as CustomerAccountService;
	return { service, calls };
}

function createTestApp(options: CustomerRoutesOptions = {}) {
	const app = new Hono();
	app.route("/organizations/:slug/customer", buildCustomerRoutes(options));
	return app;
}

function req(app: Hono, m: string, p: string, h?: Headers, b?: string) {
	return app.request(`/organizations/fest/customer${p}`, {
		method: m,
		headers: h,
		body: b,
	});
}

const EP = [
	["GET", "/session"],
	["GET", "/profile"],
	["POST", "/profile", "{}", JSON_HDR],
	["GET", "/orders"],
	["POST", "/logout", "csrfToken=v", FORM_HDR],
] as const;

const EXPECTED_CALL = {
	slug: "fest",
	sessionId: "sess_1",
	csrf: "valid-csrf",
	origin: "https://example.com",
};

describe("buildCustomerRoutes", () => {
	it("handles GET /session with and without session cookie", async () => {
		const { service, calls } = createFakeCustomerAccountService();
		const app = createTestApp({ customerAccountService: service });
		const res1 = await req(app, "GET", "/session", AUTH);
		expect(res1.status).toBe(200);
		expect(await res1.json()).toEqual({
			session: { authenticated: true, csrfToken: "valid-csrf" },
		});
		const res2 = await req(app, "GET", "/session");
		expect(res2.status).toBe(200);
		expect(await res2.json()).toEqual({ session: { authenticated: false } });
		expect(calls.session).toEqual([
			{ slug: "fest", sessionId: "sess_1" },
			{ slug: "fest", sessionId: undefined },
		]);
	});

	it("handles GET /profile with and without session cookie", async () => {
		const { service, calls } = createFakeCustomerAccountService();
		const app = createTestApp({ customerAccountService: service });
		const res = await req(app, "GET", "/profile", AUTH);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(OK_PROFILE);
		expect((await req(app, "GET", "/profile")).status).toBe(401);
		expect(calls.profile).toEqual([{ slug: "fest", sessionId: "sess_1" }]);
	});

	it("handles POST /profile with valid, missing, and invalid CSRF", async () => {
		const { service, calls } = createFakeCustomerAccountService();
		const app = createTestApp({ customerAccountService: service });
		const base = { ...AUTH, Origin: "https://example.com", ...JSON_HDR };
		const ok = await req(
			app,
			"POST",
			"/profile",
			{ ...base, "X-CSRF-Token": "valid-csrf" },
			"{}",
		);
		expect(ok.status).toBe(200);
		expect(calls.update[0]).toEqual({ ...EXPECTED_CALL, input: {} });
		expect((await req(app, "POST", "/profile", base, "{}")).status).toBe(403);
		const bad = { ...base, "X-CSRF-Token": "invalid" };
		expect((await req(app, "POST", "/profile", bad, "{}")).status).toBe(403);
	});

	it("handles GET /orders with, without cookie, and with ?after=", async () => {
		const { service, calls } = createFakeCustomerAccountService();
		const app = createTestApp({ customerAccountService: service });
		expect((await req(app, "GET", "/orders", AUTH)).status).toBe(200);
		expect((await req(app, "GET", "/orders")).status).toBe(401);
		expect((await req(app, "GET", "/orders?after=c_1", AUTH)).status).toBe(200);
		expect(calls.orders).toEqual([
			{ slug: "fest", sessionId: "sess_1", after: undefined },
			{ slug: "fest", sessionId: undefined, after: undefined },
			{ slug: "fest", sessionId: "sess_1", after: "c_1" },
		]);
	});

	it("handles POST /logout with session and CSRF, clearing cookie", async () => {
		const { service, calls } = createFakeCustomerAccountService();
		const app = createTestApp({ customerAccountService: service });
		const hdr = { ...AUTH, Origin: "https://example.com", ...FORM_HDR };
		const res = await req(app, "POST", "/logout", hdr, "csrfToken=valid-csrf");
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(LOGOUT_URL);
		const cookie = res.headers.get("Set-Cookie") ?? "";
		expect(cookie).toContain(`${CUSTOMER_SESSION_COOKIE}=;`);
		expect(cookie).toContain("Path=/api/");
		expect(calls.logout[0]).toEqual(EXPECTED_CALL);
	});

	it("returns 503 across all endpoints when service is unavailable", async () => {
		const app = createTestApp({});
		for (const [m, p, b, h] of EP) {
			const res = await req(app, m, p, h, b);
			expect(res.status).toBe(503);
			expect(await res.json()).toEqual(ERR_503);
		}
	});

	it("returns 400 across all endpoints when Bearer header is provided", async () => {
		const app = createTestApp({
			customerAccountService: createFakeCustomerAccountService().service,
		});
		for (const [m, p, b, h] of EP) {
			const res = await req(app, m, p, { ...h, Authorization: "Bearer b" }, b);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual(ERR_400);
		}
	});
});
