import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import {
	DuplicateAdjustmentError,
	InMemoryBillingRepository,
	InsufficientCreditBalanceError,
	resolveAdjustmentDirection,
	resolveLedgerEntryType,
} from "../src/billing/billing-repository.js";
import { PostgresBillingRepository } from "../src/billing/postgres-billing-repository.js";

async function postgresBillingSource() {
	return (
		await Bun.file(
			new URL("../src/billing/postgres-billing-repository.ts", import.meta.url),
		).text()
	).replace(/\r\n/g, "\n");
}

describe("BillingRepository - InMemoryBillingRepository", () => {
	let repo: InMemoryBillingRepository;

	beforeEach(() => {
		repo = new InMemoryBillingRepository();
	});

	it("returns null when customer has no credit balance", async () => {
		const balance = await repo.getCreditBalance("org-1", "cust-1");
		expect(balance).toBeNull();
	});

	it("atomically creates adjustment and ledger entry, increasing credit balance on credit_issue", async () => {
		const result = await repo.createAdjustmentWithLedger(
			{
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "credit_issue",
				amountCents: 5000,
				currencyCode: "USD",
				reason: "Promotional credit",
				referenceType: "promo",
				referenceId: "promo-2026",
			},
			{ notes: "Welcome promotion" },
		);

		expect(result.adjustment.amountCents).toBe(5000);
		expect(result.adjustment.adjustmentType).toBe("credit_issue");
		expect(result.adjustment.referenceId).toBe("promo-2026");

		expect(result.ledgerEntry.entryType).toBe("credit");
		expect(result.ledgerEntry.direction).toBe("inflow");
		expect(result.ledgerEntry.amountCents).toBe(5000);
		expect(result.ledgerEntry.balanceAfterCents).toBe(5000);
		expect(result.ledgerEntry.notes).toBe("Welcome promotion");

		expect(result.creditBalance.balanceCents).toBe(5000);

		const fetchedBalance = await repo.getCreditBalance("org-1", "cust-1");
		expect(fetchedBalance?.balanceCents).toBe(5000);

		const ledger = await repo.listLedgerEntries("org-1", "cust-1");
		expect(ledger).toHaveLength(1);
		expect(ledger[0].balanceAfterCents).toBe(5000);

		const adjustments = await repo.listAdjustments("org-1", "cust-1");
		expect(adjustments).toHaveLength(1);
		expect(adjustments[0].id).toBe(result.adjustment.id);
	});

	it("decreases credit balance on credit_apply", async () => {
		// First give 5000 cents
		await repo.createAdjustmentWithLedger({
			organizationId: "org-1",
			customerId: "cust-1",
			adminUserId: "admin-1",
			adjustmentType: "credit_issue",
			amountCents: 5000,
			currencyCode: "USD",
			reason: "Deposit",
		});

		// Now apply 2000 cents
		const applyResult = await repo.createAdjustmentWithLedger({
			organizationId: "org-1",
			customerId: "cust-1",
			adminUserId: "admin-1",
			adjustmentType: "credit_apply",
			amountCents: 2000,
			currencyCode: "USD",
			reason: "Applied to entry fee",
		});

		expect(applyResult.ledgerEntry.direction).toBe("outflow");
		expect(applyResult.ledgerEntry.entryType).toBe("debit");
		expect(applyResult.creditBalance.balanceCents).toBe(3000);
		expect(applyResult.ledgerEntry.balanceAfterCents).toBe(3000);

		const balance = await repo.getCreditBalance("org-1", "cust-1");
		expect(balance?.balanceCents).toBe(3000);
	});

	it("enforces balance non-negativity check (balance_cents >= 0)", async () => {
		// Customer has 1000 cents
		await repo.createAdjustmentWithLedger({
			organizationId: "org-1",
			customerId: "cust-1",
			adminUserId: "admin-1",
			adjustmentType: "credit_issue",
			amountCents: 1000,
			reason: "Credit",
		});

		// Attempting to debit 1500 cents must fail
		await expect(
			repo.createAdjustmentWithLedger({
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "credit_apply",
				amountCents: 1500,
				reason: "Too large debit",
			}),
		).rejects.toThrow(InsufficientCreditBalanceError);

		// Balance remains 1000 and ledger has only 1 entry
		const balance = await repo.getCreditBalance("org-1", "cust-1");
		expect(balance?.balanceCents).toBe(1000);

		const ledger = await repo.listLedgerEntries("org-1", "cust-1");
		expect(ledger).toHaveLength(1);
	});

	it("enforces duplicate prevention on reference ID", async () => {
		await repo.createAdjustmentWithLedger({
			organizationId: "org-1",
			customerId: "cust-1",
			adminUserId: "admin-1",
			adjustmentType: "credit_issue",
			amountCents: 2500,
			reason: "Referral bonus",
			referenceType: "referral",
			referenceId: "ref-abc-123",
		});

		// Second call with same referenceId must throw DuplicateAdjustmentError
		await expect(
			repo.createAdjustmentWithLedger({
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "credit_issue",
				amountCents: 2500,
				reason: "Referral bonus duplicate",
				referenceType: "referral",
				referenceId: "ref-abc-123",
			}),
		).rejects.toThrow(DuplicateAdjustmentError);

		const balance = await repo.getCreditBalance("org-1", "cust-1");
		expect(balance?.balanceCents).toBe(2500);

		const adjustments = await repo.listAdjustments("org-1", "cust-1");
		expect(adjustments).toHaveLength(1);
	});

	it("finds adjustment by reference", async () => {
		await repo.createAdjustmentWithLedger({
			organizationId: "org-1",
			customerId: "cust-1",
			adminUserId: "admin-1",
			adjustmentType: "refund",
			amountCents: 4500,
			reason: "Class cancellation",
			referenceType: "cancellation",
			referenceId: "cancel-99",
		});

		const found = await repo.findAdjustmentByReference(
			"org-1",
			"cancellation",
			"cancel-99",
		);
		expect(found).not.toBeNull();
		expect(found?.amountCents).toBe(4500);

		const notFound = await repo.findAdjustmentByReference(
			"org-1",
			"cancellation",
			"non-existent",
		);
		expect(notFound).toBeNull();
	});

	describe("mismatch detection query (listMismatches)", () => {
		it("detects paid_unregistered mismatch when order is fully paid but no entitlement exists", async () => {
			repo.seedOrderProjections([
				{
					organizationId: "org-1",
					shopifyOrderGid: "gid://shopify/Order/100",
					correlationId: "corr-100",
					shopifyCustomerGid: "gid://shopify/Customer/1",
					fullyPaidAt: "2026-09-28T00:00:00.000Z",
					currencyCode: "USD",
				},
			]);
			repo.seedCheckoutIntents([
				{
					id: "intent-100",
					correlationId: "corr-100",
					organizationId: "org-1",
					customerId: "cust-100",
					amount: "50.00",
					currencyCode: "USD",
				},
			]);

			const mismatches = await repo.listMismatches("org-1");
			expect(mismatches).toHaveLength(1);
			expect(mismatches[0].mismatchType).toBe("paid_unregistered");
			expect(mismatches[0].shopifyOrderId).toBe("gid://shopify/Order/100");
			expect(mismatches[0].customerId).toBe("cust-100");
			expect(mismatches[0].amountCents).toBe(5000);
		});

		it("detects registered_unpaid mismatch when confirmed entitlement exists without payment", async () => {
			repo.seedClassEntitlements([
				{
					id: "ent-200",
					organizationId: "org-1",
					parentCustomerId: "cust-200",
					checkoutIntentId: "intent-200",
					shopifyOrderGid: "gid://shopify/Order/200",
					paidAmountCents: 0,
					paidCurrencyCode: "USD",
					status: "confirmed",
				},
			]);

			const mismatches = await repo.listMismatches("org-1");
			expect(mismatches).toHaveLength(1);
			expect(mismatches[0].mismatchType).toBe("registered_unpaid");
			expect(mismatches[0].entitlementId).toBe("ent-200");
			expect(mismatches[0].customerId).toBe("cust-200");
		});

		it("detects partial_payment mismatch when paid amount is less than checkout intent price", async () => {
			repo.seedClassEntitlements([
				{
					id: "ent-300",
					organizationId: "org-1",
					parentCustomerId: "cust-300",
					checkoutIntentId: "intent-300",
					shopifyOrderGid: "gid://shopify/Order/300",
					paidAmountCents: 2500,
					paidCurrencyCode: "USD",
					status: "confirmed",
				},
			]);
			repo.seedCheckoutIntents([
				{
					id: "intent-300",
					correlationId: "corr-300",
					organizationId: "org-1",
					customerId: "cust-300",
					amount: "50.00",
					currencyCode: "USD",
				},
			]);

			const mismatches = await repo.listMismatches("org-1");
			expect(mismatches).toHaveLength(1);
			expect(mismatches[0].mismatchType).toBe("partial_payment");
			expect(mismatches[0].entitlementId).toBe("ent-300");
			expect(mismatches[0].amountCents).toBe(2500);
		});

		it("returns empty when all orders and entitlements are reconciled", async () => {
			repo.seedOrderProjections([
				{
					organizationId: "org-1",
					shopifyOrderGid: "gid://shopify/Order/400",
					correlationId: "corr-400",
					fullyPaidAt: "2026-09-28T00:00:00.000Z",
				},
			]);
			repo.seedClassEntitlements([
				{
					id: "ent-400",
					organizationId: "org-1",
					parentCustomerId: "cust-400",
					checkoutIntentId: "intent-400",
					shopifyOrderGid: "gid://shopify/Order/400",
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "confirmed",
				},
			]);
			repo.seedCheckoutIntents([
				{
					id: "intent-400",
					correlationId: "corr-400",
					organizationId: "org-1",
					customerId: "cust-400",
					amount: "50.00",
					currencyCode: "USD",
				},
			]);

			const mismatches = await repo.listMismatches("org-1");
			expect(mismatches).toHaveLength(0);
		});
	});

	describe("direction and entry type resolvers", () => {
		it("resolves default directions and entry types accurately", () => {
			expect(resolveAdjustmentDirection("credit_issue")).toBe("inflow");
			expect(resolveAdjustmentDirection("refund")).toBe("inflow");
			expect(resolveAdjustmentDirection("credit_apply")).toBe("outflow");
			expect(resolveAdjustmentDirection("manual_charge")).toBe("outflow");
			expect(resolveAdjustmentDirection("write_off")).toBe("outflow");

			expect(resolveLedgerEntryType("credit_issue", "inflow")).toBe("credit");
			expect(resolveLedgerEntryType("credit_apply", "outflow")).toBe("debit");
			expect(resolveLedgerEntryType("write_off", "outflow")).toBe("adjustment");
		});
	});
});

