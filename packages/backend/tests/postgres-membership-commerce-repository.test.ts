import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";

async function source() {
	return Bun.file(
		new URL(
			"../src/commerce/postgres-membership-commerce-repository.ts",
			import.meta.url,
		),
	).text();
}

describe("PostgresMembershipCommerceRepository", () => {
	it("rechecks entitlement cohorts after taking the customer finalization lock", async () => {
		const value = await source();

		expect(value).toContain("let finalDecision = input.decision;");
		expect(value).toContain(
			"membership_entitlement_cohorts SET version=version+1",
		);
		expect(value).toContain("refreshedCohort");
		expect(value).toContain(
			"Entitlement cohort compare-and-swap retry failed.",
		);
		expect(value).toContain("refreshedEntitlements");
		expect(value).toContain('reasonCode: "duplicate_purchase"');
		expect(value).toContain("grantInput = undefined;");
		expect(value).toContain("startsOn,");
	});

	it("checks scheduled entitlements within the requested class only", async () => {
		const value = await source();
		const scheduledCheck = value.slice(
			value.indexOf("async hasScheduledEntitlement("),
			value.indexOf("async listCustomerDecisions("),
		);

		expect(scheduledCheck).toContain("entitlement_class = $3");
		expect(scheduledCheck).toContain(
			"[organizationId, customerId, entitlementClass, today]",
		);
	});

	describe("class entitlement capacity queries and allocation metadata", () => {
		let repo: PostgresMembershipCommerceRepository;
		let unsafeSpy: ReturnType<typeof spyOn>;

		beforeEach(() => {
			repo = new PostgresMembershipCommerceRepository("test_schema");
			spyOn(repo, "ensureReady").mockResolvedValue();
			unsafeSpy = spyOn(sql, "unsafe");
		});

		afterEach(() => {
			unsafeSpy.mockRestore();
		});

		it("countConfirmedClassEntitlements queries confirmed status only and returns numeric count", async () => {
			unsafeSpy.mockResolvedValueOnce([{ count: "4" }]);

			const count = await repo.countConfirmedClassEntitlements(
				"org-1",
				"class-1",
			);

			expect(count).toBe(4);
			expect(unsafeSpy).toHaveBeenCalledWith(
				"SELECT COUNT(*)::int AS count FROM test_schema.class_entitlements WHERE organization_id = $1 AND festival_class_id = $2 AND status = 'confirmed'",
				["org-1", "class-1"],
			);
		});

		it("createClassEntitlement persists and maps allocation metadata columns", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "ent-1",
					organization_id: "org-1",
					festival_id: "fest-1",
					festival_class_id: "class-1",
					parent_customer_id: "cust-1",
					child_id: "child-1",
					checkout_intent_id: "intent-1",
					checkout_intent_line_id: "line-1",
					shopify_order_gid: "gid://shopify/Order/10",
					shopify_order_line_gid: "gid://shopify/LineItem/10",
					paid_amount_cents: 4500,
					paid_currency_code: "USD",
					status: "confirmed",
					admitted_cart_reference: "cart-ref-1",
					capacity_at_allocation: 20,
					placed_count_before_allocation: 19,
					created_at: "2026-01-01T00:00:00.000Z",
					updated_at: "2026-01-01T00:00:00.000Z",
				},
			]);

			const result = await repo.createClassEntitlement({
				id: "ent-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-1",
				parentCustomerId: "cust-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				checkoutIntentLineId: "line-1",
				shopifyOrderGid: "gid://shopify/Order/10",
				shopifyOrderLineGid: "gid://shopify/LineItem/10",
				paidAmountCents: 4500,
				paidCurrencyCode: "USD",
				status: "confirmed",
				admittedCartReference: "cart-ref-1",
				capacityAtAllocation: 20,
				placedCountBeforeAllocation: 19,
			});

			expect(result).toEqual({
				id: "ent-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-1",
				parentCustomerId: "cust-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				checkoutIntentLineId: "line-1",
				shopifyOrderGid: "gid://shopify/Order/10",
				shopifyOrderLineGid: "gid://shopify/LineItem/10",
				paidAmountCents: 4500,
				paidCurrencyCode: "USD",
				status: "confirmed",
				admittedCartReference: "cart-ref-1",
				capacityAtAllocation: 20,
				placedCountBeforeAllocation: 19,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			});
			expect(unsafeSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"admitted_cart_reference, capacity_at_allocation, placed_count_before_allocation",
				),
				[
					"ent-1",
					"org-1",
					"fest-1",
					"class-1",
					"cust-1",
					"child-1",
					"intent-1",
					"line-1",
					"gid://shopify/Order/10",
					"gid://shopify/LineItem/10",
					4500,
					"USD",
					"confirmed",
					"cart-ref-1",
					20,
					19,
				],
			);
		});
	});
});
