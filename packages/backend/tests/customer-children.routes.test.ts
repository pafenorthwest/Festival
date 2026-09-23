import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import {
	buildCustomerChildrenRoutes,
	type CustomerChildrenRoutesOptions,
} from "../src/routes/customer/customer-children.routes.js";

type Spy = Record<string, unknown>;
type Headers = Record<string, string>;

const AUTH = { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess_1` };
const JSON_HDR = { "Content-Type": "application/json" };
const ERR_503 = { error: "Customer Account is unavailable." };
const ERR_400 = {
	error: "Bearer authorization is not accepted on customer routes.",
};

const DUMMY_CHILD = {
	id: "child_1",
	displayName: "Alice",
	ageSnapshots: [],
	hasCurrentValidAgeSnapshot: false,
};
const DUMMY_SNAPSHOT = {
	id: "snap_1",
	childId: "child_1",
	age: 8,
	validUntilIso: "2026-12-31T00:00:00.000Z",
};

function createFakeCustomerAccountService() {
	const calls = {
		listChildren: [] as Spy[],
		createChild: [] as Spy[],
		refreshChildAgeSnapshot: [] as Spy[],
	};
	const chk = (s?: string, c?: string) => {
		if (!s) throw new AppError("Customer session is invalid.", 401);
		if (c !== undefined && c !== "valid-csrf")
			throw new AppError("CSRF validation failed.", 403);
	};
	const service = {
		listChildren: async (slug: string, sessionId?: string) => {
			calls.listChildren.push({ slug, sessionId });
			chk(sessionId);
			return { children: [DUMMY_CHILD] };
		},
		createChild: async (
			slug: string,
			sessionId?: string,
			csrf?: string,
			origin?: string,
			input?: unknown,
		) => {
			chk(sessionId, csrf ?? "");
			calls.createChild.push({
				slug,
				sessionId,
				csrf,
				origin,
				input,
			});
			return { child: DUMMY_CHILD, ageSnapshot: DUMMY_SNAPSHOT };
		},
		refreshChildAgeSnapshot: async (
			slug: string,
			sessionId?: string,
			csrf?: string,
			origin?: string,
			childId?: string,
			input?: unknown,
		) => {
			chk(sessionId, csrf ?? "");
			calls.refreshChildAgeSnapshot.push({
				slug,
				sessionId,
				csrf,
				origin,
				childId,
				input,
			});
			return { ageSnapshot: DUMMY_SNAPSHOT };
		},
	} as unknown as CustomerAccountService;
	return { service, calls };
}

function createTestApp(options: CustomerChildrenRoutesOptions = {}) {
	const app = new Hono();
	app.route(
		"/organizations/:slug/customer",
		buildCustomerChildrenRoutes(options),
	);
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
	["GET", "/children"],
	["POST", "/children", "{}", JSON_HDR],
	["POST", "/children/child_1/age-snapshot", "{}", JSON_HDR],
] as const;

describe("buildCustomerChildrenRoutes", () => {
	it("handles GET /children with and without session cookie", async () => {
		const { service, calls } = createFakeCustomerAccountService();
		const app = createTestApp({ customerAccountService: service });
		const res1 = await req(app, "GET", "/children", AUTH);
		expect(res1.status).toBe(200);
		expect(await res1.json()).toEqual({ children: [DUMMY_CHILD] });

		const res2 = await req(app, "GET", "/children");
		expect(res2.status).toBe(401);

		expect(calls.listChildren).toEqual([
			{ slug: "fest", sessionId: "sess_1" },
			{ slug: "fest", sessionId: undefined },
		]);
	});

	it("handles POST /children with 201 status, headers and body", async () => {
		const { service, calls } = createFakeCustomerAccountService();
		const app = createTestApp({ customerAccountService: service });
		const headers = {
			...AUTH,
			...JSON_HDR,
			"X-CSRF-Token": "valid-csrf",
			Origin: "https://example.com",
		};
		const payload = { displayName: "Alice", birthday: "2018-05-15" };
		const res = await req(
			app,
			"POST",
			"/children",
			headers,
			JSON.stringify(payload),
		);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({
			child: DUMMY_CHILD,
			ageSnapshot: DUMMY_SNAPSHOT,
		});
		expect(calls.createChild[0]).toEqual({
			slug: "fest",
			sessionId: "sess_1",
			csrf: "valid-csrf",
			origin: "https://example.com",
			input: payload,
		});
	});

	it("handles POST /children/:childId/age-snapshot with parameters and headers", async () => {
		const { service, calls } = createFakeCustomerAccountService();
		const app = createTestApp({ customerAccountService: service });
		const headers = {
			...AUTH,
			...JSON_HDR,
			"X-CSRF-Token": "valid-csrf",
			Origin: "https://example.com",
		};
		const payload = { birthday: "2018-05-15" };
		const res = await req(
			app,
			"POST",
			"/children/child_1/age-snapshot",
			headers,
			JSON.stringify(payload),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ageSnapshot: DUMMY_SNAPSHOT });
		expect(calls.refreshChildAgeSnapshot[0]).toEqual({
			slug: "fest",
			sessionId: "sess_1",
			csrf: "valid-csrf",
			origin: "https://example.com",
			childId: "child_1",
			input: payload,
		});
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
			const res = await req(
				app,
				m,
				p,
				{ ...h, Authorization: "Bearer token" },
				b,
			);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual(ERR_400);
		}
	});
});
