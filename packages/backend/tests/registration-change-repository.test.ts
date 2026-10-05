import { describe, expect, it } from "bun:test";
import type {
	RefundEventStatus,
	RegistrationActorRole,
	RegistrationChangeAction,
} from "@festival/common";
import {
	InMemoryRegistrationChangeRepository,
	PostgresRegistrationChangeRepository,
} from "../src/registration/registration-change-repository.js";

describe("RegistrationChangeRepository", () => {
	describe("InMemoryRegistrationChangeRepository", () => {
		it("creates a change log and lists by entitlement", async () => {
			const repo = new InMemoryRegistrationChangeRepository();
			const created = await repo.createChangeLog({
				organizationId: "org-1",
				festivalId: "fest-1",
				classEntitlementId: "ent-1",
				action: "drop",
				actorUid: "user-1",
				actorRole: "customer",
				previousState: { status: "confirmed" },
				newState: { status: "cancelled" },
				reason: "Schedule conflict",
			});

			expect(created.id).toBeDefined();
			expect(created.organizationId).toBe("org-1");
			expect(created.classEntitlementId).toBe("ent-1");
			expect(created.action).toBe("drop");
			expect(created.actorRole).toBe("customer");
			expect(created.reason).toBe("Schedule conflict");

			const logs = await repo.listChangeLogsForEntitlement("org-1", "ent-1");
			expect(logs).toHaveLength(1);
			expect(logs[0].id).toBe(created.id);
		});

		it("rejects invalid action or actor role in change log", async () => {
			const repo = new InMemoryRegistrationChangeRepository();
			await expect(
				repo.createChangeLog({
					organizationId: "org-1",
					classEntitlementId: "ent-1",
					action: "invalid_action" as unknown as RegistrationChangeAction,
					actorUid: "user-1",
					actorRole: "customer",
					previousState: {},
					newState: {},
				}),
			).rejects.toThrow("Registration change action is invalid.");

			await expect(
				repo.createChangeLog({
					organizationId: "org-1",
					classEntitlementId: "ent-1",
					action: "drop",
					actorUid: "user-1",
					actorRole: "invalid_role" as unknown as RegistrationActorRole,
					previousState: {},
					newState: {},
				}),
			).rejects.toThrow("Registration actor role is invalid.");
		});

		it("sorts change logs for entitlement by createdAt DESC", async () => {
			const repo = new InMemoryRegistrationChangeRepository();
			await repo.createChangeLog({
				id: "log-1",
				organizationId: "org-1",
				classEntitlementId: "ent-1",
				action: "transfer",
				actorUid: "user-1",
				actorRole: "customer",
				previousState: { classId: "c-1" },
				newState: { classId: "c-2" },
				createdAt: "2026-09-27T10:00:00Z",
			});

			await repo.createChangeLog({
				id: "log-2",
				organizationId: "org-1",
				classEntitlementId: "ent-1",
				action: "drop",
				actorUid: "user-1",
				actorRole: "customer",
				previousState: { status: "confirmed" },
				newState: { status: "cancelled" },
				createdAt: "2026-09-27T11:00:00Z",
			});

			const logs = await repo.listChangeLogsForEntitlement("ent-1");
			expect(logs).toHaveLength(2);
			expect(logs[0].id).toBe("log-2");
			expect(logs[1].id).toBe("log-1");
		});

		it("isolates change logs across organizations and entitlements", async () => {
			const repo = new InMemoryRegistrationChangeRepository();
			await repo.createChangeLog({
				organizationId: "org-1",
				classEntitlementId: "ent-1",
				action: "drop",
				actorUid: "user-1",
				actorRole: "customer",
				previousState: {},
				newState: {},
			});
			await repo.createChangeLog({
				organizationId: "org-2",
				classEntitlementId: "ent-1",
				action: "drop",
				actorUid: "user-2",
				actorRole: "customer",
				previousState: {},
				newState: {},
			});

			const logsOrg1 = await repo.listChangeLogsForEntitlement(
				"org-1",
				"ent-1",
			);
			expect(logsOrg1).toHaveLength(1);
			expect(logsOrg1[0].organizationId).toBe("org-1");

			const logsOrg2 = await repo.listChangeLogsForEntitlement(
				"org-2",
				"ent-1",
			);
			expect(logsOrg2).toHaveLength(1);
			expect(logsOrg2[0].organizationId).toBe("org-2");
		});

		it("creates, retrieves, and updates refund events", async () => {
			const repo = new InMemoryRegistrationChangeRepository();
			const refund = await repo.createRefundEvent({
				organizationId: "org-1",
				classEntitlementId: "ent-1",
				shopifyOrderId: "gid://shopify/Order/1",
				shopifyOrderLineId: "gid://shopify/LineItem/1",
				amountCents: 5000,
			});

			expect(refund.id).toBeDefined();
			expect(refund.amountCents).toBe(5000);
			expect(refund.currency).toBe("USD");
			expect(refund.status).toBe("pending");
			expect(refund.shopifyOrderLineId).toBe("gid://shopify/LineItem/1");

			const retrieved = await repo.getRefundEvent("org-1", refund.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved?.id).toBe(refund.id);
			expect(retrieved?.shopifyOrderLineId).toBe("gid://shopify/LineItem/1");

			const retrievedWithoutOrg = await repo.getRefundEvent(refund.id);
			expect(retrievedWithoutOrg?.id).toBe(refund.id);

			const updated = await repo.updateRefundEventStatus({
				id: refund.id,
				organizationId: "org-1",
				status: "completed",
				shopifyRefundId: "gid://shopify/Refund/101",
			});
			expect(updated?.status).toBe("completed");
			expect(updated?.shopifyRefundId).toBe("gid://shopify/Refund/101");

			const failed = await repo.updateRefundEventStatus(
				"org-1",
				refund.id,
				"failed",
				"Gateway timeout",
			);
			expect(failed?.status).toBe("failed");
			expect(failed?.failureReason).toBe("Gateway timeout");
		});

		it("rejects invalid refund status", async () => {
			const repo = new InMemoryRegistrationChangeRepository();
			await expect(
				repo.createRefundEvent({
					organizationId: "org-1",
					amountCents: 1000,
					status: "invalid" as unknown as RefundEventStatus,
				}),
			).rejects.toThrow("Refund event status is invalid.");

			await expect(
				repo.updateRefundEventStatus({
					id: "rf-1",
					status: "invalid" as unknown as RefundEventStatus,
				}),
			).rejects.toThrow("Refund event status is invalid.");
		});

		it("returns null when updating non-existent refund event", async () => {
			const repo = new InMemoryRegistrationChangeRepository();
			const res = await repo.updateRefundEventStatus({
				id: "missing-id",
				status: "completed",
			});
			expect(res).toBeNull();
		});
	});

	describe("PostgresRegistrationChangeRepository", () => {
		it("constructs and enforces schema name check", () => {
			expect(
				() => new PostgresRegistrationChangeRepository("bad;schema"),
			).toThrow("Database schema is invalid.");
			const repo = new PostgresRegistrationChangeRepository("valid_schema");
			expect(repo).toBeInstanceOf(PostgresRegistrationChangeRepository);
		});
	});
});
