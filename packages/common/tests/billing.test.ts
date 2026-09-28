import { describe, expect, it } from "bun:test";
import {
	assertValidCreateBillingAdjustmentInput,
	BILLING_ADJUSTMENT_TYPES,
	BILLING_LEDGER_DIRECTIONS,
	BILLING_LEDGER_ENTRY_TYPES,
	BILLING_MISMATCH_TYPES,
	type BillingAdjustment,
	type BillingAdjustmentType,
	type BillingLedgerDirection,
	type BillingLedgerEntry,
	type BillingLedgerEntryType,
	type BillingMismatchRecord,
	type BillingMismatchType,
	type CreateBillingAdjustmentInput,
	type CreditBalance,
	isBillingAdjustmentType,
	isBillingLedgerDirection,
	isBillingLedgerEntryType,
	isBillingMismatchType,
	validateCreateBillingAdjustmentInput,
} from "../src/index.js";

describe("billing reconciliation domain types and validation", () => {
	describe("constants and type guards", () => {
		it("includes expected adjustment types and guards correctly", () => {
			const sampleType: BillingAdjustmentType = "refund";
			expect(isBillingAdjustmentType(sampleType)).toBe(true);
			expect(BILLING_ADJUSTMENT_TYPES).toContain("refund");
			expect(BILLING_ADJUSTMENT_TYPES).toContain("credit_issue");
			expect(BILLING_ADJUSTMENT_TYPES).toContain("credit_apply");
			expect(BILLING_ADJUSTMENT_TYPES).toContain("manual_charge");
			expect(BILLING_ADJUSTMENT_TYPES).toContain("write_off");

			for (const type of BILLING_ADJUSTMENT_TYPES) {
				expect(isBillingAdjustmentType(type)).toBe(true);
			}
			expect(isBillingAdjustmentType("invalid_adjustment")).toBe(false);
			expect(isBillingAdjustmentType(null)).toBe(false);
			expect(isBillingAdjustmentType(123)).toBe(false);
		});

		it("includes expected ledger entry types and guards correctly", () => {
			const sampleEntry: BillingLedgerEntryType = "credit";
			expect(isBillingLedgerEntryType(sampleEntry)).toBe(true);
			expect(BILLING_LEDGER_ENTRY_TYPES).toContain("credit");
			expect(BILLING_LEDGER_ENTRY_TYPES).toContain("debit");
			expect(BILLING_LEDGER_ENTRY_TYPES).toContain("adjustment");

			for (const type of BILLING_LEDGER_ENTRY_TYPES) {
				expect(isBillingLedgerEntryType(type)).toBe(true);
			}
			expect(isBillingLedgerEntryType("unknown_type")).toBe(false);
			expect(isBillingLedgerEntryType(undefined)).toBe(false);
		});

		it("includes expected ledger directions and guards correctly", () => {
			const sampleDir: BillingLedgerDirection = "inflow";
			expect(isBillingLedgerDirection(sampleDir)).toBe(true);
			expect(BILLING_LEDGER_DIRECTIONS).toContain("inflow");
			expect(BILLING_LEDGER_DIRECTIONS).toContain("outflow");

			for (const dir of BILLING_LEDGER_DIRECTIONS) {
				expect(isBillingLedgerDirection(dir)).toBe(true);
			}
			expect(isBillingLedgerDirection("sideways")).toBe(false);
		});

		it("includes expected mismatch types and guards correctly", () => {
			const sampleMismatch: BillingMismatchType = "paid_unregistered";
			expect(isBillingMismatchType(sampleMismatch)).toBe(true);
			expect(BILLING_MISMATCH_TYPES).toContain("paid_unregistered");
			expect(BILLING_MISMATCH_TYPES).toContain("registered_unpaid");
			expect(BILLING_MISMATCH_TYPES).toContain("partial_payment");
			expect(BILLING_MISMATCH_TYPES).toContain("overpayment");
			expect(BILLING_MISMATCH_TYPES).toContain("duplicate_payment");

			for (const mismatch of BILLING_MISMATCH_TYPES) {
				expect(isBillingMismatchType(mismatch)).toBe(true);
			}
			expect(isBillingMismatchType("no_mismatch")).toBe(false);
		});
	});

	describe("domain entity contracts", () => {
		it("supports valid CreditBalance shape", () => {
			const creditBalance: CreditBalance = {
				organizationId: "org-1",
				customerId: "cust-1",
				balanceCents: 5000,
				currencyCode: "USD",
				updatedAt: "2026-09-28T00:00:00.000Z",
			};
			expect(creditBalance.balanceCents).toBe(5000);
			expect(creditBalance.currencyCode).toBe("USD");
		});

		it("supports valid BillingAdjustment shape", () => {
			const adjustment: BillingAdjustment = {
				id: "adj-1",
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "refund",
				amountCents: 2500,
				currencyCode: "USD",
				reason: "Customer request",
				referenceType: "shopify_order",
				referenceId: "gid://shopify/Order/12345",
				approvedDecisionId: "dec-98",
				createdAt: "2026-09-28T00:00:00.000Z",
			};
			expect(adjustment.amountCents).toBe(2500);
			expect(adjustment.adjustmentType).toBe("refund");
		});

		it("supports valid BillingLedgerEntry shape", () => {
			const entry: BillingLedgerEntry = {
				id: "ledger-1",
				organizationId: "org-1",
				customerId: "cust-1",
				entryType: "credit",
				amountCents: 1500,
				direction: "inflow",
				balanceAfterCents: 1500,
				currencyCode: "USD",
				adjustmentId: "adj-1",
				notes: "Credit adjustment issued",
			};
			expect(entry.direction).toBe("inflow");
			expect(entry.balanceAfterCents).toBe(1500);
		});

		it("supports valid BillingMismatchRecord shape", () => {
			const mismatch: BillingMismatchRecord = {
				id: "mis-1",
				organizationId: "org-1",
				customerId: "cust-1",
				mismatchType: "paid_unregistered",
				description: "Payment captured on Shopify but registration pending",
				amountCents: 3500,
				currencyCode: "USD",
				shopifyOrderId: "gid://shopify/Order/999",
				resolved: false,
			};
			expect(mismatch.mismatchType).toBe("paid_unregistered");
			expect(mismatch.resolved).toBe(false);
		});
	});

	describe("validateCreateBillingAdjustmentInput", () => {
		const validBaseInput: CreateBillingAdjustmentInput = {
			organizationId: "org-123",
			customerId: "cust-456",
			adminUserId: "admin-789",
			adjustmentType: "credit_issue",
			amountCents: 5000,
			currencyCode: "usd",
			reason: "Promotional credit approved",
			referenceType: "inquiry",
			referenceId: "inq-42",
			approvedDecisionId: "dec-101",
		};

		it("validates full valid input and normalizes currencyCode", () => {
			const result = validateCreateBillingAdjustmentInput(validBaseInput);
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data).toBeDefined();
			expect(result.data?.organizationId).toBe("org-123");
			expect(result.data?.currencyCode).toBe("USD");
			expect(result.data?.adjustmentType).toBe("credit_issue");
			expect(result.data?.amountCents).toBe(5000);
			expect(result.data?.referenceType).toBe("inquiry");
			expect(result.data?.referenceId).toBe("inq-42");
			expect(result.data?.approvedDecisionId).toBe("dec-101");
		});

		it("defaults currencyCode to USD and nullable references to null when omitted", () => {
			const result = validateCreateBillingAdjustmentInput({
				organizationId: "org-123",
				customerId: "cust-456",
				adminUserId: "admin-789",
				adjustmentType: "refund",
				amountCents: 2000,
				reason: "Overpayment refund",
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.currencyCode).toBe("USD");
			expect(result.data?.referenceType).toBeNull();
			expect(result.data?.referenceId).toBeNull();
			expect(result.data?.approvedDecisionId).toBeNull();
		});

		it("rejects non-object or null input", () => {
			const nullResult = validateCreateBillingAdjustmentInput(null);
			expect(nullResult.valid).toBe(false);
			expect(nullResult.errors).toContain(
				"Billing adjustment input must be an object.",
			);

			const arrayResult = validateCreateBillingAdjustmentInput([]);
			expect(arrayResult.valid).toBe(false);
			expect(arrayResult.errors).toContain(
				"Billing adjustment input must be an object.",
			);
		});

		it("rejects missing or empty required fields", () => {
			const result = validateCreateBillingAdjustmentInput({
				organizationId: "   ",
				customerId: "",
				adminUserId: "",
				adjustmentType: "",
				amountCents: 0,
				reason: "  ",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Organization ID is required.");
			expect(result.errors).toContain("Customer ID is required.");
			expect(result.errors).toContain("Admin user ID is required.");
			expect(result.errors.some((e) => e.includes("Adjustment type"))).toBe(
				true,
			);
			expect(result.errors).toContain(
				"Adjustment amount in cents must be a positive integer.",
			);
			expect(result.errors).toContain("Adjustment reason is required.");
		});

		it("rejects invalid amountCents values", () => {
			for (const invalidAmount of [-100, 0, 12.34, "5000", null, Number.NaN]) {
				const result = validateCreateBillingAdjustmentInput({
					...validBaseInput,
					amountCents: invalidAmount,
				});
				expect(result.valid).toBe(false);
				expect(result.errors).toContain(
					"Adjustment amount in cents must be a positive integer.",
				);
			}
		});

		it("rejects invalid adjustment types", () => {
			const result = validateCreateBillingAdjustmentInput({
				...validBaseInput,
				adjustmentType: "unsupported_type" as unknown as BillingAdjustmentType,
			});
			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) => e.includes("Adjustment type must be one of")),
			).toBe(true);
		});

		it("rejects invalid currency codes", () => {
			const tooShort = validateCreateBillingAdjustmentInput({
				...validBaseInput,
				currencyCode: "US",
			});
			expect(tooShort.valid).toBe(false);
			expect(tooShort.errors).toContain(
				"Currency code must be a 3-letter ISO code.",
			);

			const nonAlpha = validateCreateBillingAdjustmentInput({
				...validBaseInput,
				currencyCode: "123",
			});
			expect(nonAlpha.valid).toBe(false);
			expect(nonAlpha.errors).toContain(
				"Currency code must be a 3-letter ISO code.",
			);
		});
	});

	describe("assertValidCreateBillingAdjustmentInput", () => {
		it("does not throw on valid input", () => {
			expect(() =>
				assertValidCreateBillingAdjustmentInput({
					organizationId: "org-1",
					customerId: "cust-1",
					adminUserId: "admin-1",
					adjustmentType: "refund",
					amountCents: 1000,
					reason: "Valid refund",
				}),
			).not.toThrow();
		});

		it("throws an error on invalid input with combined messages", () => {
			expect(() =>
				assertValidCreateBillingAdjustmentInput({
					organizationId: "",
					customerId: "",
					adminUserId: "",
					adjustmentType: "bad",
					amountCents: -5,
					reason: "",
				}),
			).toThrow(/Organization ID is required/);
		});
	});
});
