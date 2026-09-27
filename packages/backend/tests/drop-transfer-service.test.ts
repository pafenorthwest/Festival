import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryClassEntitlementRepository } from "../src/commerce/class-entitlement-repository.js";
import {
	DropTransferService,
	type ShopifyRefundProvider,
} from "../src/registration/drop-transfer-service.js";
import { InMemoryRegistrationChangeRepository } from "../src/registration/registration-change-repository.js";

describe("DropTransferService", () => {
	let entitlementsRepo: InMemoryClassEntitlementRepository;
	let changeRepo: InMemoryRegistrationChangeRepository;

	const mockClassCapacities = new Map<string, number>([
		["class-violin-1", 2],
		["class-violin-2", 1],
		["class-cello-1", 1],
	]);

	beforeEach(() => {
		entitlementsRepo = new InMemoryClassEntitlementRepository();
		changeRepo = new InMemoryRegistrationChangeRepository();
	});

	describe("dropRegistration", () => {
		it("drops a confirmed entitlement, writes audit log, and triggers waitlist promotion", async () => {
			// Setup: Class has capacity 1. Student 1 confirmed, Student 2 waitlisted.
			const ent1 = await entitlementsRepo.createClassEntitlement({
				id: "ent-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-2",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/1",
				shopifyOrderLineGid: "gid://shopify/LineItem/1",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
				createdAt: "2026-09-20T10:00:00Z",
			});

			const ent2 = await entitlementsRepo.createClassEntitlement({
				id: "ent-2",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-2",
				parentCustomerId: "parent-2",
				childId: "child-2",
				checkoutIntentId: "intent-2",
				shopifyOrderGid: "gid://shopify/Order/2",
				shopifyOrderLineGid: "gid://shopify/LineItem/2",
				paidAmountCents: 0,
				paidCurrencyCode: "USD",
				status: "waitlisted",
				createdAt: "2026-09-20T11:00:00Z",
			});

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				classQuery: mockClassCapacities,
			});

			const result = await service.dropRegistration({
				classEntitlementId: ent1.id,
				organizationId: "org-1",
				actorUid: "admin-1",
				actorRole: "admin",
				reason: "Parent requested cancellation",
			});

			expect(result.success).toBe(true);
			expect(result.classEntitlementId).toBe(ent1.id);
			expect(result.classEntitlement?.status).toBe("cancelled");

			// Check entitlement in repo is cancelled
			const dropped = await entitlementsRepo.getClassEntitlement(
				"org-1",
				ent1.id,
			);
			expect(dropped?.status).toBe("cancelled");

			// Check audit log
			const logs = await changeRepo.listChangeLogsForEntitlement(
				"org-1",
				ent1.id,
			);
			expect(logs).toHaveLength(1);
			expect(logs[0].action).toBe("drop");
			expect(logs[0].previousState.status).toBe("confirmed");
			expect(logs[0].newState.status).toBe("cancelled");
			expect(logs[0].actorRole).toBe("admin");

			// Check student 2 was auto-promoted to confirmed
			const promotedEnt2 = await entitlementsRepo.getClassEntitlement(
				"org-1",
				ent2.id,
			);
			expect(promotedEnt2?.status).toBe("confirmed");
			expect(result.promotedWaitlistEntitlements).toHaveLength(1);
			expect(result.promotedWaitlistEntitlements?.[0].classEntitlementId).toBe(
				ent2.id,
			);
			expect(result.promotedWaitlistEntitlements?.[0].promoted).toBe(true);
		});

		it("drops a confirmed entitlement and processes refund when requested", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-refund",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/100",
				shopifyOrderLineGid: "gid://shopify/LineItem/100",
				paidAmountCents: 6500,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			const mockShopifyRefund: ShopifyRefundProvider = {
				createRefund: async (params) => {
					expect(params.orderId).toBe("gid://shopify/Order/100");
					return { id: "gid://shopify/Refund/999", providerMode: "mock" };
				},
			};

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				shopifyAdminClient: mockShopifyRefund,
				classQuery: mockClassCapacities,
			});

			const result = await service.dropRegistration({
				classEntitlementId: ent.id,
				organizationId: "org-1",
				requestRefund: true,
				refundAmountCents: 6500,
				refundReason: "Customer refund upon drop",
			});

			expect(result.success).toBe(true);
			expect(result.refundEvent).toBeDefined();
			expect(result.refundEvent?.amountCents).toBe(6500);
			expect(result.refundEvent?.status).toBe("completed");
			expect(result.refundEvent?.shopifyRefundId).toBe(
				"gid://shopify/Refund/999",
			);
		});

		it("handles Shopify refund failure by marking refund event as failed", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-refund-fail",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/200",
				shopifyOrderLineGid: "gid://shopify/LineItem/200",
				paidAmountCents: 4000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			const mockShopifyRefund: ShopifyRefundProvider = {
				createRefund: async () => {
					throw new Error("Shopify gateway error");
				},
			};

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				shopifyAdminClient: mockShopifyRefund,
			});

			const result = await service.dropRegistration({
				classEntitlementId: ent.id,
				organizationId: "org-1",
				issueRefund: true,
			});

			expect(result.success).toBe(true);
			expect(result.refundEvent?.status).toBe("failed");
			expect(result.refundEvent?.failureReason).toContain(
				"Shopify gateway error",
			);
		});

		it("drops a waitlisted entitlement without triggering promotion or refund", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-waitlisted",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/300",
				shopifyOrderLineGid: "gid://shopify/LineItem/300",
				paidAmountCents: 0,
				paidCurrencyCode: "USD",
				status: "waitlisted",
			});

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				classQuery: mockClassCapacities,
			});

			const result = await service.dropRegistration({
				classEntitlementId: ent.id,
				organizationId: "org-1",
			});

			expect(result.success).toBe(true);
			expect(result.classEntitlement?.status).toBe("cancelled");
			expect(result.refundEvent).toBeNull();
			expect(result.promotedWaitlistEntitlements).toEqual([]);
		});

		it("rejects drop if entitlement not found or already cancelled", async () => {
			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
			});

			await expect(
				service.dropRegistration({
					classEntitlementId: "non-existent",
					organizationId: "org-1",
				}),
			).rejects.toThrow("Class entitlement not found.");

			const cancelledEnt = await entitlementsRepo.createClassEntitlement({
				id: "ent-cancelled",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/400",
				shopifyOrderLineGid: "gid://shopify/LineItem/400",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "cancelled",
			});

			await expect(
				service.dropRegistration({
					classEntitlementId: cancelledEnt.id,
					organizationId: "org-1",
				}),
			).rejects.toThrow('Cannot drop registration with status "cancelled"');
		});
	});

	describe("transferRegistration", () => {
		it("moves to target class as confirmed when target class has open capacity", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-transfer-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-2",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/1",
				shopifyOrderLineGid: "gid://shopify/LineItem/1",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				classQuery: mockClassCapacities, // class-violin-1 has capacity 2, currently 0 confirmed
			});

			const result = await service.transferRegistration({
				classEntitlementId: ent.id,
				organizationId: "org-1",
				targetFestivalClassId: "class-violin-1",
				actorUid: "cust-1",
				actorRole: "customer",
				reason: "Preferred morning slot",
			});

			expect(result.success).toBe(true);
			expect(result.targetFestivalClassId).toBe("class-violin-1");
			expect(result.previousFestivalClassId).toBe("class-violin-2");
			expect(result.classEntitlement?.status).toBe("confirmed");
			expect(result.classEntitlement?.festivalClassId).toBe("class-violin-1");

			const updated = await entitlementsRepo.getClassEntitlement(
				"org-1",
				ent.id,
			);
			expect(updated?.festivalClassId).toBe("class-violin-1");
			expect(updated?.status).toBe("confirmed");

			const logs = await changeRepo.listChangeLogsForEntitlement(
				"org-1",
				ent.id,
			);
			expect(logs).toHaveLength(1);
			expect(logs[0].action).toBe("transfer");
			expect(logs[0].previousState.festivalClassId).toBe("class-violin-2");
			expect(logs[0].newState.festivalClassId).toBe("class-violin-1");
		});

		it("moves to target class as waitlisted preserving priority timestamp when target class is full", async () => {
			// class-cello-1 has capacity 1. Occupy it.
			await entitlementsRepo.createClassEntitlement({
				id: "ent-occupier",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-cello-1",
				parentCustomerId: "parent-0",
				childId: "child-0",
				checkoutIntentId: "intent-0",
				shopifyOrderGid: "gid://shopify/Order/0",
				shopifyOrderLineGid: "gid://shopify/LineItem/0",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			// Candidate to transfer
			const originalCreatedAt = "2026-09-15T08:00:00Z";
			const candidate = await entitlementsRepo.createClassEntitlement({
				id: "ent-transfer-full",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/1",
				shopifyOrderLineGid: "gid://shopify/LineItem/1",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
				createdAt: originalCreatedAt,
			});

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				classQuery: mockClassCapacities,
			});

			const result = await service.transferRegistration({
				classEntitlementId: candidate.id,
				organizationId: "org-1",
				targetFestivalClassId: "class-cello-1",
			});

			expect(result.success).toBe(true);
			expect(result.classEntitlement?.status).toBe("waitlisted");
			expect(result.classEntitlement?.festivalClassId).toBe("class-cello-1");

			const updated = await entitlementsRepo.getClassEntitlement(
				"org-1",
				candidate.id,
			);
			expect(updated?.status).toBe("waitlisted");
			expect(updated?.createdAt).toBe(originalCreatedAt); // Priority timestamp preserved
		});

		it("triggers waitlist auto-promotion on source class when moving from confirmed spot", async () => {
			// Source class has student 1 confirmed and student 2 waitlisted.
			const confirmedEnt = await entitlementsRepo.createClassEntitlement({
				id: "ent-source-confirmed",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-2",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/1",
				shopifyOrderLineGid: "gid://shopify/LineItem/1",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			const waitlistedEnt = await entitlementsRepo.createClassEntitlement({
				id: "ent-source-waitlisted",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-2",
				parentCustomerId: "parent-2",
				childId: "child-2",
				checkoutIntentId: "intent-2",
				shopifyOrderGid: "gid://shopify/Order/2",
				shopifyOrderLineGid: "gid://shopify/LineItem/2",
				paidAmountCents: 0,
				paidCurrencyCode: "USD",
				status: "waitlisted",
				createdAt: "2026-09-20T10:00:00Z",
			});

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				classQuery: mockClassCapacities,
			});

			const result = await service.transferRegistration({
				classEntitlementId: confirmedEnt.id,
				organizationId: "org-1",
				targetFestivalClassId: "class-violin-1",
			});

			expect(result.success).toBe(true);
			expect(result.promotedWaitlistEntitlements).toHaveLength(1);
			expect(result.promotedWaitlistEntitlements?.[0].classEntitlementId).toBe(
				waitlistedEnt.id,
			);

			const promoted = await entitlementsRepo.getClassEntitlement(
				"org-1",
				waitlistedEnt.id,
			);
			expect(promoted?.status).toBe("confirmed");
		});

		it("rejects transfer when target class matches source class", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-same-class",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/1",
				shopifyOrderLineGid: "gid://shopify/LineItem/1",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
			});

			await expect(
				service.transferRegistration({
					classEntitlementId: ent.id,
					organizationId: "org-1",
					targetFestivalClassId: "class-violin-1",
				}),
			).rejects.toThrow(
				"Target festival class must be different from source festival class.",
			);
		});
	});

	describe("promoteTopWaitlisted", () => {
		it("orders waitlisted registrations deterministically by created_at ASC, id ASC", async () => {
			// Student 3: earlier timestamp
			const s3 = await entitlementsRepo.createClassEntitlement({
				id: "ent-c",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-wl",
				parentCustomerId: "p-3",
				childId: "c-3",
				checkoutIntentId: "i-3",
				shopifyOrderGid: "o-3",
				shopifyOrderLineGid: "l-3",
				paidAmountCents: 0,
				paidCurrencyCode: "USD",
				status: "waitlisted",
				createdAt: "2026-09-20T10:00:00Z",
			});

			// Student 1 & 2: same later timestamp, different IDs for tiebreak
			const s1 = await entitlementsRepo.createClassEntitlement({
				id: "ent-b",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-wl",
				parentCustomerId: "p-1",
				childId: "c-1",
				checkoutIntentId: "i-1",
				shopifyOrderGid: "o-1",
				shopifyOrderLineGid: "l-1",
				paidAmountCents: 0,
				paidCurrencyCode: "USD",
				status: "waitlisted",
				createdAt: "2026-09-20T12:00:00Z",
			});

			const s2 = await entitlementsRepo.createClassEntitlement({
				id: "ent-a",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-wl",
				parentCustomerId: "p-2",
				childId: "c-2",
				checkoutIntentId: "i-2",
				shopifyOrderGid: "o-2",
				shopifyOrderLineGid: "l-2",
				paidAmountCents: 0,
				paidCurrencyCode: "USD",
				status: "waitlisted",
				createdAt: "2026-09-20T12:00:00Z",
			});

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
			});

			// 1st promotion should be s3 (earliest created_at)
			const promo1 = await service.promoteTopWaitlisted("org-1", "class-wl");
			expect(promo1.promoted).toBe(true);
			expect(promo1.classEntitlementId).toBe(s3.id);
			expect(promo1.changeLog?.action).toBe("waitlist_promote");
			expect(promo1.changeLog?.actorRole).toBe("system");

			// 2nd promotion should be s2 ("ent-a" < "ent-b" by id ASC tiebreak)
			const promo2 = await service.promoteTopWaitlisted("org-1", "class-wl");
			expect(promo2.promoted).toBe(true);
			expect(promo2.classEntitlementId).toBe(s2.id);

			// 3rd promotion should be s1 ("ent-b")
			const promo3 = await service.promoteTopWaitlisted("org-1", "class-wl");
			expect(promo3.promoted).toBe(true);
			expect(promo3.classEntitlementId).toBe(s1.id);

			// 4th promotion: empty waitlist
			const promo4 = await service.promoteTopWaitlisted("org-1", "class-wl");
			expect(promo4.promoted).toBe(false);
		});
	});
});
