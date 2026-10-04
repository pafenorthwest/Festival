import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser, ClassEntitlement } from "@festival/common";
import { Hono } from "hono";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryClassEntitlementRepository } from "../src/commerce/class-entitlement-repository.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import { DropTransferService } from "../src/registration/drop-transfer-service.js";
import { InMemoryRegistrationChangeRepository } from "../src/registration/registration-change-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildAdminRegistrationRoutes } from "../src/routes/admin-registration/admin-registration.routes.js";
import { buildCustomerRegistrationRoutes } from "../src/routes/customer/customer-registration.routes.js";
import { OrganizationService } from "../src/services/organization-service.js";

class FakeAuth implements AuthVerifier {
	constructor(private readonly users: Record<string, AuthenticatedUser>) {}

	async verify(token: string): Promise<AuthenticatedUser> {
		const user = this.users[token];
		if (!user) throw new AppError("Invalid auth token.", 401);
		return user;
	}
}

interface TestContext {
	orgRepo: InMemoryOrganizationRepository;
	entitlementsRepo: InMemoryClassEntitlementRepository;
	changesRepo: InMemoryRegistrationChangeRepository;
	dropTransferService: DropTransferService;
	customerAccountService: CustomerAccountService;
	authVerifier: AuthVerifier;
	customerApp: Hono;
	adminApp: Hono;
	fullApp: Hono;
	organization: { id: string; slug: string };
	festival: { id: string; shortName: string };
}

async function setupTestContext(): Promise<TestContext> {
	const orgRepo = new InMemoryOrganizationRepository();
	const organization = await orgRepo.createOrganization({
		name: "Pacific Festival",
		slug: "pafe",
	});

	const festival = await orgRepo.createFestival({
		id: "fest-1",
		organizationId: organization.id,
		code: "PAFE26",
		shortName: "spring-2026",
		name: "Spring 2026",
		startDate: "2026-05-01",
		endDate: "2026-05-10",
	});

	const adminUser = await orgRepo.upsertUser({
		uid: "uid-admin",
		email: "admin@example.com",
		displayName: "Admin",
	});
	await orgRepo.createMembership({
		organizationId: organization.id,
		userId: adminUser.id,
		role: "Admin",
		origin: "creator",
	});

	const memberUser = await orgRepo.upsertUser({
		uid: "uid-member",
		email: "member@example.com",
		displayName: "Member",
	});
	await orgRepo.createMembership({
		organizationId: organization.id,
		userId: memberUser.id,
		role: "Division Chair",
		origin: "invite",
	});

	const entitlementsRepo = new InMemoryClassEntitlementRepository();
	const changesRepo = new InMemoryRegistrationChangeRepository();

	const capacities: Record<string, number> = {
		"class-open": 5,
		"class-small": 1,
		"class-full": 1,
	};

	const dropTransferService = new DropTransferService({
		entitlements: entitlementsRepo,
		changes: changesRepo,
		classQuery: (classId: string) => capacities[classId] ?? 10,
	});

	const customerAccountService = {
		validateSession: async (_slug: string, sessionToken: string) => {
			if (!sessionToken || sessionToken === "invalid-token") {
				throw new AppError("Customer session is invalid.", 401);
			}
			if (sessionToken === "other-cust-session") {
				return { organizationId: organization.id, customerId: "cust-other" };
			}
			return { organizationId: organization.id, customerId: "cust-1" };
		},
	} as unknown as CustomerAccountService;

	const authVerifier = new FakeAuth({
		admin: {
			uid: "uid-admin",
			email: "admin@example.com",
			displayName: "Admin",
		},
		member: {
			uid: "uid-member",
			email: "member@example.com",
			displayName: "Member",
		},
	});

	const customerApp = new Hono();
	customerApp.route(
		"/organizations/:slug/customer",
		buildCustomerRegistrationRoutes({
			customerAccountService,
			dropTransferService,
		}),
	);

	const organizationService = new OrganizationService(orgRepo);
	const adminApp = new Hono();
	adminApp.route(
		"/",
		buildAdminRegistrationRoutes({
			organizationService,
			authVerifier,
			dropTransferService,
			registrationChangeRepository: changesRepo,
		}),
	);

	const { app: fullApp } = await createApp({
		repository: orgRepo,
		authVerifier,
		customerAccountService,
		dropTransferService,
		registrationChangeRepository: changesRepo,
		classEntitlementRepository: entitlementsRepo,
	});

	return {
		orgRepo,
		entitlementsRepo,
		changesRepo,
		dropTransferService,
		customerAccountService,
		authVerifier,
		customerApp,
		adminApp,
		fullApp,
		organization,
		festival,
	};
}

