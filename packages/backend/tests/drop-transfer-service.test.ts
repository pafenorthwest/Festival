import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryClassEntitlementRepository } from "../src/commerce/class-entitlement-repository.js";
import { AppError } from "../src/errors/app-error.js";
import {
	AsyncLock,
	DropTransferService,
	type ShopifyRefundProvider,
} from "../src/registration/drop-transfer-service.js";
import { InMemoryRegistrationChangeRepository } from "../src/registration/registration-change-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ShopifyAdminClient } from "../src/shopify/shopify-admin-client.js";

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
				supportsLineTargetedRefund: true,
				createRefund: async (params) => {
					expect(params.orderId).toBe("gid://shopify/Order/100");
					expect(params.shopifyOrderLineId).toBe("gid://shopify/LineItem/100");
					expect(params.amountCents).toBe(6500);
					expect(params.currency).toBe("USD");
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
			expect(result.refundEvent?.shopifyOrderLineId).toBe(
				"gid://shopify/LineItem/100",
			);
		});

		it("records a pending manual refund without calling an unsupported provider", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-refund-manual",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-manual",
				shopifyOrderGid: "gid://shopify/Order/manual",
				shopifyOrderLineGid: "gid://shopify/LineItem/manual",
				paidAmountCents: 7300,
				paidCurrencyCode: "CAD",
				status: "confirmed",
			});

			const unsupportedProvider = new ShopifyAdminClient({});
			let externalCalls = 0;
			unsupportedProvider.createRefund = async () => {
				externalCalls++;
				return {
					id: "gid://shopify/Refund/should-not-be-called",
					providerMode: "mock",
				};
			};

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				shopifyAdminClient: unsupportedProvider,
			});

			const result = await service.dropRegistration({
				classEntitlementId: ent.id,
				organizationId: "org-1",
				issueRefund: true,
			});

			expect(externalCalls).toBe(0);
			expect(result.refundEvent).toMatchObject({
				status: "pending",
				shopifyOrderId: "gid://shopify/Order/manual",
				shopifyOrderLineId: "gid://shopify/LineItem/manual",
				amountCents: 7300,
				currency: "CAD",
			});
			expect(result.refundEvent?.failureReason).toContain(
				"Manual refund required",
			);
		});

		it("records a valid partial refund as manual without calling a capable provider", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-refund-partial",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-partial",
				shopifyOrderGid: "gid://shopify/Order/partial",
				shopifyOrderLineGid: "gid://shopify/LineItem/partial",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			let externalCalls = 0;
			const capableProvider: ShopifyRefundProvider = {
				supportsLineTargetedRefund: true,
				createRefund: async () => {
					externalCalls++;
					return { id: "gid://shopify/Refund/should-not-be-called" };
				},
			};
			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				shopifyAdminClient: capableProvider,
			});

			const result = await service.dropRegistration({
				classEntitlementId: ent.id,
				organizationId: "org-1",
				requestRefund: true,
				refundAmountCents: 4500,
			});

			expect(externalCalls).toBe(0);
			expect(result.refundEvent).toMatchObject({
				status: "pending",
				amountCents: 4500,
				currency: "USD",
				shopifyOrderLineId: "gid://shopify/LineItem/partial",
			});
			expect(result.refundEvent?.failureReason).toContain(
				"partial class-registration refunds are not supported",
			);
		});

		it("rejects non-positive or over-limit requested refunds before cancelling", async () => {
			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
			});

			for (const scenario of [
				{
					amountCents: 0,
					message: "Refund amount must be a positive integer.",
				},
				{
					amountCents: 5001,
					message: "Refund amount cannot exceed the paid registration amount.",
				},
			]) {
				const ent = await entitlementsRepo.createClassEntitlement({
					id: `ent-refund-invalid-${scenario.amountCents}`,
					organizationId: "org-1",
					festivalId: "fest-1",
					festivalClassId: "class-violin-1",
					parentCustomerId: "parent-1",
					childId: `child-invalid-${scenario.amountCents}`,
					checkoutIntentId: `intent-invalid-${scenario.amountCents}`,
					shopifyOrderGid: `gid://shopify/Order/invalid-${scenario.amountCents}`,
					shopifyOrderLineGid: `gid://shopify/LineItem/invalid-${scenario.amountCents}`,
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "confirmed",
				});

				await expect(
					service.dropRegistration({
						classEntitlementId: ent.id,
						organizationId: "org-1",
						requestRefund: true,
						refundAmountCents: scenario.amountCents,
					}),
				).rejects.toMatchObject({ status: 400, message: scenario.message });
				expect(
					await entitlementsRepo.getClassEntitlement("org-1", ent.id),
				).toMatchObject({ status: "confirmed" });
				expect(
					await changeRepo.listChangeLogsForEntitlement("org-1", ent.id),
				).toHaveLength(0);
			}
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
				supportsLineTargetedRefund: true,
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

		it("fails refund and marks event failed when amount is zero or unpriced", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-unpriced",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/500",
				shopifyOrderLineGid: "gid://shopify/LineItem/500",
				paidAmountCents: 0,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			let shopifyCalled = false;
			const mockShopifyRefund: ShopifyRefundProvider = {
				supportsLineTargetedRefund: true,
				createRefund: async () => {
					shopifyCalled = true;
					return { id: "gid://shopify/Refund/500" };
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
			expect(shopifyCalled).toBe(false);
			expect(result.refundEvent?.status).toBe("failed");
			expect(result.refundEvent?.failureReason).toBe(
				"Cannot refund unpriced or zero-amount registration.",
			);
		});

		it("fails refund and marks event failed when order ID is missing", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-no-order",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/501",
				shopifyOrderLineGid: "gid://shopify/LineItem/501",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			const originalGet =
				entitlementsRepo.getClassEntitlement.bind(entitlementsRepo);
			entitlementsRepo.getClassEntitlement = async (orgId, id) => {
				const item = await originalGet(orgId, id);
				return item ? { ...item, shopifyOrderLineGid: "" } : null;
			};

			let shopifyCalled = false;
			const mockShopifyRefund: ShopifyRefundProvider = {
				supportsLineTargetedRefund: true,
				createRefund: async () => {
					shopifyCalled = true;
					return { id: "gid://shopify/Refund/501" };
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
			expect(shopifyCalled).toBe(false);
			expect(result.refundEvent?.status).toBe("failed");
			expect(result.refundEvent?.failureReason).toContain(
				"Missing Shopify order",
			);
		});

		it("rejects drop with 400 if entitlement status is invalid", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-transferred",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/600",
				shopifyOrderLineGid: "gid://shopify/LineItem/600",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			const originalGet =
				entitlementsRepo.getClassEntitlement.bind(entitlementsRepo);
			entitlementsRepo.getClassEntitlement = async (orgId, id) => {
				const item = await originalGet(orgId, id);
				return item
					? {
							...item,
							status: "transferred" as never,
						}
					: null;
			};

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
			});

			try {
				await service.dropRegistration({
					classEntitlementId: ent.id,
					organizationId: "org-1",
				});
				expect.unreachable();
			} catch (err: unknown) {
				expect(err).toBeInstanceOf(AppError);
				expect((err as AppError).status).toBe(400);
				expect((err as AppError).message).toBe(
					'Cannot drop registration with status "transferred".',
				);
			}
		});

		it("handles concurrent drops on the same entitlement atomically without double-refunding or duplicate logs", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-concurrent-drop",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-concurrent",
				shopifyOrderGid: "gid://shopify/Order/777",
				shopifyOrderLineGid: "gid://shopify/LineItem/777",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			let shopifyRefundCalls = 0;
			const mockShopifyRefund: ShopifyRefundProvider = {
				supportsLineTargetedRefund: true,
				createRefund: async (params) => {
					shopifyRefundCalls++;
					expect(params.orderId).toBe("gid://shopify/Order/777");
					return { id: "gid://shopify/Refund/777", providerMode: "mock" };
				},
			};

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				shopifyAdminClient: mockShopifyRefund,
				classQuery: mockClassCapacities,
			});

			const results = await Promise.allSettled([
				service.dropRegistration({
					classEntitlementId: ent.id,
					organizationId: "org-1",
					issueRefund: true,
				}),
				service.dropRegistration({
					classEntitlementId: ent.id,
					organizationId: "org-1",
					issueRefund: true,
				}),
			]);

			const fulfilled = results.filter(
				(
					r,
				): r is PromiseFulfilledResult<
					Awaited<ReturnType<typeof service.dropRegistration>>
				> => r.status === "fulfilled",
			);
			const rejected = results.filter(
				(r): r is PromiseRejectedResult => r.status === "rejected",
			);

			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);

			expect(fulfilled[0].value.success).toBe(true);
			expect(fulfilled[0].value.classEntitlementId).toBe(ent.id);
			expect(fulfilled[0].value.classEntitlement?.status).toBe("cancelled");
			expect(fulfilled[0].value.refundEvent?.status).toBe("completed");
			expect(fulfilled[0].value.refundEvent?.amountCents).toBe(5000);

			expect(rejected[0].reason).toBeInstanceOf(AppError);
			expect((rejected[0].reason as AppError).status).toBe(409);
			expect((rejected[0].reason as AppError).message).toContain("cancelled");

			const logs = await changeRepo.listChangeLogsForEntitlement(
				"org-1",
				ent.id,
			);
			expect(logs).toHaveLength(1);
			expect(logs[0].action).toBe("drop");

			const refundEvents = (
				changeRepo as unknown as { refundEvents: Map<string, unknown> }
			).refundEvents;
			expect(refundEvents.size).toBe(1);
			expect(shopifyRefundCalls).toBe(1);
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

		it("rejects transfer when target class belongs to a different festival", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-diff-fest",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/700",
				shopifyOrderLineGid: "gid://shopify/LineItem/700",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			const classQuery = {
				findFestivalClassConfigurationById: async (
					_org: string,
					_clsOrFest: string,
					_cls?: string,
				) => {
					return {
						id: "class-other-fest",
						festivalId: "fest-different",
						capacity: 10,
					};
				},
			};

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				classQuery,
			});

			try {
				await service.transferRegistration({
					classEntitlementId: ent.id,
					organizationId: "org-1",
					targetFestivalClassId: "class-other-fest",
				});
				expect.unreachable();
			} catch (err: unknown) {
				expect(err).toBeInstanceOf(AppError);
				expect((err as AppError).status).toBe(400);
				expect((err as AppError).message).toBe(
					"Target class does not belong to this festival.",
				);
			}
		});

		it("rejects transfer when target class capacity is unresolvable or negative", async () => {
			const ent = await entitlementsRepo.createClassEntitlement({
				id: "ent-unknown-class",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: "class-violin-1",
				parentCustomerId: "parent-1",
				childId: "child-1",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/800",
				shopifyOrderLineGid: "gid://shopify/LineItem/800",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				classQuery: new Map([["class-negative", -1]]),
			});

			await expect(
				service.transferRegistration({
					classEntitlementId: ent.id,
					organizationId: "org-1",
					targetFestivalClassId: "class-non-existent",
				}),
			).rejects.toThrow("Target class does not belong to this festival.");

			await expect(
				service.transferRegistration({
					classEntitlementId: ent.id,
					organizationId: "org-1",
					targetFestivalClassId: "class-negative",
				}),
			).rejects.toThrow("Target class does not belong to this festival.");
		});

		it("serializes concurrent transfers to enforce target class capacity limit strictly without overbooking", async () => {
			const targetClass = "class-target-cap-1";
			const sourceClass = "class-source-cap-5";

			const classCapacities = new Map<string, number>([
				[sourceClass, 5],
				[targetClass, 1],
			]);

			const entA = await entitlementsRepo.createClassEntitlement({
				id: "ent-transfer-concurrent-a",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: sourceClass,
				parentCustomerId: "parent-a",
				childId: "child-a",
				checkoutIntentId: "intent-a",
				shopifyOrderGid: "gid://shopify/Order/801",
				shopifyOrderLineGid: "gid://shopify/LineItem/801",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
				createdAt: "2026-09-20T10:00:00Z",
			});

			const entB = await entitlementsRepo.createClassEntitlement({
				id: "ent-transfer-concurrent-b",
				organizationId: "org-1",
				festivalId: "fest-1",
				festivalClassId: sourceClass,
				parentCustomerId: "parent-b",
				childId: "child-b",
				checkoutIntentId: "intent-b",
				shopifyOrderGid: "gid://shopify/Order/802",
				shopifyOrderLineGid: "gid://shopify/LineItem/802",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
				createdAt: "2026-09-20T10:05:00Z",
			});

			const service = new DropTransferService({
				entitlements: entitlementsRepo,
				changes: changeRepo,
				classQuery: classCapacities,
			});

			const [resultA, resultB] = await Promise.all([
				service.transferRegistration({
					classEntitlementId: entA.id,
					organizationId: "org-1",
					targetFestivalClassId: targetClass,
				}),
				service.transferRegistration({
					classEntitlementId: entB.id,
					organizationId: "org-1",
					targetFestivalClassId: targetClass,
				}),
			]);

			expect(resultA.success).toBe(true);
			expect(resultB.success).toBe(true);

			const updatedA = await entitlementsRepo.getClassEntitlement(
				"org-1",
				entA.id,
			);
			const updatedB = await entitlementsRepo.getClassEntitlement(
				"org-1",
				entB.id,
			);

			expect(updatedA?.festivalClassId).toBe(targetClass);
			expect(updatedB?.festivalClassId).toBe(targetClass);

			const statuses = [updatedA?.status, updatedB?.status].sort();
			expect(statuses).toEqual(["confirmed", "waitlisted"]);

			const confirmedList = await entitlementsRepo.listClassEntitlements({
				festivalClassId: targetClass,
				status: "confirmed",
			});
			expect(confirmedList).toHaveLength(1);
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

	describe("AsyncLock", () => {
		it("acquires sorted keys to prevent deadlocks under concurrent execution", async () => {
			const lock = new AsyncLock();
			const order: number[] = [];

			const t1 = lock.acquire(["keyB", "keyA"], async () => {
				order.push(1);
				await new Promise((resolve) => setTimeout(resolve, 10));
				order.push(2);
			});

			const t2 = lock.acquire(["keyA", "keyB"], async () => {
				order.push(3);
				await new Promise((resolve) => setTimeout(resolve, 10));
				order.push(4);
			});

			await Promise.all([t1, t2]);
			expect(order).toEqual([1, 2, 3, 4]);
		});
	});

	describe("InMemoryOrganizationRepository findFestivalClassConfigurationById", () => {
		it("supports 3 args and 2 args", async () => {
			const orgRepo = new InMemoryOrganizationRepository();
			const org = await orgRepo.createOrganization({
				name: "Org 1",
				slug: "org-1",
			});
			const fest = await orgRepo.createFestival({
				id: "fest-1",
				organizationId: org.id,
				code: "FEST1",
				shortName: "F1",
				name: "Festival 1",
				startDate: "2026-09-01",
				endDate: "2026-09-10",
			});
			const cfg = await orgRepo.createFestivalClassConfiguration({
				organizationId: org.id,
				festivalId: fest.id,
				displayName: "Piano Solo",
				price: 50,
				capacity: 10,
			});

			const with3Args = await orgRepo.findFestivalClassConfigurationById(
				org.id,
				fest.id,
				cfg.id,
			);
			expect(with3Args?.id).toBe(cfg.id);

			const with2Args = await orgRepo.findFestivalClassConfigurationById(
				org.id,
				cfg.id,
			);
			expect(with2Args?.id).toBe(cfg.id);

			const notFound = await orgRepo.findFestivalClassConfigurationById(
				org.id,
				"class-missing",
			);
			expect(notFound).toBeNull();
		});
	});

	describe("ShopifyAdminClient createRefund", () => {
		it("validates orderId and positive amountCents in both mock and live modes", async () => {
			const mockClient = new ShopifyAdminClient({});
			const liveClient = new ShopifyAdminClient({
				shopDomain: "test.myshopify.com",
				accessToken: "shpat_test_token",
			});

			expect(mockClient.mode).toBe("mock");
			expect(liveClient.mode).toBe("live");

			for (const client of [mockClient, liveClient]) {
				// Verify calling shopifyAdminClient.createRefund with missing orderId throws Error "Cannot create refund: missing Shopify order ID."
				await expect(
					client.createRefund({
						orderId: "",
						amountCents: 5000,
					}),
				).rejects.toThrow("Cannot create refund: missing Shopify order ID.");

				await expect(
					client.createRefund({
						orderId: "   ",
						amountCents: 5000,
					}),
				).rejects.toThrow("Cannot create refund: missing Shopify order ID.");

				await expect(
					client.createRefund({
						orderId: undefined as unknown as string,
						amountCents: 5000,
					}),
				).rejects.toThrow("Cannot create refund: missing Shopify order ID.");

				// Verify calling with amountCents: 0 or negative throws Error "Cannot create refund: refund amount must be greater than zero."
				await expect(
					client.createRefund({
						orderId: "gid://shopify/Order/1",
						amountCents: 0,
					}),
				).rejects.toThrow(
					"Cannot create refund: refund amount must be greater than zero.",
				);

				await expect(
					client.createRefund({
						orderId: "gid://shopify/Order/1",
						amountCents: -500,
					}),
				).rejects.toThrow(
					"Cannot create refund: refund amount must be greater than zero.",
				);
			}

			// Verify successful refund execution in mock mode
			const validMockRefund = await mockClient.createRefund({
				orderId: "gid://shopify/Order/1",
				amountCents: 5000,
			});
			expect(validMockRefund.providerMode).toBe("mock");
			expect(validMockRefund.id).toContain("gid://shopify/Refund/mock-");
		});
	});
});
