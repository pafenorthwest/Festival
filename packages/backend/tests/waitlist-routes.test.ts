import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildAdminWaitlistRoutes } from "../src/routes/admin-registration/admin-waitlist.routes.js";
import { buildCustomerWaitlistRoutes } from "../src/routes/customer/customer-waitlist.routes.js";
import type {
	JoinWaitlistInputParams,
	ListClassWaitlistRosterParams,
	ListParentWaitlistEntriesParams,
	WaitlistService,
	WithdrawWaitlistInputParams,
} from "../src/waitlist/waitlist-service.js";

const AUTH_COOKIE = `${CUSTOMER_SESSION_COOKIE}=sess_123`;
const CSRF_TOKEN = "csrf_token_abc";
const VALID_ORIGIN = "https://festival.test";

describe("buildCustomerWaitlistRoutes", () => {
	function createMockServices() {
		const calls = {
			customerSession: [] as Array<{
				slug: string;
				sessionId?: string;
				csrf?: string;
				origin?: string;
			}>,
			validateSession: [] as Array<{ slug: string; sessionId: string }>,
			joinWaitlist: [] as JoinWaitlistInputParams[],
			withdrawWaitlist: [] as WithdrawWaitlistInputParams[],
			listParentWaitlistEntries: [] as ListParentWaitlistEntriesParams[],
		};

		const customerAccountService = {
			customerSession: async (
				slug: string,
				sessionId?: string,
				csrf?: string,
				origin?: string,
			) => {
				calls.customerSession.push({ slug, sessionId, csrf, origin });
				if (!sessionId) {
					throw new AppError("Customer session is invalid.", 401);
				}
				if (!csrf || csrf !== CSRF_TOKEN || origin !== VALID_ORIGIN) {
					throw new AppError("CSRF validation failed.", 403);
				}
				return {
					organizationId: "org-1",
					customerId: "customer-1",
				};
			},
			validateSession: async (slug: string, sessionId: string) => {
				calls.validateSession.push({ slug, sessionId });
				if (sessionId !== "sess_123") {
					throw new AppError("Customer session is invalid.", 401);
				}
				return {
					organizationId: "org-1",
					customerId: "customer-1",
				};
			},
		};

		const waitlistService = {
			joinWaitlist: async (params: JoinWaitlistInputParams) => {
				calls.joinWaitlist.push(params);
				return {
					entry: {
						id: "entry-1",
						organizationId: params.organizationId,
						festivalId: params.festivalId ?? "fest-2026",
						festivalClassId: params.festivalClassId,
						parentCustomerId: params.parentCustomerId,
						childId: params.childId,
						status: "active",
						joinedAt: "2026-01-01T00:00:00Z",
						parentName: params.parentName,
						parentEmail: params.parentEmail,
						parentPhone: params.parentPhone,
						createdAt: "2026-01-01T00:00:00Z",
						updatedAt: "2026-01-01T00:00:00Z",
					},
					alreadyJoined: false,
				};
			},
			withdrawWaitlist: async (params: WithdrawWaitlistInputParams) => {
				calls.withdrawWaitlist.push(params);
				return {
					entry: {
						id: "entry-1",
						organizationId: params.organizationId,
						festivalId: params.festivalId ?? "fest-2026",
						festivalClassId: params.festivalClassId,
						parentCustomerId: params.parentCustomerId,
						childId: params.childId,
						status: "withdrawn",
						joinedAt: "2026-01-01T00:00:00Z",
						withdrawnAt: "2026-01-02T00:00:00Z",
						createdAt: "2026-01-01T00:00:00Z",
						updatedAt: "2026-01-02T00:00:00Z",
					},
					alreadyWithdrawn: false,
				};
			},
			listParentWaitlistEntries: async (
				params: ListParentWaitlistEntriesParams,
			) => {
				calls.listParentWaitlistEntries.push(params);
				return [
					{
						id: "entry-1",
						organizationId: params.organizationId,
						festivalId: params.festivalId ?? "fest-2026",
						festivalClassId: params.classId ?? "class-1",
						parentCustomerId: params.parentCustomerId,
						childId: "child-1",
						status: "active",
						joinedAt: "2026-01-01T00:00:00Z",
						childDisplayName: "Emma Watson",
						childName: "Emma Watson",
						createdAt: "2026-01-01T00:00:00Z",
						updatedAt: "2026-01-01T00:00:00Z",
					},
				];
			},
		} as unknown as WaitlistService;

		const app = new Hono();
		app.route(
			"/organizations/:slug/customer",
			buildCustomerWaitlistRoutes({
				waitlistService,
				customerAccountService:
					customerAccountService as unknown as CustomerAccountService,
			}),
		);

		return { app, calls, waitlistService, customerAccountService };
	}

	describe("POST /festivals/:festivalShortName/classes/:classId/waitlist", () => {
		it("rejects Bearer authorization", async () => {
			const { app } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/classes/class-1/waitlist",
				{
					method: "POST",
					headers: {
						Authorization: "Bearer token",
						Cookie: AUTH_COOKIE,
						"X-CSRF-Token": CSRF_TOKEN,
						Origin: VALID_ORIGIN,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						childId: "child-1",
						parentName: "John Doe",
						parentEmail: "john@example.com",
						parentPhone: "555-123-4567",
						staffAccessConsent: true,
					}),
				},
			);
			expect(res.status).toBe(400);
			const data = (await res.json()) as { error: string };
			expect(data.error).toContain("Bearer authorization is not accepted");
		});

		it("rejects missing cookie auth with 401", async () => {
			const { app } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/classes/class-1/waitlist",
				{
					method: "POST",
					headers: {
						"X-CSRF-Token": CSRF_TOKEN,
						Origin: VALID_ORIGIN,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						childId: "child-1",
						parentName: "John Doe",
						parentEmail: "john@example.com",
						parentPhone: "555-123-4567",
						staffAccessConsent: true,
					}),
				},
			);
			expect(res.status).toBe(401);
		});

		it("rejects CSRF failure with 403", async () => {
			const { app } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/classes/class-1/waitlist",
				{
					method: "POST",
					headers: {
						Cookie: AUTH_COOKIE,
						"X-CSRF-Token": "wrong-csrf",
						Origin: VALID_ORIGIN,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						childId: "child-1",
						parentName: "John Doe",
						parentEmail: "john@example.com",
						parentPhone: "555-123-4567",
						staffAccessConsent: true,
					}),
				},
			);
			expect(res.status).toBe(403);
		});

		it("rejects invalid payload with 400", async () => {
			const { app } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/classes/class-1/waitlist",
				{
					method: "POST",
					headers: {
						Cookie: AUTH_COOKIE,
						"X-CSRF-Token": CSRF_TOKEN,
						Origin: VALID_ORIGIN,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						childId: "child-1",
						parentName: "John Doe",
						parentEmail: "invalid-email",
						parentPhone: "555-123-4567",
						staffAccessConsent: true,
					}),
				},
			);
			expect(res.status).toBe(400);
			const data = (await res.json()) as { error: string };
			expect(data.error).toContain("Parent email is invalid");
		});

		it("joins waitlist successfully on valid request", async () => {
			const { app, calls } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/classes/class-1/waitlist",
				{
					method: "POST",
					headers: {
						Cookie: AUTH_COOKIE,
						"X-CSRF-Token": CSRF_TOKEN,
						Origin: VALID_ORIGIN,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						childId: "child-1",
						parentName: "John Doe",
						parentEmail: "john@example.com",
						parentPhone: "555-123-4567",
						staffAccessConsent: true,
					}),
				},
			);
			expect(res.status).toBe(200);
			const data = (await res.json()) as {
				entry: { id: string };
				alreadyJoined: boolean;
			};
			expect(data.entry.id).toBe("entry-1");
			expect(data.alreadyJoined).toBe(false);
			expect(calls.joinWaitlist.length).toBe(1);
			expect(calls.joinWaitlist[0]).toMatchObject({
				organizationId: "org-1",
				festivalId: "fest-2026",
				festivalClassId: "class-1",
				parentCustomerId: "customer-1",
				childId: "child-1",
				parentName: "John Doe",
				parentEmail: "john@example.com",
				parentPhone: "555-123-4567",
				staffAccessConsent: true,
			});
		});
	});

	describe("POST /festivals/:festivalShortName/classes/:classId/waitlist/withdraw", () => {
		it("withdraws child from waitlist", async () => {
			const { app, calls } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/classes/class-1/waitlist/withdraw",
				{
					method: "POST",
					headers: {
						Cookie: AUTH_COOKIE,
						"X-CSRF-Token": CSRF_TOKEN,
						Origin: VALID_ORIGIN,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						childId: "child-1",
					}),
				},
			);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { entry: { status: string } };
			expect(data.entry.status).toBe("withdrawn");
			expect(calls.withdrawWaitlist.length).toBe(1);
			expect(calls.withdrawWaitlist[0]).toMatchObject({
				organizationId: "org-1",
				festivalId: "fest-2026",
				festivalClassId: "class-1",
				parentCustomerId: "customer-1",
				childId: "child-1",
				actorType: "parent",
				actorId: "customer-1",
			});
		});

		it("rejects withdrawal if childId is missing", async () => {
			const { app } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/classes/class-1/waitlist/withdraw",
				{
					method: "POST",
					headers: {
						Cookie: AUTH_COOKIE,
						"X-CSRF-Token": CSRF_TOKEN,
						Origin: VALID_ORIGIN,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({}),
				},
			);
			expect(res.status).toBe(400);
		});
	});

	describe("GET /festivals/:festivalShortName/classes/:classId/waitlist", () => {
		it("rejects missing session cookie with 401", async () => {
			const { app } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/classes/class-1/waitlist",
			);
			expect(res.status).toBe(401);
		});

		it("returns waitlist entries for specific class", async () => {
			const { app, calls } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/classes/class-1/waitlist",
				{
					headers: {
						Cookie: AUTH_COOKIE,
					},
				},
			);
			expect(res.status).toBe(200);
			const data = (await res.json()) as {
				entries: Array<{ childDisplayName: string }>;
			};
			expect(data.entries).toHaveLength(1);
			expect(data.entries[0].childDisplayName).toBe("Emma Watson");
			expect(calls.listParentWaitlistEntries[0]).toMatchObject({
				organizationId: "org-1",
				parentCustomerId: "customer-1",
				festivalId: "fest-2026",
				classId: "class-1",
			});
		});
	});

	describe("GET /festivals/:festivalShortName/waitlist", () => {
		it("returns waitlist entries for festival with optional query filter", async () => {
			const { app, calls } = createMockServices();
			const res = await app.request(
				"/organizations/my-org/customer/festivals/fest-2026/waitlist?classId=class-2",
				{
					headers: {
						Cookie: AUTH_COOKIE,
					},
				},
			);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { entries: unknown[] };
			expect(data.entries).toHaveLength(1);
			expect(calls.listParentWaitlistEntries[0]).toMatchObject({
				organizationId: "org-1",
				parentCustomerId: "customer-1",
				festivalId: "fest-2026",
				classId: "class-2",
			});
		});
	});
});

