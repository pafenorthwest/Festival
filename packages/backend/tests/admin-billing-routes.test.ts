import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import { BillingReconciliationService } from "../src/billing/billing-reconciliation-service.js";
import { InMemoryBillingRepository } from "../src/billing/billing-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildAdminBillingRoutes } from "../src/routes/admin-billing.routes.js";

class FakeAuth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		const users: Record<string, AuthenticatedUser> = {
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin",
			},
			reader: {
				uid: "uid-reader",
				email: "reader@example.com",
				displayName: "Reader",
			},
			outsider: {
				uid: "uid-outsider",
				email: "outsider@example.com",
				displayName: "Outsider",
			},
		};
		const user = users[token];
		if (!user) throw new Error(`Unknown token: ${token}`);
		return user;
	}
}

async function createTestApp() {
	const repository = new InMemoryOrganizationRepository();
	const billingRepository = new InMemoryBillingRepository();
	const billingReconciliationService = new BillingReconciliationService(
		billingRepository,
	);
	const organization = await repository.createOrganization({
		name: "Pacific Festival",
		slug: "pafe",
	});

	const adminUser = await repository.upsertUser({
		uid: "uid-admin",
		email: "admin@example.com",
		displayName: "Admin",
	});
	await repository.createMembership({
		organizationId: organization.id,
		userId: adminUser.id,
		role: "Admin",
		origin: "creator",
	});

	const readerUser = await repository.upsertUser({
		uid: "uid-reader",
		email: "reader@example.com",
		displayName: "Reader",
	});
	await repository.createMembership({
		organizationId: organization.id,
		userId: readerUser.id,
		role: "Reader",
		origin: "invite",
	});

	await repository.upsertUser({
		uid: "uid-outsider",
		email: "outsider@example.com",
		displayName: "Outsider",
	});

	const authVerifier = new FakeAuth();
	const app = new Hono();
	app.route(
		"/organizations/:slug/billing",
		buildAdminBillingRoutes({
			repository,
			authVerifier,
			billingReconciliationService,
		}),
	);

	return {
		app,
		organization,
		repository,
		billingRepository,
		billingReconciliationService,
		adminUser,
	};
}

