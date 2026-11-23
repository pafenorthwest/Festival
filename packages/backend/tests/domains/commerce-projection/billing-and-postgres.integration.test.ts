import { describe, expect, it, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { InMemoryBillingRepository } from "../../../src/billing/billing-repository.js";
import {
	BillingService,
	PostgresBillingRepository,
	PostgresClassEntitlementRepository,
	PostgresOrderProjectionRepository,
	PostgresShopifyIntegrationRepository,
	PostgresWebhookDeliveryRepository,
} from "../../../src/domains/commerce-projection/index.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "../../postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("domain_commerce_proj");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

describe("commerce-projection BillingService and Postgres 17 repositories", () => {
	it("enforces authority boundary for decision/membership references and returns idempotent outcome", async () => {
		const billing = new BillingService(new InMemoryBillingRepository());
		await expect(
			billing.applyAdjustment({
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "refund",
				amountCents: 1500,
				currencyCode: "USD",
				reason: "Membership adjustment",
				referenceType: "membership",
				referenceId: "mem-1",
			}),
		).rejects.toThrow("Approved decision ID is required");

		const first = await billing.applyAdjustment({
			organizationId: "org-1",
			customerId: "cust-1",
			adminUserId: "admin-1",
			adjustmentType: "credit_issue",
			amountCents: 2500,
			currencyCode: "USD",
			reason: "Goodwill",
			referenceType: "order",
			referenceId: "ord-1",
		});
		expect(first.alreadyExisted).toBe(false);
		expect(first.creditBalance.balanceCents).toBe(2500);

		const replay = await billing.applyAdjustment({
			organizationId: "org-1",
			customerId: "cust-1",
			adminUserId: "admin-1",
			adjustmentType: "credit_issue",
			amountCents: 2500,
			currencyCode: "USD",
			reason: "Goodwill",
			referenceType: "order",
			referenceId: "ord-1",
		});
		expect(replay.alreadyExisted).toBe(true);
		expect(replay.adjustment.id).toBe(first.adjustment.id);
	});

	integrationTest(
		"round-trips all 5 domain Postgres repositories against Postgres 17",
		async () => {
			const schema = await currentSchema();
			try {
				const orgId = randomUUID();
				const userId = randomUUID();
				const customerId = randomUUID();
				await sql`INSERT INTO ${sql(`${schema}.organizations`)} (id, name, slug) VALUES (${orgId}, 'Domain PG Org', ${`dom-${orgId}`})`;
				await sql`INSERT INTO ${sql(`${schema}.users`)} (id, firebase_uid, email, display_name) VALUES (${userId}, ${`fb-${userId}`}, ${`admin-${userId}@example.com`}, 'Domain Admin')`;

				const integrations = new PostgresShopifyIntegrationRepository(schema);
				const savedIntegration = await integrations.upsertShopifyIntegration({
					organizationId: orgId,
					storeDomain: "domain-pg.myshopify.com",
					clientId: "cid-pg",
					encryptedClientSecret: "enc-secret-1",
				});
				expect(savedIntegration.integrationVersion).toBe(1);
				await integrations.updateShopifyVerification({
					organizationId: orgId,
					verificationStatus: "ok",
					verifiedShopGid: "gid://shopify/Shop/55",
					verifiedShopDomain: "domain-pg.myshopify.com",
					grantedScopes: ["read_orders", "read_products"],
					capabilities: {
						read_products: "granted",
						write_products: "missing",
						write_inventory: "missing",
						read_orders: "granted",
						write_orders: "disabled",
					},
					lastTestedAtIso: "2026-10-01T00:00:00.000Z",
					verifiedAtIso: "2026-10-01T00:00:00.000Z",
				});
				expect(
					(
						await integrations.findOrganizationByShopDomain(
							"domain-pg.myshopify.com",
						)
					)?.id,
				).toBe(orgId);

				const deliveries = new PostgresWebhookDeliveryRepository(schema);
				const delivery = await deliveries.recordDelivery({
					organizationId: orgId,
					shopDomain: "domain-pg.myshopify.com",
					webhookId: "wh-dom-1",
					topic: "orders/paid",
					apiVersion: "2026-07",
					shopifyOrderGid: "gid://shopify/Order/701",
					payloadSha256: "c".repeat(64),
					receivedAtIso: "2026-10-01T00:01:00.000Z",
				});
				if (delivery.kind !== "accepted") {
					throw new Error("Expected accepted delivery.");
				}
				expect(
					await deliveries.claimDelivery(delivery.delivery.id),
				).toMatchObject({
					status: "processing",
					attemptCount: 1,
				});

				const orderRepo = new PostgresOrderProjectionRepository(schema);
				const pending = await orderRepo.recordPendingDecision({
					organizationId: orgId,
					shopifyOrderGid: "gid://shopify/Order/701",
					updatedAtIso: "2026-10-01T00:01:01.000Z",
				});
				expect(pending.status).toBe("pending_validation");

				const manual = await orderRepo.resolveDecisionManually({
					organizationId: orgId,
					decisionId: pending.id,
					finalStatus: "rejected",
					actorUserId: userId,
					note: "Reviewed and rejected in integration test",
					resolvedAtIso: "2026-10-01T00:02:00.000Z",
				});
				expect(manual.decision.status).toBe("rejected");
				expect(manual.audit.actorUserId).toBe(userId);

				const entitlementRepo = new PostgresClassEntitlementRepository(schema);
				expect(
					await entitlementRepo.countConfirmedClassEntitlements(
						orgId,
						randomUUID(),
					),
				).toBe(0);

				const billingRepo = new PostgresBillingRepository(schema);
				const billingSvc = new BillingService(billingRepo);
				const adj = await billingSvc.applyAdjustment({
					organizationId: orgId,
					customerId,
					adminUserId: userId,
					adjustmentType: "credit_issue",
					amountCents: 4000,
					currencyCode: "USD",
					reason: "PG smoke",
				});
				expect(adj.creditBalance.balanceCents).toBe(4000);
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
