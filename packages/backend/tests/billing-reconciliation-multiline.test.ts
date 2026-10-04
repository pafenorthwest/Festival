import { describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import {
	InMemoryBillingRepository,
	PostgresBillingRepository,
} from "../src/billing/index.js";

describe("Issue #261: Multi-line Commerce Billing Reconciliation", () => {
	describe("InMemoryBillingRepository", () => {
		it("does not generate false partial payment mismatches for multi-line purchase ($50 + $40 = $90)", async () => {
			const repo = new InMemoryBillingRepository();

			// Parent checkout intent with total $90
			repo.seedCheckoutIntents([
				{
					id: "intent-multi",
					correlationId: "corr-multi",
					organizationId: "org-1",
					customerId: "cust-1",
					amount: "90.00",
					currencyCode: "USD",
				},
			]);

			// Two lines: line 1 = $50, line 2 = $40
			repo.seedCheckoutIntentLines([
				{
					id: "line-1",
					checkoutIntentId: "intent-multi",
					amount: "50.00",
					currencyCode: "USD",
				},
				{
					id: "line-2",
					checkoutIntentId: "intent-multi",
					amount: "40.00",
					currencyCode: "USD",
				},
			]);

			// Entitlement 1: $50 paid for line 1
			// Entitlement 2: $40 paid for line 2
			repo.seedClassEntitlements([
				{
					id: "ent-line-1",
					organizationId: "org-1",
					parentCustomerId: "cust-1",
					checkoutIntentId: "intent-multi",
					checkoutIntentLineId: "line-1",
					shopifyOrderGid: "gid://shopify/Order/100",
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "confirmed",
				},
				{
					id: "ent-line-2",
					organizationId: "org-1",
					parentCustomerId: "cust-1",
					checkoutIntentId: "intent-multi",
					checkoutIntentLineId: "line-2",
					shopifyOrderGid: "gid://shopify/Order/100",
					paidAmountCents: 4000,
					paidCurrencyCode: "USD",
					status: "confirmed",
				},
			]);

			const mismatches = await repo.listMismatches("org-1");
			// Neither $50 nor $40 should be flagged as partial against the $90 total
			const partialPayments = mismatches.filter(
				(m) => m.mismatchType === "partial_payment",
			);
			expect(partialPayments).toHaveLength(0);
		});

		it("flags genuine underpayment on a specific line item in a multi-line purchase", async () => {
			const repo = new InMemoryBillingRepository();

			repo.seedCheckoutIntents([
				{
					id: "intent-multi-2",
					correlationId: "corr-multi-2",
					organizationId: "org-1",
					customerId: "cust-2",
					amount: "90.00",
					currencyCode: "USD",
				},
			]);

			repo.seedCheckoutIntentLines([
				{
					id: "line-2a",
					checkoutIntentId: "intent-multi-2",
					amount: "50.00",
					currencyCode: "USD",
				},
				{
					id: "line-2b",
					checkoutIntentId: "intent-multi-2",
					amount: "40.00",
					currencyCode: "USD",
				},
			]);

			// Line 2a: paid 3000 cents ($30) instead of 5000 cents ($50) -> Genuine underpayment!
			// Line 2b: paid 4000 cents ($40) -> Fully paid for line
			repo.seedClassEntitlements([
				{
					id: "ent-underpaid",
					organizationId: "org-1",
					parentCustomerId: "cust-2",
					checkoutIntentId: "intent-multi-2",
					checkoutIntentLineId: "line-2a",
					shopifyOrderGid: "gid://shopify/Order/101",
					paidAmountCents: 3000,
					paidCurrencyCode: "USD",
					status: "confirmed",
				},
				{
					id: "ent-fully-paid",
					organizationId: "org-1",
					parentCustomerId: "cust-2",
					checkoutIntentId: "intent-multi-2",
					checkoutIntentLineId: "line-2b",
					shopifyOrderGid: "gid://shopify/Order/101",
					paidAmountCents: 4000,
					paidCurrencyCode: "USD",
					status: "confirmed",
				},
			]);

			const mismatches = await repo.listMismatches("org-1");
			const partialPayments = mismatches.filter(
				(m) => m.mismatchType === "partial_payment",
			);
			expect(partialPayments).toHaveLength(1);
			expect(partialPayments[0].entitlementId).toBe("ent-underpaid");
			expect(partialPayments[0].amountCents).toBe(3000);
		});

		it("flags currency mismatch between line item and class entitlement", async () => {
			const repo = new InMemoryBillingRepository();

			repo.seedCheckoutIntents([
				{
					id: "intent-curr",
					correlationId: "corr-curr",
					organizationId: "org-1",
					customerId: "cust-3",
					amount: "50.00",
					currencyCode: "CAD",
				},
			]);
			repo.seedCheckoutIntentLines([
				{
					id: "line-curr",
					checkoutIntentId: "intent-curr",
					amount: "50.00",
					currencyCode: "CAD",
				},
			]);
			repo.seedClassEntitlements([
				{
					id: "ent-curr",
					organizationId: "org-1",
					parentCustomerId: "cust-3",
					checkoutIntentId: "intent-curr",
					checkoutIntentLineId: "line-curr",
					shopifyOrderGid: "gid://shopify/Order/102",
					paidAmountCents: 5000,
					paidCurrencyCode: "USD", // Mismatch with CAD
					status: "confirmed",
				},
			]);

			const mismatches = await repo.listMismatches("org-1");
			const partialPayments = mismatches.filter(
				(m) => m.mismatchType === "partial_payment",
			);
			expect(partialPayments).toHaveLength(1);
			expect(partialPayments[0].entitlementId).toBe("ent-curr");
		});

		it("falls back to parent checkout intent total for legacy intents without line items", async () => {
			const repo = new InMemoryBillingRepository();

			repo.seedCheckoutIntents([
				{
					id: "intent-legacy",
					correlationId: "corr-legacy",
					organizationId: "org-1",
					customerId: "cust-4",
					amount: "60.00",
					currencyCode: "USD",
				},
			]);
			// No lines seeded for intent-legacy
			repo.seedClassEntitlements([
				{
					id: "ent-legacy-underpaid",
					organizationId: "org-1",
					parentCustomerId: "cust-4",
					checkoutIntentId: "intent-legacy",
					checkoutIntentLineId: null, // Legacy, no line id
					shopifyOrderGid: "gid://shopify/Order/103",
					paidAmountCents: 4500, // < 6000
					paidCurrencyCode: "USD",
					status: "confirmed",
				},
			]);

			const mismatches = await repo.listMismatches("org-1");
			const partialPayments = mismatches.filter(
				(m) => m.mismatchType === "partial_payment",
			);
			expect(partialPayments).toHaveLength(1);
			expect(partialPayments[0].entitlementId).toBe("ent-legacy-underpaid");
			expect(partialPayments[0].amountCents).toBe(4500);
		});
	});

	describe("PostgresBillingRepository", () => {
		it("joins checkout_intent_lines and evaluates line item amount and currency", async () => {
			const repo = new PostgresBillingRepository("test_schema");
			const unsafeSpy = spyOn(sql, "unsafe");

			try {
				// Mock the 3 queries in listMismatches:
				// 1. paid_unregistered -> []
				// 2. registered_unpaid -> []
				// 3. partial_payment -> [one underpaid row]
				unsafeSpy
					.mockResolvedValueOnce([])
					.mockResolvedValueOnce([])
					.mockResolvedValueOnce([
						{
							entitlement_id: "ent-pg-underpaid",
							customer_id: "cust-pg",
							shopify_order_gid: "gid://shopify/Order/pg-1",
							paid_amount_cents: 3000,
							paid_currency_code: "USD",
							expected_amount: "50.00",
							expected_currency: "USD",
						},
					]);

				const mismatches = await repo.listMismatches("org-1");
				expect(mismatches).toHaveLength(1);
				expect(mismatches[0].mismatchType).toBe("partial_payment");
				expect(mismatches[0].entitlementId).toBe("ent-pg-underpaid");
				expect(mismatches[0].amountCents).toBe(3000);

				// Verify the SQL query checked checkout_intent_lines
				const thirdCallQuery = unsafeSpy.mock.calls[2][0] as string;
				expect(thirdCallQuery).toContain("checkout_intent_lines cil");
				expect(thirdCallQuery).toContain(
					"cil.checkout_intent_id = ce.checkout_intent_id",
				);
				expect(thirdCallQuery).toContain("cil.id = ce.checkout_intent_line_id");
				expect(thirdCallQuery).toContain("COALESCE(cil.amount, ci.amount)");
			} finally {
				unsafeSpy.mockRestore();
			}
		});
	});
});
