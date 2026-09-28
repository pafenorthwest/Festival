import { beforeEach, describe, expect, it } from "bun:test";
import { BillingReconciliationService } from "../src/billing/billing-reconciliation-service.js";
import { InMemoryBillingRepository } from "../src/billing/billing-repository.js";
import { AppError } from "../src/errors/app-error.js";

describe("BillingReconciliationService", () => {
	let repo: InMemoryBillingRepository;
	let service: BillingReconciliationService;

	beforeEach(() => {
		repo = new InMemoryBillingRepository();
		service = new BillingReconciliationService(repo);
	});

	describe("authority boundary enforcement", () => {
		it("rejects decision reference without approvedDecisionId", async () => {
			await expect(
				service.applyAdjustment({
					organizationId: "org-1",
					customerId: "cust-1",
					adminUserId: "admin-1",
					adjustmentType: "refund",
					amountCents: 5000,
					reason: "Committee approved refund",
					referenceType: "decision",
					referenceId: "dec-123",
				}),
			).rejects.toThrow(
				"Approved decision ID is required when referencing a decision or membership refund.",
			);
		});

		it("rejects membership_decision reference without approvedDecisionId", async () => {
			await expect(
				service.applyAdjustment({
					organizationId: "org-1",
					customerId: "cust-1",
					adminUserId: "admin-1",
					adjustmentType: "refund",
					amountCents: 5000,
					reason: "Membership refund",
					referenceType: "membership_decision",
					referenceId: "mem-dec-456",
				}),
			).rejects.toThrow(AppError);
		});

		it("rejects membership_refund reference without approvedDecisionId", async () => {
			await expect(
				service.applyAdjustment({
					organizationId: "org-1",
					customerId: "cust-1",
					adminUserId: "admin-1",
					adjustmentType: "refund",
					amountCents: 5000,
					reason: "Membership refund",
					referenceType: "membership_refund",
					referenceId: "refund-456",
				}),
			).rejects.toThrow(AppError);
		});

		it("rejects membership refund without approvedDecisionId", async () => {
			await expect(
				service.applyAdjustment({
					organizationId: "org-1",
					customerId: "cust-1",
					adminUserId: "admin-1",
					adjustmentType: "refund",
					amountCents: 5000,
					reason: "Membership refund",
					referenceType: "membership",
					referenceId: "mem-789",
				}),
			).rejects.toThrow(AppError);
		});

		it("allows decision reference when approvedDecisionId is provided", async () => {
			const result = await service.applyAdjustment({
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "refund",
				amountCents: 5000,
				reason: "Committee approved refund",
				referenceType: "decision",
				referenceId: "dec-123",
				approvedDecisionId: "appr-dec-999",
			});

			expect(result.alreadyExisted).toBe(false);
			expect(result.adjustment.approvedDecisionId).toBe("appr-dec-999");
			expect(result.adjustment.amountCents).toBe(5000);
			expect(result.creditBalance.balanceCents).toBe(5000);
		});

		it("allows non-decision adjustments without approvedDecisionId", async () => {
			const result = await service.applyAdjustment({
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "credit_issue",
				amountCents: 2000,
				reason: "Volunteer appreciation credit",
			});

			expect(result.alreadyExisted).toBe(false);
			expect(result.adjustment.amountCents).toBe(2000);
			expect(result.creditBalance.balanceCents).toBe(2000);
		});
	});

	describe("idempotent adjustment application", () => {
		it("applies adjustment on first call, returns existing on second call without re-applying", async () => {
			const payload = {
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "credit_issue" as const,
				amountCents: 3000,
				reason: "Promo code",
				referenceType: "promo",
				referenceId: "promo-welcome-2026",
			};

			// First call: creates adjustment
			const first = await service.applyAdjustment(payload);
			expect(first.alreadyExisted).toBe(false);
			expect(first.adjustment.amountCents).toBe(3000);
			expect(first.creditBalance.balanceCents).toBe(3000);
			expect(first.ledgerEntry).toBeDefined();

			// Second call: idempotent, returns existing adjustment
			const second = await service.applyAdjustment(payload);
			expect(second.alreadyExisted).toBe(true);
			expect(second.adjustment.id).toBe(first.adjustment.id);
			expect(second.creditBalance.balanceCents).toBe(3000); // NOT 6000!

			// Verify only 1 adjustment and 1 ledger entry in repository
			const adjustments = await service.listAdjustments("org-1", "cust-1");
			expect(adjustments).toHaveLength(1);

			const ledger = await service.listLedgerEntries("org-1", "cust-1");
			expect(ledger).toHaveLength(1);
		});

		it("aliases createAdjustment to applyAdjustment", async () => {
			const result = await service.createAdjustment({
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "credit_issue",
				amountCents: 1500,
				reason: "Bonus",
			});

			expect(result.adjustment.amountCents).toBe(1500);
			expect(result.creditBalance.balanceCents).toBe(1500);
		});
	});

	describe("mismatch detection query", () => {
		it("delegates listMismatches to repository", async () => {
			repo.seedOrderProjections([
				{
					organizationId: "org-1",
					shopifyOrderGid: "gid://shopify/Order/999",
					correlationId: "corr-999",
					fullyPaidAt: "2026-09-28T00:00:00.000Z",
				},
			]);

			const mismatches = await service.listMismatches("org-1");
			expect(mismatches).toHaveLength(1);
			expect(mismatches[0].mismatchType).toBe("paid_unregistered");

			// getMismatches alias
			const same = await service.getMismatches("org-1");
			expect(same).toHaveLength(1);
		});
	});

	describe("ledger and credit balance queries", () => {
		it("queries credit balance and ledger entries", async () => {
			expect(await service.getCreditBalance("org-1", "cust-1")).toBeNull();

			await service.applyAdjustment({
				organizationId: "org-1",
				customerId: "cust-1",
				adminUserId: "admin-1",
				adjustmentType: "credit_issue",
				amountCents: 4000,
				reason: "Grant",
			});

			const balance = await service.getCreditBalance("org-1", "cust-1");
			expect(balance?.balanceCents).toBe(4000);

			const ledger = await service.listLedgerEntries("org-1", "cust-1");
			expect(ledger).toHaveLength(1);
			expect(ledger[0].amountCents).toBe(4000);
			expect(ledger[0].balanceAfterCents).toBe(4000);

			const adjustments = await service.listAdjustments("org-1", "cust-1");
			expect(adjustments).toHaveLength(1);
			expect(adjustments[0].amountCents).toBe(4000);
		});
	});

	describe("input validation", () => {
		it("rejects invalid input payloads", async () => {
			// Missing required fields
			await expect(
				service.applyAdjustment({
					organizationId: "",
					customerId: "cust-1",
					adminUserId: "admin-1",
					adjustmentType: "credit_issue",
					amountCents: 1000,
					reason: "Test",
				}),
			).rejects.toThrow("Organization ID is required.");

			// Negative amount
			await expect(
				service.applyAdjustment({
					organizationId: "org-1",
					customerId: "cust-1",
					adminUserId: "admin-1",
					adjustmentType: "credit_issue",
					amountCents: -500,
					reason: "Test",
				}),
			).rejects.toThrow(
				"Adjustment amount in cents must be a positive integer.",
			);
		});
	});
});
