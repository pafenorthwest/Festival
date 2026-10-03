import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import {
	InMemoryCheckoutRecoveryRepository,
	type RecoverableCheckoutIntentRecord,
} from "../src/checkout/checkout-recovery-repository.js";
import {
	CheckoutRecoveryService,
	InMemoryCheckoutRecoveryAuditLogger,
} from "../src/checkout/checkout-recovery-service.js";
import type { CheckoutIntentRecord } from "../src/checkout/checkout-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildAdminCheckoutRecoveryRoutes } from "../src/routes/admin-checkout-recovery.routes.js";

class FakeAuth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		const users: Record<string, AuthenticatedUser> = {
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin User",
			},
			reader: {
				uid: "uid-reader",
				email: "reader@example.com",
				displayName: "Reader User",
			},
			outsider: {
				uid: "uid-outsider",
				email: "outsider@example.com",
				displayName: "Outsider User",
			},
		};
		const user = users[token];
		if (!user) throw new Error(`Unknown token: ${token}`);
		return user;
	}
}

function makeIntent(
	overrides: Partial<CheckoutIntentRecord> = {},
): CheckoutIntentRecord {
	return {
		id: "intent-1",
		correlationId: "corr-1",
		organizationId: "org-1",
		customerId: "cust-1",
		sessionId: "session-1",
		idempotencyKey: "idem-1",
		intentType: "membership",
		offeringId: "offering-1",
		entitlementClass: "teacher_membership",
		durationDays: 365,
		festivalClassId: null,
		childId: null,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		policyVersion: "v1",
		divisionId: null,
		divisionNameSnapshot: null,
		staffAccessConsent: false,
		amount: "50.00",
		currencyCode: "USD",
		cartReference: null,
		status: "ready",
		expiresAtIso: "2030-01-01T00:00:00.000Z",
		createdAtIso: "2026-09-27T10:00:00.000Z",
		...overrides,
	};
}

async function createTestContext() {
	const orgRepo = new InMemoryOrganizationRepository();
	const recoveryRepo = new InMemoryCheckoutRecoveryRepository();
	const auditLogger = new InMemoryCheckoutRecoveryAuditLogger();

	const organization = await orgRepo.createOrganization({
		name: "Pacific Music Festival",
		slug: "pafe",
	});

	const adminUser = await orgRepo.upsertUser({
		uid: "uid-admin",
		email: "admin@example.com",
		displayName: "Admin User",
	});
	await orgRepo.createMembership({
		organizationId: organization.id,
		userId: adminUser.id,
		role: "Admin",
		origin: "creator",
	});

	const readerUser = await orgRepo.upsertUser({
		uid: "uid-reader",
		email: "reader@example.com",
		displayName: "Reader User",
	});
	await orgRepo.createMembership({
		organizationId: organization.id,
		userId: readerUser.id,
		role: "Reader",
		origin: "invite",
	});

	await orgRepo.upsertUser({
		uid: "uid-outsider",
		email: "outsider@example.com",
		displayName: "Outsider User",
	});

	const recoveryService = new CheckoutRecoveryService(
		recoveryRepo,
		orgRepo,
		undefined,
		auditLogger,
	);

	const authVerifier = new FakeAuth();
	const app = new Hono();
	app.route(
		"/",
		buildAdminCheckoutRecoveryRoutes({
			authVerifier,
			repository: orgRepo,
			checkoutRecoveryService: recoveryService,
		}),
	);

	return {
		app,
		organization,
		orgRepo,
		recoveryRepo,
		recoveryService,
		auditLogger,
	};
}