describe("BillingRepository - PostgresBillingRepository", () => {
	it("rejects invalid database schema identifier", () => {
		expect(
			() => new PostgresBillingRepository("bad; DROP TABLE credit_balances;"),
		).toThrow("Database schema is invalid.");
	});

	it("uses atomic sql.begin transaction with row locking and duplicate checks", async () => {
		const source = await postgresBillingSource();

		expect(source).toContain("return (await sql.begin(async (tx) => {");
		expect(source).toContain("credit_balances (organization_id, customer_id");
		expect(source).toContain("FOR UPDATE");
		expect(source).toContain("billing_adjustments");
		expect(source).toContain("billing_ledger");
		expect(source).toContain("newBalanceCents < 0");
		expect(source).toContain("InsufficientCreditBalanceError");
		expect(source).toContain("DuplicateAdjustmentError");
	});

	it("queries shopify_order_projections, class_entitlements, and checkout_carts for mismatches", async () => {
		const source = await postgresBillingSource();

		expect(source).toContain("shopify_order_projections");
		expect(source).toContain("class_entitlements");
		expect(source).toContain("checkout_intents");
		expect(source).toContain("checkout_carts");
		expect(source).toContain("paid_unregistered");
		expect(source).toContain("registered_unpaid");
		expect(source).toContain("partial_payment");
	});

	describe("PostgresBillingRepository method execution with mocked sql", () => {
		let repo: PostgresBillingRepository;
		let unsafeSpy: ReturnType<typeof spyOn>;

		beforeEach(() => {
			repo = new PostgresBillingRepository("test_schema");
			unsafeSpy = spyOn(sql, "unsafe");
		});

		afterEach(() => {
			unsafeSpy.mockRestore();
		});

		it("getCreditBalance maps database row to CreditBalance", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					organization_id: "org-1",
					customer_id: "cust-1",
					balance_cents: 7500,
					currency_code: "USD",
					updated_at: "2026-09-28T00:00:00.000Z",
				},
			]);

			const balance = await repo.getCreditBalance("org-1", "cust-1");
			expect(balance).toEqual({
				organizationId: "org-1",
				customerId: "cust-1",
				balanceCents: 7500,
				currencyCode: "USD",
				updatedAtIso: "2026-09-28T00:00:00.000Z",
			});
		});

		it("listLedgerEntries maps database rows to BillingLedgerEntry[]", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "entry-1",
					organization_id: "org-1",
					customer_id: "cust-1",
					entry_type: "credit",
					amount_cents: 5000,
					direction: "inflow",
					balance_after_cents: 5000,
					currency_code: "USD",
					adjustment_id: "adj-1",
					notes: "Initial deposit",
					created_at: "2026-09-28T00:00:00.000Z",
				},
			]);

			const entries = await repo.listLedgerEntries("org-1", "cust-1");
			expect(entries).toHaveLength(1);
			expect(entries[0].amountCents).toBe(5000);
			expect(entries[0].direction).toBe("inflow");
			expect(entries[0].notes).toBe("Initial deposit");
		});

		it("listAdjustments maps database rows to BillingAdjustment[]", async () => {
			unsafeSpy.mockResolvedValueOnce([
				{
					id: "adj-1",
					organization_id: "org-1",
					customer_id: "cust-1",
					admin_user_id: "admin-1",
					adjustment_type: "credit_issue",
					amount_cents: 5000,
					currency_code: "USD",
					reason: "Goodwill",
					reference_type: null,
					reference_id: null,
					approved_decision_id: null,
					created_at: "2026-09-28T00:00:00.000Z",
				},
			]);

			const adjustments = await repo.listAdjustments("org-1");
			expect(adjustments).toHaveLength(1);
			expect(adjustments[0].adjustmentType).toBe("credit_issue");
			expect(adjustments[0].reason).toBe("Goodwill");
		});
	});
});