async function createEntitlement(
	repo: InMemoryClassEntitlementRepository,
	overrides: Partial<ClassEntitlement> = {},
): Promise<ClassEntitlement> {
	return repo.createClassEntitlement({
		id: overrides.id ?? `ent-${Math.random().toString(36).slice(2, 8)}`,
		organizationId: overrides.organizationId ?? "pafe",
		festivalId: overrides.festivalId ?? "fest-1",
		festivalClassId: overrides.festivalClassId ?? "class-open",
		parentCustomerId: overrides.parentCustomerId ?? "cust-1",
		childId: overrides.childId ?? "child-1",
		checkoutIntentId: overrides.checkoutIntentId ?? "intent-1",
		shopifyOrderGid: overrides.shopifyOrderGid ?? "gid://shopify/Order/1",
		shopifyOrderLineGid:
			overrides.shopifyOrderLineGid ?? `gid://shopify/Line/${Math.random()}`,
		paidAmountCents: overrides.paidAmountCents ?? 3500,
		paidCurrencyCode: overrides.paidCurrencyCode ?? "USD",
		status: overrides.status ?? "confirmed",
		createdAt: overrides.createdAt ?? new Date().toISOString(),
	});
}

describe("Drop and Transfer HTTP Endpoints", () => {
	describe("Customer Endpoints", () => {
		it("POST drop rejects request when customer session is missing (401)", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/reg-1/drop`,
				{ method: "POST" },
			);
			expect(res.status).toBe(401);
		});

		it("POST drop rejects request when customer session is invalid (401)", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/reg-1/drop`,
				{
					method: "POST",
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=invalid-token` },
				},
			);
			expect(res.status).toBe(401);
		});

		it("POST drop rejects Bearer authorization (400)", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/reg-1/drop`,
				{
					method: "POST",
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token`,
						Authorization: "Bearer admin",
					},
				},
			);
			expect(res.status).toBe(400);
		});

		it("POST drop returns 404 if dropTransferService is not provided", async () => {
			const ctx = await setupTestContext();
			const testApp = new Hono();
			testApp.route(
				"/organizations/:slug/customer",
				buildCustomerRegistrationRoutes({
					customerAccountService: ctx.customerAccountService,
				}),
			);
			const res = await testApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/reg-1/drop`,
				{
					method: "POST",
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token` },
				},
			);
			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toBe("Feature 'drop_and_transfer' is not enabled.");
		});

		it("POST drop returns 404 when registration does not exist", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/non-existent/drop`,
				{
					method: "POST",
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token` },
				},
			);
			expect(res.status).toBe(404);
		});

		it("POST drop returns 404 when registration belongs to a different customer", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				parentCustomerId: "cust-other",
			});
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/${ent.id}/drop`,
				{
					method: "POST",
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token` },
				},
			);
			expect(res.status).toBe(404);
		});

		it("POST drop returns 409 when registration is already cancelled", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				status: "cancelled",
			});
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/${ent.id}/drop`,
				{
					method: "POST",
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token` },
				},
			);
			expect(res.status).toBe(409);
		});

		it("POST drop successfully drops confirmed registration without body", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
			});
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/${ent.id}/drop`,
				{
					method: "POST",
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token` },
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.classEntitlementId).toBe(ent.id);

			const updated = await ctx.entitlementsRepo.getClassEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(updated?.status).toBe("cancelled");

			const logs = await ctx.changesRepo.listChangeLogsForEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(logs).toHaveLength(1);
			expect(logs[0].action).toBe("drop");
			expect(logs[0].actorRole).toBe("customer");
			expect(logs[0].actorUid).toBe("cust-1");
		});

		it("POST drop auto-promotes top waitlisted candidate on confirmed drop", async () => {
			const ctx = await setupTestContext();
			const confirmedEnt = await createEntitlement(ctx.entitlementsRepo, {
				id: "ent-conf",
				organizationId: ctx.organization.id,
				festivalClassId: "class-small",
				status: "confirmed",
			});
			const waitlistedEnt = await createEntitlement(ctx.entitlementsRepo, {
				id: "ent-wait",
				organizationId: ctx.organization.id,
				festivalClassId: "class-small",
				parentCustomerId: "cust-other",
				status: "waitlisted",
			});

			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/${confirmedEnt.id}/drop`,
				{
					method: "POST",
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ reason: "Scheduling conflict" }),
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.promotedWaitlistEntitlements).toHaveLength(1);
			expect(body.promotedWaitlistEntitlements[0].classEntitlementId).toBe(
				waitlistedEnt.id,
			);

			const promoted = await ctx.entitlementsRepo.getClassEntitlement(
				ctx.organization.id,
				waitlistedEnt.id,
			);
			expect(promoted?.status).toBe("confirmed");
		});

		it("POST transfer rejects unauthenticated / invalid session (401)", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/reg-1/transfer`,
				{ method: "POST" },
			);
			expect(res.status).toBe(401);
		});

		it("POST transfer returns 404 when registration does not exist", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/missing/transfer`,
				{
					method: "POST",
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ targetFestivalClassId: "class-open" }),
				},
			);
			expect(res.status).toBe(404);
		});

		it("POST transfer returns 400 when target class ID is missing", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
			});
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/${ent.id}/transfer`,
				{
					method: "POST",
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ reason: "Switch class" }),
				},
			);
			expect(res.status).toBe(400);
		});

		it("POST transfer returns 400 when target class is identical to source", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalClassId: "class-open",
			});
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/${ent.id}/transfer`,
				{
					method: "POST",
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ targetFestivalClassId: "class-open" }),
				},
			);
			expect(res.status).toBe(400);
		});

		it("POST transfer successfully transfers to class with capacity", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalClassId: "class-small",
			});
			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/${ent.id}/transfer`,
				{
					method: "POST",
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						targetFestivalClassId: "class-open",
						reason: "Level up",
					}),
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.targetFestivalClassId).toBe("class-open");
			expect(body.previousFestivalClassId).toBe("class-small");

			const updated = await ctx.entitlementsRepo.getClassEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(updated?.festivalClassId).toBe("class-open");
			expect(updated?.status).toBe("confirmed");

			const logs = await ctx.changesRepo.listChangeLogsForEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(logs).toHaveLength(1);
			expect(logs[0].action).toBe("transfer");
			expect(logs[0].actorRole).toBe("customer");
		});

		it("POST transfer places entitlement on waitlist when target class is full", async () => {
			const ctx = await setupTestContext();
			await createEntitlement(ctx.entitlementsRepo, {
				id: "existing-in-full",
				organizationId: ctx.organization.id,
				festivalClassId: "class-full",
				status: "confirmed",
			});
			const entToTransfer = await createEntitlement(ctx.entitlementsRepo, {
				id: "ent-to-transfer",
				organizationId: ctx.organization.id,
				festivalClassId: "class-open",
				status: "confirmed",
			});

			const res = await ctx.customerApp.request(
				`/organizations/${ctx.organization.slug}/customer/class-registrations/${entToTransfer.id}/transfer`,
				{
					method: "POST",
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ targetFestivalClassId: "class-full" }),
				},
			);
			expect(res.status).toBe(200);

			const updated = await ctx.entitlementsRepo.getClassEntitlement(
				ctx.organization.id,
				entToTransfer.id,
			);
			expect(updated?.festivalClassId).toBe("class-full");
			expect(updated?.status).toBe("waitlisted");
		});
	});

	describe("Admin Endpoints", () => {
		const base = (shortName: string, id: string, action: string) =>
			`/organizations/pafe/festivals/${shortName}/registrations/${id}/${action}`;

		it("POST admin drop rejects missing auth (401)", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, "reg-1", "drop"),
				{ method: "POST" },
			);
			expect(res.status).toBe(401);
		});

		it("POST admin drop rejects non-admin role (403)", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, "reg-1", "drop"),
				{
					method: "POST",
					headers: { Authorization: "Bearer member" },
				},
			);
			expect(res.status).toBe(403);
		});

		it("POST admin drop returns 404 for unknown festival", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.adminApp.request(
				base("unknown-festival", "reg-1", "drop"),
				{
					method: "POST",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(404);
		});

		it("POST admin drop returns 404 for unknown registration", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, "non-existent", "drop"),
				{
					method: "POST",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(404);
		});

		it("POST admin drop drops entitlement with custom refund amount and reason", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalId: ctx.festival.id,
				paidAmountCents: 5000,
			});

			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, ent.id, "drop"),
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						reason: "Medical exception",
						refund: true,
						refundAmountCents: 4500,
					}),
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.refundEvent).toBeDefined();
			expect(body.refundEvent.amountCents).toBe(4500);

			const updated = await ctx.entitlementsRepo.getClassEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(updated?.status).toBe("cancelled");

			const logs = await ctx.changesRepo.listChangeLogsForEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(logs).toHaveLength(1);
			expect(logs[0].actorRole).toBe("admin");
			expect(logs[0].actorUid).toBe("uid-admin");
			expect(logs[0].reason).toBe("Medical exception");
		});

		it("POST admin transfer transfers entitlement with reason", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalId: ctx.festival.id,
				festivalClassId: "class-small",
			});

			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, ent.id, "transfer"),
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						targetFestivalClassId: "class-open",
						reason: "Administrative rebalancing",
					}),
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);

			const updated = await ctx.entitlementsRepo.getClassEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(updated?.festivalClassId).toBe("class-open");

			const logs = await ctx.changesRepo.listChangeLogsForEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(logs[0].action).toBe("transfer");
			expect(logs[0].actorRole).toBe("admin");
			expect(logs[0].reason).toBe("Administrative rebalancing");
		});

		it("POST admin promote returns 400 when registration is not waitlisted", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalId: ctx.festival.id,
				status: "confirmed",
			});

			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, ent.id, "promote"),
				{
					method: "POST",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(400);
		});

		it("POST admin promote manually promotes waitlisted entitlement to confirmed", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalId: ctx.festival.id,
				status: "waitlisted",
			});

			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, ent.id, "promote"),
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ reason: "Director override" }),
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.promoted).toBe(true);
			expect(body.newStatus).toBe("confirmed");

			const updated = await ctx.entitlementsRepo.getClassEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(updated?.status).toBe("confirmed");

			const logs = await ctx.changesRepo.listChangeLogsForEntitlement(
				ctx.organization.id,
				ent.id,
			);
			expect(logs).toHaveLength(1);
			expect(logs[0].action).toBe("waitlist_promote");
			expect(logs[0].actorRole).toBe("admin");
			expect(logs[0].reason).toBe("Director override");
		});

		it("GET change-log returns 403 for non-admin", async () => {
			const ctx = await setupTestContext();
			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, "reg-1", "change-log"),
				{
					method: "GET",
					headers: { Authorization: "Bearer member" },
				},
			);
			expect(res.status).toBe(403);
		});

		it("GET change-log returns empty list when no changes exist", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalId: ctx.festival.id,
			});

			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, ent.id, "change-log"),
				{
					method: "GET",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.changeLogs).toEqual([]);
		});

		it("GET change-log lists all change logs for the entitlement in sequence", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalId: ctx.festival.id,
				festivalClassId: "class-small",
				status: "waitlisted",
			});

			await ctx.adminApp.request(
				base(ctx.festival.shortName, ent.id, "promote"),
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ reason: "Manual promotion" }),
				},
			);

			await ctx.adminApp.request(
				base(ctx.festival.shortName, ent.id, "transfer"),
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						targetFestivalClassId: "class-open",
						reason: "Class transfer",
					}),
				},
			);

			await ctx.adminApp.request(base(ctx.festival.shortName, ent.id, "drop"), {
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ reason: "Dropped by admin" }),
			});

			const res = await ctx.adminApp.request(
				base(ctx.festival.shortName, ent.id, "change-log"),
				{
					method: "GET",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.changeLogs).toHaveLength(3);
			const actions = body.changeLogs.map(
				(log: { action: string }) => log.action,
			);
			expect(actions).toContain("waitlist_promote");
			expect(actions).toContain("transfer");
			expect(actions).toContain("drop");
		});
	});

	describe("Full App Integration & Route Security Inventory", () => {
		it("createApp starts without route inventory mismatches and routes respond", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalId: ctx.festival.id,
				festivalClassId: "class-small",
				status: "confirmed",
			});

			const custRes = await ctx.fullApp.request(
				`/api/organizations/${ctx.organization.slug}/customer/class-registrations/${ent.id}/drop`,
				{
					method: "POST",
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token` },
				},
			);
			expect(custRes.status).toBe(200);

			const adminLogRes = await ctx.fullApp.request(
				`/api/organizations/${ctx.organization.slug}/festivals/${ctx.festival.shortName}/registrations/${ent.id}/change-log`,
				{
					method: "GET",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(adminLogRes.status).toBe(200);
			const body = await adminLogRes.json();
			expect(body.changeLogs).toHaveLength(1);
			expect(body.changeLogs[0].action).toBe("drop");
		});

		it("createApp({ enableDropTransfer: true, ... }) wires dropTransferService and returns 200", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalId: ctx.festival.id,
				festivalClassId: "class-small",
				status: "confirmed",
			});

			const { app: enabledApp } = await createApp({
				enableDropTransfer: true,
				repository: ctx.orgRepo,
				authVerifier: ctx.authVerifier,
				customerAccountService: ctx.customerAccountService,
				classEntitlementRepository: ctx.entitlementsRepo,
				registrationChangeRepository: ctx.changesRepo,
			});

			const custRes = await enabledApp.request(
				`/api/organizations/${ctx.organization.slug}/customer/class-registrations/${ent.id}/drop`,
				{
					method: "POST",
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token` },
				},
			);
			expect(custRes.status).toBe(200);

			const adminLogRes = await enabledApp.request(
				`/api/organizations/${ctx.organization.slug}/festivals/${ctx.festival.shortName}/registrations/${ent.id}/change-log`,
				{
					method: "GET",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(adminLogRes.status).toBe(200);
			const body = await adminLogRes.json();
			expect(body.changeLogs).toHaveLength(1);
			expect(body.changeLogs[0].action).toBe("drop");
		});

		it("createApp({ enableDropTransfer: false, ... }) returns 404 for drop and change-log endpoints", async () => {
			const ctx = await setupTestContext();
			const ent = await createEntitlement(ctx.entitlementsRepo, {
				organizationId: ctx.organization.id,
				festivalId: ctx.festival.id,
				festivalClassId: "class-small",
				status: "confirmed",
			});

			const { app: disabledApp } = await createApp({
				enableDropTransfer: false,
				repository: ctx.orgRepo,
				authVerifier: ctx.authVerifier,
				customerAccountService: ctx.customerAccountService,
				classEntitlementRepository: ctx.entitlementsRepo,
				registrationChangeRepository: ctx.changesRepo,
			});

			const custRes = await disabledApp.request(
				`/api/organizations/${ctx.organization.slug}/customer/class-registrations/${ent.id}/drop`,
				{
					method: "POST",
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=valid-token` },
				},
			);
			expect(custRes.status).toBe(404);
			const custBody = await custRes.json();
			expect(custBody.error).toBe(
				"Feature 'drop_and_transfer' is not enabled.",
			);

			const adminLogRes = await disabledApp.request(
				`/api/organizations/${ctx.organization.slug}/festivals/${ctx.festival.shortName}/registrations/${ent.id}/change-log`,
				{
					method: "GET",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(adminLogRes.status).toBe(404);
			const adminBody = await adminLogRes.json();
			expect(adminBody.error).toBe(
				"Feature 'drop_and_transfer' is not enabled.",
			);
		});
	});
});
