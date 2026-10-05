import { describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import {
	InMemoryClassEntitlementRepository,
	PostgresClassEntitlementRepository,
} from "../src/commerce/class-entitlement-repository.js";

describe("Issue #266: Class Entitlement Intent Line Invariant", () => {
	const baseInput = {
		organizationId: "org-1",
		festivalId: "fest-1",
		festivalClassId: "class-1",
		parentCustomerId: "cust-1",
		childId: "child-1",
		checkoutIntentId: "intent-1",
		checkoutIntentLineId: "line-1",
		shopifyOrderGid: "gid://shopify/Order/1",
		shopifyOrderLineGid: "gid://shopify/LineItem/101",
		paidAmountCents: 5000,
		paidCurrencyCode: "USD",
	};

	describe("InMemoryClassEntitlementRepository", () => {
		it("creates a class entitlement with checkoutIntentLineId", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			const ent = await repo.createClassEntitlement(baseInput);

			expect(ent.id).toBeDefined();
			expect(ent.checkoutIntentLineId).toBe("line-1");
			expect(ent.shopifyOrderLineGid).toBe("gid://shopify/LineItem/101");

			const retrieved = await repo.findClassEntitlementByIntentLineId(
				"org-1",
				"line-1",
			);
			expect(retrieved).not.toBeNull();
			expect(retrieved?.id).toBe(ent.id);
		});

		it("rejects duplicate intent line insertion when order line GID differs (fail closed)", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			await repo.createClassEntitlement(baseInput);

			const duplicateLineDifferentOrder = {
				...baseInput,
				shopifyOrderGid: "gid://shopify/Order/2",
				shopifyOrderLineGid: "gid://shopify/LineItem/999", // Different order line!
			};

			await expect(
				repo.createClassEntitlement(duplicateLineDifferentOrder),
			).rejects.toThrow(
				"Class entitlement conflict: checkout intent line already fulfilled by a different order line.",
			);
		});

		it("allows idempotent replay when matching intent line has same order line GID", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			const original = await repo.createClassEntitlement(baseInput);

			const replay = await repo.createClassEntitlement({
				...baseInput,
				id: "different-client-id", // Should be ignored in favor of existing
			});

			expect(replay.id).toBe(original.id);
			expect(replay.shopifyOrderLineGid).toBe(original.shopifyOrderLineGid);

			const all = await repo.listClassEntitlements({ organizationId: "org-1" });
			expect(all).toHaveLength(1);
		});

		it("enforces tenant isolation on (organizationId, checkoutIntentLineId)", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			const org1Ent = await repo.createClassEntitlement(baseInput);

			const org2Ent = await repo.createClassEntitlement({
				...baseInput,
				organizationId: "org-2",
				shopifyOrderLineGid: "gid://shopify/LineItem/202",
			});

			expect(org1Ent.id).not.toBe(org2Ent.id);
			const org1Lookup = await repo.findClassEntitlementByIntentLineId(
				"org-1",
				"line-1",
			);
			const org2Lookup = await repo.findClassEntitlementByIntentLineId(
				"org-2",
				"line-1",
			);
			expect(org1Lookup?.organizationId).toBe("org-1");
			expect(org2Lookup?.organizationId).toBe("org-2");
		});

		it("allows multiple null checkoutIntentLineId records if order line differs", async () => {
			const repo = new InMemoryClassEntitlementRepository();
			const ent1 = await repo.createClassEntitlement({
				...baseInput,
				checkoutIntentLineId: null,
				shopifyOrderLineGid: "gid://shopify/LineItem/null-1",
			});
			const ent2 = await repo.createClassEntitlement({
				...baseInput,
				checkoutIntentLineId: null,
				shopifyOrderLineGid: "gid://shopify/LineItem/null-2",
			});

			expect(ent1.id).not.toBe(ent2.id);
			const all = await repo.listClassEntitlements({ organizationId: "org-1" });
			expect(all).toHaveLength(2);
		});
	});

	describe("PostgresClassEntitlementRepository", () => {
		it("uses ON CONFLICT DO NOTHING and handles idempotent replay vs closed conflict", async () => {
			const repo = new PostgresClassEntitlementRepository("test_schema");
			spyOn(repo, "ensureReady").mockResolvedValue(undefined);
			const unsafeSpy = spyOn(sql, "unsafe");

			try {
				// 1. First call: INSERT returns nothing (simulating conflict on index)
				// 2. findClassEntitlementByIntentLineId returns existing record with SAME order line
				unsafeSpy
					.mockResolvedValueOnce([]) // INSERT returns [] (conflict occurred)
					.mockResolvedValueOnce([
						{
							id: "existing-ent-id",
							organization_id: "org-1",
							festival_id: "fest-1",
							festival_class_id: "class-1",
							parent_customer_id: "cust-1",
							child_id: "child-1",
							checkout_intent_id: "intent-1",
							checkout_intent_line_id: "line-1",
							shopify_order_gid: "gid://shopify/Order/1",
							shopify_order_line_gid: "gid://shopify/LineItem/101",
							paid_amount_cents: 5000,
							paid_currency_code: "USD",
							status: "confirmed",
							created_at: new Date().toISOString(),
							updated_at: new Date().toISOString(),
						},
					]);

				const result = await repo.createClassEntitlement(baseInput);
				expect(result.id).toBe("existing-ent-id");

				// Now test conflict with DIFFERENT order line
				unsafeSpy
					.mockResolvedValueOnce([]) // INSERT returns []
					.mockResolvedValueOnce([
						{
							id: "existing-ent-id",
							organization_id: "org-1",
							festival_id: "fest-1",
							festival_class_id: "class-1",
							parent_customer_id: "cust-1",
							child_id: "child-1",
							checkout_intent_id: "intent-1",
							checkout_intent_line_id: "line-1",
							shopify_order_gid: "gid://shopify/Order/1",
							shopify_order_line_gid: "gid://shopify/LineItem/101", // Different from 999
							paid_amount_cents: 5000,
							paid_currency_code: "USD",
							status: "confirmed",
							created_at: new Date().toISOString(),
							updated_at: new Date().toISOString(),
						},
					]);

				await expect(
					repo.createClassEntitlement({
						...baseInput,
						shopifyOrderLineGid: "gid://shopify/LineItem/999",
					}),
				).rejects.toThrow(
					"Class entitlement conflict: checkout intent line already fulfilled by a different order line.",
				);
			} finally {
				unsafeSpy.mockRestore();
			}
		});

		it("findClassEntitlementByIntentLineId queries database with organizationId and lineId", async () => {
			const repo = new PostgresClassEntitlementRepository("test_schema");
			spyOn(repo, "ensureReady").mockResolvedValue(undefined);
			const unsafeSpy = spyOn(sql, "unsafe");

			try {
				unsafeSpy.mockResolvedValueOnce([
					{
						id: "found-ent",
						organization_id: "org-1",
						festival_id: "fest-1",
						festival_class_id: "class-1",
						parent_customer_id: "cust-1",
						child_id: "child-1",
						checkout_intent_id: "intent-1",
						checkout_intent_line_id: "line-1",
						shopify_order_gid: "gid://shopify/Order/1",
						shopify_order_line_gid: "gid://shopify/LineItem/101",
						paid_amount_cents: 5000,
						paid_currency_code: "USD",
						status: "confirmed",
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
					},
				]);

				const ent = await repo.findClassEntitlementByIntentLineId(
					"org-1",
					"line-1",
				);
				expect(ent).not.toBeNull();
				expect(ent?.id).toBe("found-ent");
				expect(unsafeSpy).toHaveBeenCalledWith(
					expect.stringContaining("checkout_intent_line_id = $2"),
					["org-1", "line-1"],
				);
			} finally {
				unsafeSpy.mockRestore();
			}
		});
	});
});