describe("buildAdminWaitlistRoutes", () => {
	async function createAdminFixture() {
		const orgRepo = new InMemoryOrganizationRepository();
		const org = await orgRepo.createOrganization({
			name: "Test Org",
			slug: "test-org",
		});
		const festival = await orgRepo.createFestival({
			id: "fest-1",
			organizationId: org.id,
			name: "Festival 2026",
			code: "FEST26",
			shortName: "fest-2026",
			startDate: "2026-05-01",
			endDate: "2026-05-10",
		});

		const calls: ListClassWaitlistRosterParams[] = [];
		const waitlistService = {
			listClassWaitlistRosterForAdmin: async (
				params: ListClassWaitlistRosterParams,
			) => {
				calls.push(params);
				return [
					{
						id: "entry-1",
						festivalClassId: params.classId,
						childId: "child-1",
						childName: "Emma Watson",
						parentCustomerId: "parent-1",
						parentName: "John Doe",
						parentEmail: "john@example.com",
						parentPhone: "555-123-4567",
						status: "active",
						joinedAt: "2026-01-01T00:00:00Z",
						position: 1,
						createdAt: "2026-01-01T00:00:00Z",
						updatedAt: "2026-01-01T00:00:00Z",
					},
				];
			},
		} as unknown as WaitlistService;

		const adminUser = await orgRepo.upsertUser({
			uid: "admin-1",
			email: "admin@example.com",
			displayName: "Admin",
		});
		await orgRepo.createMembership({
			organizationId: org.id,
			userId: adminUser.id,
			role: "Admin",
			origin: "creator",
		});

		let authPrincipal: AuthenticatedUser | null = {
			uid: "admin-1",
			email: "admin@example.com",
			displayName: "Admin",
		};

		const authVerifier: AuthVerifier = {
			verify: async () => {
				if (!authPrincipal) {
					throw new AppError("Authentication failed.", 401);
				}
				return authPrincipal;
			},
		};

		const app = new Hono();
		app.route(
			"/",
			buildAdminWaitlistRoutes({
				waitlistService,
				authVerifier,
				repository: orgRepo,
			}),
		);

		return {
			app,
			orgRepo,
			org,
			festival,
			calls,
			setAuthPrincipal: (p: AuthenticatedUser | null) => {
				authPrincipal = p;
			},
		};
	}

	it("returns 401 when unauthenticated", async () => {
		const f = await createAdminFixture();
		f.setAuthPrincipal(null);
		const res = await f.app.request(
			`/organizations/${f.org.slug}/festivals/${f.festival.shortName}/classes/class-1/waitlist`,
		);
		expect(res.status).toBe(401);
	});

	it("returns 403 when user lacks Admin role", async () => {
		const f = await createAdminFixture();
		const user = await f.orgRepo.upsertUser({
			uid: "user-1",
			email: "user@example.com",
			displayName: "User",
		});
		await f.orgRepo.createMembership({
			organizationId: f.org.id,
			userId: user.id,
			role: "Adjudicator",
			origin: "invite",
		});
		f.setAuthPrincipal({
			uid: "user-1",
			email: "user@example.com",
			displayName: "User",
		});
		const res = await f.app.request(
			`/organizations/${f.org.slug}/festivals/${f.festival.shortName}/classes/class-1/waitlist`,
			{
				headers: {
					Authorization: "Bearer token",
				},
			},
		);
		expect(res.status).toBe(403);
	});

	it("returns 404 when festival does not exist", async () => {
		const f = await createAdminFixture();
		const res = await f.app.request(
			`/organizations/${f.org.slug}/festivals/non-existent-fest/classes/class-1/waitlist`,
			{
				headers: {
					Authorization: "Bearer token",
				},
			},
		);
		expect(res.status).toBe(404);
	});

	it("returns 503 when waitlistService is undefined", async () => {
		const f = await createAdminFixture();
		const appNoService = new Hono();
		appNoService.route(
			"/",
			buildAdminWaitlistRoutes({
				authVerifier: {
					verify: async () => ({
						uid: "admin-1",
						email: "admin@example.com",
						displayName: "Admin",
					}),
				},
				repository: f.orgRepo,
			}),
		);
		const res = await appNoService.request(
			`/organizations/${f.org.slug}/festivals/${f.festival.shortName}/classes/class-1/waitlist`,
			{
				headers: {
					Authorization: "Bearer token",
				},
			},
		);
		expect(res.status).toBe(503);
	});

	it("returns roster entries on successful admin request", async () => {
		const f = await createAdminFixture();
		const res = await f.app.request(
			`/organizations/${f.org.slug}/festivals/${f.festival.shortName}/classes/class-1/waitlist`,
			{
				headers: {
					Authorization: "Bearer token",
				},
			},
		);
		expect(res.status).toBe(200);
		const data = (await res.json()) as {
			roster: Array<{ childName: string; position: number }>;
		};
		expect(data.roster).toHaveLength(1);
		expect(data.roster[0].childName).toBe("Emma Watson");
		expect(data.roster[0].position).toBe(1);
		expect(f.calls.length).toBe(1);
		expect(f.calls[0]).toMatchObject({
			organizationId: f.org.id,
			festivalId: f.festival.id,
			classId: "class-1",
			actorUid: "admin-1",
		});
	});
});

describe("createApp full inventory & wiring integration", () => {
	it("initializes without errors and routes pass assertRouteSecurityInventory", async () => {
		const { app } = await createApp({
			env: { port: 3000 },
			enableDropTransfer: true,
			repository: new InMemoryOrganizationRepository(),
			authVerifier: {
				verify: async () => {
					throw new Error("Inventory does not authenticate.");
				},
			},
		});

		// Check that the new waitlist routes exist in registered app routes
		const routes = app.routes.map((r) => `${r.method} ${r.path}`);
		expect(routes).toContain(
			"POST /api/organizations/:slug/customer/festivals/:festivalShortName/classes/:classId/waitlist",
		);
		expect(routes).toContain(
			"POST /api/organizations/:slug/customer/festivals/:festivalShortName/classes/:classId/waitlist/withdraw",
		);
		expect(routes).toContain(
			"GET /api/organizations/:slug/customer/festivals/:festivalShortName/classes/:classId/waitlist",
		);
		expect(routes).toContain(
			"GET /api/organizations/:slug/customer/festivals/:festivalShortName/waitlist",
		);
		expect(routes).toContain(
			"GET /api/organizations/:slug/festivals/:festivalShortName/classes/:classId/waitlist",
		);
	});
});