describe("Admin Checkout Recovery Routes & Service", () => {
	describe("Admin authorization check (401 / 403)", () => {
		it("rejects unauthenticated requests with 401", async () => {
			const { app, organization } = await createTestContext();

			const listRes = await app.request(
				`/organizations/${organization.slug}/admin/customers/cust-1/checkout-intents`,
			);
			expect(listRes.status).toBe(401);

			const invalidateRes = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-1/invalidate`,
				{
					method: "POST",
					headers: { "X-CSRF-Token": "csrf-token" },
				},
			);
			expect(invalidateRes.status).toBe(401);

			const recoverRes = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-1/recover`,
				{
					method: "POST",
					headers: { "X-CSRF-Token": "csrf-token" },
				},
			);
			expect(recoverRes.status).toBe(401);
		});

		it("rejects non-admin members with 403", async () => {
			const { app, organization } = await createTestContext();
			const headers = {
				Authorization: "Bearer reader",
				"X-CSRF-Token": "csrf-token",
			};

			const listRes = await app.request(
				`/organizations/${organization.slug}/admin/customers/cust-1/checkout-intents`,
				{ headers: { Authorization: "Bearer reader" } },
			);
			expect(listRes.status).toBe(403);

			const invalidateRes = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-1/invalidate`,
				{ method: "POST", headers },
			);
			expect(invalidateRes.status).toBe(403);

			const recoverRes = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-1/recover`,
				{ method: "POST", headers },
			);
			expect(recoverRes.status).toBe(403);
		});

		it("rejects outsiders without membership with 403", async () => {
			const { app, organization } = await createTestContext();
			const headers = {
				Authorization: "Bearer outsider",
				"X-CSRF-Token": "csrf-token",
			};

			const listRes = await app.request(
				`/organizations/${organization.slug}/admin/customers/cust-1/checkout-intents`,
				{ headers: { Authorization: "Bearer outsider" } },
			);
			expect(listRes.status).toBe(403);

			const invalidateRes = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-1/invalidate`,
				{ method: "POST", headers },
			);
			expect(invalidateRes.status).toBe(403);
		});
	});

	describe("CSRF on POST", () => {
		it("enforces CSRF header on POST invalidate and recover", async () => {
			const { app, organization } = await createTestContext();

			const noCsrfInvalidate = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-1/invalidate`,
				{
					method: "POST",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(noCsrfInvalidate.status).toBe(403);
			const errInvalidate = await noCsrfInvalidate.json();
			expect(errInvalidate.error).toContain("CSRF");

			const noCsrfRecover = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-1/recover`,
				{
					method: "POST",
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(noCsrfRecover.status).toBe(403);
			const errRecover = await noCsrfRecover.json();
			expect(errRecover.error).toContain("CSRF");
		});
	});

	describe("Incomplete checkout intents listing", () => {
		it("lists incomplete recoverable checkout intents for customer", async () => {
			const { app, organization, recoveryRepo } = await createTestContext();
			const orgId = organization.id;

			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-ready",
					organizationId: orgId,
					customerId: "cust-1",
					status: "ready",
				}),
			);
			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-failed",
					organizationId: orgId,
					customerId: "cust-1",
					status: "failed",
				}),
			);
			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-started",
					organizationId: orgId,
					customerId: "cust-1",
					status: "checkout_started",
				}),
			);
			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-approved",
					organizationId: orgId,
					customerId: "cust-1",
					status: "approved",
				}),
			);
			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-superseded",
					organizationId: orgId,
					customerId: "cust-1",
					status: "superseded",
				}),
			);
			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-cust2",
					organizationId: orgId,
					customerId: "cust-2",
					status: "ready",
				}),
			);
			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-paid-order",
					organizationId: orgId,
					customerId: "cust-1",
					correlationId: "corr-paid",
					status: "ready",
				}),
			);
			recoveryRepo.addOrderProjection({
				organizationId: orgId,
				correlationId: "corr-paid",
			});

			const response = await app.request(
				`/organizations/${organization.slug}/admin/customers/cust-1/checkout-intents`,
				{ headers: { Authorization: "Bearer admin" } },
			);
			expect(response.status).toBe(200);

			const body = (await response.json()) as {
				intents: RecoverableCheckoutIntentRecord[];
			};
			expect(body.intents).toBeDefined();
			const ids = body.intents.map((i) => i.id);
			expect(ids).toContain("intent-ready");
			expect(ids).toContain("intent-failed");
			expect(ids).toContain("intent-started");
			expect(ids).not.toContain("intent-approved");
			expect(ids).not.toContain("intent-superseded");
			expect(ids).not.toContain("intent-cust2");
			expect(ids).not.toContain("intent-paid-order");
		});
	});

	describe("Idempotent invalidation", () => {
		it("invalidates intent idempotently and cancels pending recovery requests", async () => {
			const { app, organization, recoveryRepo } = await createTestContext();
			const orgId = organization.id;

			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-to-inv",
					organizationId: orgId,
					customerId: "cust-1",
					status: "ready",
				}),
			);

			const first = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-to-inv/invalidate`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"X-CSRF-Token": "test-csrf",
					},
				},
			);
			expect(first.status).toBe(200);
			const firstBody = (await first.json()) as { success: boolean };
			expect(firstBody.success).toBe(true);

			const second = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-to-inv/invalidate`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"X-CSRF-Token": "test-csrf",
					},
				},
			);
			expect(second.status).toBe(200);
			const secondBody = (await second.json()) as { success: boolean };
			expect(secondBody.success).toBe(true);

			const remaining = await recoveryRepo.listRecoverableIntents(
				orgId,
				"cust-1",
			);
			expect(remaining.map((r) => r.id)).not.toContain("intent-to-inv");
		});

		it("returns 404 for unknown intent ID", async () => {
			const { app, organization } = await createTestContext();
			const res = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/non-existent/invalidate`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"X-CSRF-Token": "test-csrf",
					},
				},
			);
			expect(res.status).toBe(404);
		});
	});

	describe("Recovery request creation with token generation & PII-minimized audit logging", () => {
		it("creates recovery request with crypto token and returns recovery URL", async () => {
			const { app, organization, recoveryRepo, auditLogger } =
				await createTestContext();
			const orgId = organization.id;

			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-rec",
					organizationId: orgId,
					customerId: "cust-1",
					status: "failed",
				}),
			);

			const res = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-rec/recover`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"X-CSRF-Token": "test-csrf",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ customerId: "cust-1" }),
				},
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				recoveryUrl: string;
				rawToken: string;
				tokenHash: string;
				recoveryRequest: { id: string; status: string; tokenHash: string };
			};

			expect(body.rawToken).toBeDefined();
			expect(typeof body.rawToken).toBe("string");
			// 32 bytes in base64url is 43 characters
			expect(body.rawToken.length).toBe(43);

			const expectedHash = createHash("sha256")
				.update(body.rawToken)
				.digest("hex");
			expect(body.tokenHash).toBe(expectedHash);
			expect(body.recoveryRequest.tokenHash).toBe(expectedHash);
			expect(body.recoveryRequest.status).toBe("pending");

			expect(body.recoveryUrl).toBe(
				`/org/${organization.slug}/checkout-recovery/${body.rawToken}`,
			);

			const auditEvent = auditLogger.events.find(
				(e) => e.action === "create_recovery",
			);
			expect(auditEvent).toBeDefined();
			expect(auditEvent?.actorUid).toBe("uid-admin");
			expect(auditEvent?.organizationId).toBe(orgId);
			expect(auditEvent?.targetCustomerId).toBe("cust-1");
			expect(auditEvent?.intentId).toBe("intent-rec");
			expect(auditEvent?.tokenHash).toBe(expectedHash);

			// PII-minimized: verify rawToken and customer PII are not in the audit record
			expect(JSON.stringify(auditEvent)).not.toContain(body.rawToken);
			expect(JSON.stringify(auditEvent)).not.toContain("admin@example.com");
		});

		it("cancels prior pending recovery request on re-recovery", async () => {
			const { app, organization, recoveryRepo } = await createTestContext();
			const orgId = organization.id;

			recoveryRepo.addIntent(
				makeIntent({
					id: "intent-rec-twice",
					organizationId: orgId,
					customerId: "cust-1",
					status: "failed",
				}),
			);

			const first = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-rec-twice/recover`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"X-CSRF-Token": "test-csrf",
					},
				},
			);
			const firstBody = (await first.json()) as { tokenHash: string };

			const second = await app.request(
				`/organizations/${organization.slug}/admin/checkout-intents/intent-rec-twice/recover`,
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"X-CSRF-Token": "test-csrf",
					},
				},
			);
			const secondBody = (await second.json()) as { tokenHash: string };

			const priorRecord = await recoveryRepo.findRecoveryRequestByTokenHash(
				firstBody.tokenHash,
			);
			expect(priorRecord?.status).toBe("cancelled");

			const latestRecord = await recoveryRepo.findRecoveryRequestByTokenHash(
				secondBody.tokenHash,
			);
			expect(latestRecord?.status).toBe("pending");
		});
	});
});
