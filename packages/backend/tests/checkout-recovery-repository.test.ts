import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRecoveryRepository } from "../src/checkout/checkout-recovery-repository.js";
import type { CheckoutIntentRecord } from "../src/checkout/checkout-repository.js";
import { PostgresCheckoutRecoveryRepository } from "../src/checkout/postgres-checkout-recovery-repository.js";
import { buildCanonicalPostgresSchemaSql } from "../src/repo/postgres-schema.js";

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

async function postgresRepositorySource(): Promise<string> {
	return (
		await Bun.file(
			new URL(
				"../src/checkout/postgres-checkout-recovery-repository.ts",
				import.meta.url,
			),
		).text()
	).replace(/\r\n/g, "\n");
}

describe("CheckoutRecoveryRepository", () => {
	describe("InMemoryCheckoutRecoveryRepository", () => {
		it("lists recoverable intents for customer excluding approved or superseded", async () => {
			const repo = new InMemoryCheckoutRecoveryRepository();
			repo.addIntent(
				makeIntent({
					id: "intent-ready",
					correlationId: "c-1",
					status: "ready",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-failed",
					correlationId: "c-2",
					status: "failed",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-expired",
					correlationId: "c-3",
					status: "expired",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-started",
					correlationId: "c-4",
					status: "checkout_started",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-approved",
					correlationId: "c-5",
					status: "approved",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-superseded",
					correlationId: "c-6",
					status: "superseded",
				}),
			);

			const results = await repo.listRecoverableIntents({
				organizationId: "org-1",
				customerId: "cust-1",
			});
			const ids = results.map((r) => r.id);
			expect(ids).toContain("intent-ready");
			expect(ids).toContain("intent-failed");
			expect(ids).toContain("intent-expired");
			expect(ids).toContain("intent-started");
			expect(ids).not.toContain("intent-approved");
			expect(ids).not.toContain("intent-superseded");
		});

		it("excludes intents with completed order projection from recoverable listing", async () => {
			const repo = new InMemoryCheckoutRecoveryRepository();
			repo.addIntent(
				makeIntent({
					id: "intent-has-order",
					correlationId: "corr-paid",
					status: "ready",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-recoverable",
					correlationId: "corr-clean",
					status: "ready",
				}),
			);
			repo.addOrderProjection({
				organizationId: "org-1",
				correlationId: "corr-paid",
			});

			const results = await repo.listRecoverableIntents("org-1", "cust-1");
			expect(results.map((r) => r.id)).toEqual(["intent-recoverable"]);
		});

		it("excludes intents with class or membership entitlement from recoverable listing", async () => {
			const repo = new InMemoryCheckoutRecoveryRepository();
			repo.addIntent(
				makeIntent({
					id: "intent-class",
					correlationId: "c-class",
					status: "ready",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-member",
					correlationId: "c-member",
					status: "ready",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-ok",
					correlationId: "c-ok",
					status: "ready",
				}),
			);

			repo.addClassEntitlement({
				organizationId: "org-1",
				checkoutIntentId: "intent-class",
			});
			repo.addMembershipEntitlement({
				organizationId: "org-1",
				checkoutIntentId: "intent-member",
			});

			const results = await repo.listRecoverableIntents({
				organizationId: "org-1",
				customerId: "cust-1",
			});
			expect(results.map((r) => r.id)).toEqual(["intent-ok"]);
		});

		it("enforces tenant and customer isolation when listing recoverable intents", async () => {
			const repo = new InMemoryCheckoutRecoveryRepository();
			repo.addIntent(
				makeIntent({
					id: "intent-org1-cust1",
					organizationId: "org-1",
					customerId: "cust-1",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-org2-cust1",
					organizationId: "org-2",
					customerId: "cust-1",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-org1-cust2",
					organizationId: "org-1",
					customerId: "cust-2",
				}),
			);

			const results = await repo.listRecoverableIntents({
				organizationId: "org-1",
				customerId: "cust-1",
			});
			expect(results.map((r) => r.id)).toEqual(["intent-org1-cust1"]);
		});

		it("atomically invalidates intent and cancels pending recovery requests", async () => {
			const repo = new InMemoryCheckoutRecoveryRepository();
			repo.addIntent(makeIntent({ id: "intent-inv", status: "ready" }));
			const request = await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "intent-inv",
				tokenHash: "token-hash-1",
				requestedByActorUid: "admin-uid",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});
			expect(request.status).toBe("pending");

			await repo.invalidateIntent({
				organizationId: "org-1",
				intentId: "intent-inv",
			});

			const updatedReq =
				await repo.findRecoveryRequestByTokenHash("token-hash-1");
			expect(updatedReq?.status).toBe("cancelled");

			const recoverable = await repo.listRecoverableIntents("org-1", "cust-1");
			expect(recoverable).toHaveLength(0);
		});

		it("guards against invalidation if order projection or entitlement exists", async () => {
			const repo = new InMemoryCheckoutRecoveryRepository();
			repo.addIntent(
				makeIntent({
					id: "intent-order",
					correlationId: "corr-order",
					status: "ready",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-entitlement",
					correlationId: "corr-ent",
					status: "ready",
				}),
			);

			repo.addOrderProjection({
				organizationId: "org-1",
				correlationId: "corr-order",
			});
			repo.addClassEntitlement({
				organizationId: "org-1",
				checkoutIntentId: "intent-entitlement",
			});

			await expect(
				repo.invalidateIntent({
					organizationId: "org-1",
					intentId: "intent-order",
				}),
			).rejects.toThrow("Cannot invalidate checkout intent");

			await expect(
				repo.invalidateIntent({
					organizationId: "org-1",
					intentId: "intent-entitlement",
				}),
			).rejects.toThrow("Cannot invalidate checkout intent");
		});

		it("creates recovery request, cancels previous pending request, and guards against order", async () => {
			const repo = new InMemoryCheckoutRecoveryRepository();
			repo.addIntent(makeIntent({ id: "intent-rec", status: "failed" }));

			const first = await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "intent-rec",
				tokenHash: "hash-first",
				requestedByActorUid: "admin-uid",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});
			expect(first.status).toBe("pending");

			const second = await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "intent-rec",
				tokenHash: "hash-second",
				requestedByActorUid: "admin-uid",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});
			expect(second.status).toBe("pending");

			const firstUpdated =
				await repo.findRecoveryRequestByTokenHash("hash-first");
			expect(firstUpdated?.status).toBe("cancelled");

			repo.addOrderProjection({
				organizationId: "org-1",
				correlationId: "corr-1",
			});
			await expect(
				repo.createRecoveryRequest({
					organizationId: "org-1",
					customerId: "cust-1",
					sourceCheckoutIntentId: "intent-rec",
					tokenHash: "hash-third",
					requestedByActorUid: "admin-uid",
					expiresAtIso: "2030-01-01T00:00:00.000Z",
				}),
			).rejects.toThrow("Cannot recover checkout intent");
		});

		it("looks up recovery request by token hash and handles expiration", async () => {
			const repo = new InMemoryCheckoutRecoveryRepository();
			repo.addIntent(
				makeIntent({
					id: "intent-active",
					correlationId: "c-active",
					status: "failed",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-exp",
					correlationId: "c-exp",
					status: "failed",
				}),
			);

			await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "intent-active",
				tokenHash: "hash-active",
				requestedByActorUid: "admin-uid",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});

			await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "intent-exp",
				tokenHash: "hash-expired",
				requestedByActorUid: "admin-uid",
				expiresAtIso: "2020-01-01T00:00:00.000Z",
			});

			const active = await repo.findRecoveryRequestByTokenHash("hash-active");
			expect(active).not.toBeNull();
			expect(active?.tokenHash).toBe("hash-active");
			expect(active?.status).toBe("pending");

			const activeWithWrongOrg = await repo.findRecoveryRequestByTokenHash(
				"hash-active",
				"wrong-org",
			);
			expect(activeWithWrongOrg).toBeNull();

			const expired = await repo.findRecoveryRequestByTokenHash("hash-expired");
			expect(expired).not.toBeNull();
			expect(expired?.status).toBe("expired");

			const nonExistent =
				await repo.findRecoveryRequestByTokenHash("hash-unknown");
			expect(nonExistent).toBeNull();
		});

		it("consumes recovery request and rejects repeated or expired consumption", async () => {
			const repo = new InMemoryCheckoutRecoveryRepository();
			repo.addIntent(
				makeIntent({
					id: "intent-consume-valid",
					correlationId: "c-cv",
					status: "ready",
				}),
			);
			repo.addIntent(
				makeIntent({
					id: "intent-consume-past",
					correlationId: "c-cp",
					status: "ready",
				}),
			);

			await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "intent-consume-valid",
				tokenHash: "hash-valid",
				requestedByActorUid: "admin-uid",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});

			await repo.createRecoveryRequest({
				organizationId: "org-1",
				customerId: "cust-1",
				sourceCheckoutIntentId: "intent-consume-past",
				tokenHash: "hash-past",
				requestedByActorUid: "admin-uid",
				expiresAtIso: "2025-01-01T00:00:00.000Z",
			});

			const consumed = await repo.consumeRecoveryRequest({
				tokenHash: "hash-valid",
				organizationId: "org-1",
				consumedAtIso: "2026-09-27T12:00:00.000Z",
			});
			expect(consumed.status).toBe("consumed");
			expect(consumed.consumedAtIso).toBe("2026-09-27T12:00:00.000Z");

			await expect(
				repo.consumeRecoveryRequest({
					tokenHash: "hash-valid",
					organizationId: "org-1",
				}),
			).rejects.toThrow("Recovery request is not pending");

			await expect(
				repo.consumeRecoveryRequest({
					tokenHash: "hash-past",
					organizationId: "org-1",
					consumedAtIso: "2026-09-27T12:00:00.000Z",
				}),
			).rejects.toThrow("Recovery request has expired");
		});
	});

	describe("PostgresCheckoutRecoveryRepository structure and schema", () => {
		it("defines checkout_recovery_requests schema with tenant isolation and required indexes", () => {
			const sql = buildCanonicalPostgresSchemaSql("public");
			expect(sql).toContain(
				"CREATE TABLE IF NOT EXISTS public.checkout_recovery_requests",
			);
			expect(sql).toContain(
				"source_checkout_intent_id TEXT NOT NULL REFERENCES public.checkout_intents",
			);
			expect(sql).toContain("token_hash TEXT NOT NULL");
			expect(sql).toContain("idx_recovery_requests_org_cust");
			expect(sql).toContain("idx_recovery_requests_token_hash");
		});

		it("rejects unsafe schema names", () => {
			expect(
				() =>
					new PostgresCheckoutRecoveryRepository("public; DROP TABLE users"),
			).toThrow("Database schema is invalid.");
		});

		it("strictly adheres to file line boundaries (< 400 lines)", async () => {
			const source = await postgresRepositorySource();
			const lines = source.split("\n").length;
			expect(lines).toBeLessThan(400);
		});

		it("implements row locking FOR UPDATE, strict tenant isolation, and atomic state guards", async () => {
			const source = await postgresRepositorySource();
			expect(source).toContain("FOR UPDATE");
			expect(source).toContain("organization_id = $1");
			expect(source).toContain("shopify_order_projections");
			expect(source).toContain("class_entitlements");
			expect(source).toContain("teacher_membership_entitlement_details");
			expect(source).toContain("status = 'superseded'");
			expect(source).toContain("status = 'cancelled'");
			expect(source).toContain("status = 'consumed'");
		});
	});
});