describe("admin billing reconciliation routes", () => {
	describe("security & authorization", () => {
		it("returns 401 when request is unauthenticated", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/mismatches`,
			);
			expect(res.status).toBe(401);
		});

		it("returns 403 when user is not in organization", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/mismatches`,
				{
					headers: { Authorization: "Bearer outsider" },
				},
			);
			expect(res.status).toBe(403);
		});

		it("returns 403 when user lacks admin role", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/mismatches`,
				{
					headers: { Authorization: "Bearer reader" },
				},
			);
			expect(res.status).toBe(403);
		});
	});

	describe("GET /organizations/:slug/billing/mismatches", () => {
		it("returns 200 and empty mismatches array initially", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/mismatches`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(Array.isArray(body.mismatches)).toBe(true);
			expect(body.mismatches).toHaveLength(0);
		});

		it("returns 200 with detected mismatches", async () => {
			const { app, organization, billingRepository } = await createTestApp();
			billingRepository.seedOrderProjections([
				{
					organizationId: organization.id,
					shopifyOrderGid: "gid://shopify/Order/1001",
					correlationId: "corr-1001",
					fullyPaidAt: "2026-09-28T00:00:00.000Z",
				},
			]);

			const res = await app.request(
				`/organizations/${organization.slug}/billing/mismatches`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.mismatches).toHaveLength(1);
			expect(body.mismatches[0].mismatchType).toBe("paid_unregistered");
		});
	});

	describe("GET /organizations/:slug/billing/customers/:customerId/credit-balance", () => {
		it("returns 200 with 0 balance for new customer", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/customers/cust-new/credit-balance`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.balanceCents).toBe(0);
			expect(body.currencyCode).toBe("USD");
			expect(body.customerId).toBe("cust-new");
		});

		it("returns 200 with updated credit balance after adjustment", async () => {
			const { app, organization } = await createTestApp();
			await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-1",
						adjustmentType: "credit_issue",
						amountCents: 4500,
						reason: "Goodwill credit",
					}),
				},
			);

			const res = await app.request(
				`/organizations/${organization.slug}/billing/customers/cust-1/credit-balance`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.balanceCents).toBe(4500);
			expect(body.currencyCode).toBe("USD");
		});
	});

	describe("GET /organizations/:slug/billing/customers/:customerId/ledger", () => {
		it("returns 200 and empty ledger entries for customer with no activity", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/customers/cust-empty/ledger`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(Array.isArray(body.ledger)).toBe(true);
			expect(body.ledger).toHaveLength(0);
		});

		it("returns 200 with ledger entries after adjustment applied", async () => {
			const { app, organization } = await createTestApp();
			await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-2",
						adjustmentType: "credit_issue",
						amountCents: 2000,
						reason: "Referral reward",
					}),
				},
			);

			const res = await app.request(
				`/organizations/${organization.slug}/billing/customers/cust-2/ledger`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.ledger).toHaveLength(1);
			expect(body.ledger[0].amountCents).toBe(2000);
			expect(body.ledger[0].balanceAfterCents).toBe(2000);
		});
	});

	describe("GET /organizations/:slug/billing/adjustments", () => {
		it("returns 200 with adjustments list and supports customerId filter", async () => {
			const { app, organization } = await createTestApp();
			await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-a",
						adjustmentType: "credit_issue",
						amountCents: 1000,
						reason: "Credit A",
					}),
				},
			);
			await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-b",
						adjustmentType: "credit_issue",
						amountCents: 1500,
						reason: "Credit B",
					}),
				},
			);

			// List all adjustments
			const allRes = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(allRes.status).toBe(200);
			const allBody = await allRes.json();
			expect(allBody.adjustments).toHaveLength(2);

			// Filter by customerId
			const filteredRes = await app.request(
				`/organizations/${organization.slug}/billing/adjustments?customerId=cust-a`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(filteredRes.status).toBe(200);
			const filteredBody = await filteredRes.json();
			expect(filteredBody.adjustments).toHaveLength(1);
			expect(filteredBody.adjustments[0].customerId).toBe("cust-a");
		});
	});

	describe("POST /organizations/:slug/billing/adjustments", () => {
		it("applies credit_issue adjustment successfully (201)", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-3",
						adjustmentType: "credit_issue",
						amountCents: 3500,
						reason: "Bonus issue",
					}),
				},
			);
			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.adjustment.amountCents).toBe(3500);
			expect(body.creditBalance.balanceCents).toBe(3500);
			expect(body.ledgerEntry).toBeDefined();
		});

		it("applies refund adjustment with decision and approvedDecisionId (201)", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-4",
						adjustmentType: "refund",
						amountCents: 5000,
						reason: "Authorized refund",
						referenceType: "decision",
						referenceId: "dec-401",
						approvedDecisionId: "appr-dec-401",
					}),
				},
			);
			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.adjustment.approvedDecisionId).toBe("appr-dec-401");
			expect(body.adjustment.amountCents).toBe(5000);
		});

		it("enforces authority checks: rejects decision refund without approvedDecisionId (403)", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-5",
						adjustmentType: "refund",
						amountCents: 2000,
						reason: "Unauthorized decision refund",
						referenceType: "decision",
						referenceId: "dec-501",
					}),
				},
			);
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error).toContain("Approved decision ID is required");
			expect(body.code).toBe("AUTHORITY_BOUNDARY_VIOLATION");
		});

		it("enforces authority checks: rejects membership refund without approvedDecisionId (403)", async () => {
			const { app, organization } = await createTestApp();
			const res = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-6",
						adjustmentType: "refund",
						amountCents: 2000,
						reason: "Membership refund without approval",
						referenceType: "membership",
						referenceId: "mem-601",
					}),
				},
			);
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error).toContain("Approved decision ID is required");
		});

		it("prevents duplicate adjustments with same referenceId (409)", async () => {
			const { app, organization } = await createTestApp();
			const payload = {
				customerId: "cust-7",
				adjustmentType: "credit_issue",
				amountCents: 1500,
				reason: "Promo code duplicate test",
				referenceType: "promo",
				referenceId: "promo-dup-1",
			};

			const firstRes = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify(payload),
				},
			);
			expect(firstRes.status).toBe(201);

			// Second attempt with same referenceId must return 409
			const secondRes = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify(payload),
				},
			);
			expect(secondRes.status).toBe(409);
			const body = await secondRes.json();
			expect(body.code).toBe("DUPLICATE_ADJUSTMENT");
		});

		it("rejects credit_apply when credit balance is insufficient (409)", async () => {
			const { app, organization } = await createTestApp();
			// First give 1000 cents
			await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-8",
						adjustmentType: "credit_issue",
						amountCents: 1000,
						reason: "Initial credit",
					}),
				},
			);

			// Now attempt to apply 2500 cents (exceeds balance of 1000)
			const res = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-8",
						adjustmentType: "credit_apply",
						amountCents: 2500,
						reason: "Apply too much credit",
					}),
				},
			);
			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.code).toBe("INSUFFICIENT_CREDIT_BALANCE");
		});

		it("supports write_off adjustment (201)", async () => {
			const { app, organization } = await createTestApp();
			// Give initial balance to write off
			await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-9",
						adjustmentType: "credit_issue",
						amountCents: 500,
						reason: "Initial",
					}),
				},
			);

			const res = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-9",
						adjustmentType: "write_off",
						amountCents: 500,
						reason: "Write off uncollectible debt",
					}),
				},
			);
			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.adjustment.adjustmentType).toBe("write_off");
			expect(body.creditBalance.balanceCents).toBe(0);
		});

		it("returns 400 for invalid inputs", async () => {
			const { app, organization } = await createTestApp();
			// Non-positive amount
			const res = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "cust-10",
						adjustmentType: "credit_issue",
						amountCents: -100,
						reason: "Negative",
					}),
				},
			);
			expect(res.status).toBe(400);

			// Missing customerId
			const resMissing = await app.request(
				`/organizations/${organization.slug}/billing/adjustments`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						customerId: "",
						adjustmentType: "credit_issue",
						amountCents: 100,
						reason: "Missing customer",
					}),
				},
			);
			expect(resMissing.status).toBe(400);
		});
	});
});
