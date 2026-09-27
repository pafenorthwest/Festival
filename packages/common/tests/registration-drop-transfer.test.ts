import { describe, expect, it } from "bun:test";
import {
	assertValidDropRegistrationInput,
	assertValidTransferRegistrationInput,
	type DropRegistrationInput,
	type DropRegistrationResult,
	isRefundEventStatus,
	isRegistrationActorRole,
	isRegistrationChangeAction,
	REFUND_EVENT_STATUSES,
	REGISTRATION_ACTOR_ROLES,
	REGISTRATION_CHANGE_ACTIONS,
	type RefundEvent,
	type RegistrationActorRole,
	type RegistrationChangeAction,
	type RegistrationChangeLog,
	type TransferRegistrationInput,
	type TransferRegistrationResult,
	validateDropRegistrationInput,
	validateTransferRegistrationInput,
	type WaitlistPromotionResult,
} from "../src/index.js";

describe("registration drop, transfer, and change log domain", () => {
	describe("RegistrationChangeAction constants and type guards", () => {
		it("includes expected actions", () => {
			expect(REGISTRATION_CHANGE_ACTIONS).toContain("drop");
			expect(REGISTRATION_CHANGE_ACTIONS).toContain("transfer");
			expect(REGISTRATION_CHANGE_ACTIONS).toContain("waitlist_promote");
			expect(REGISTRATION_CHANGE_ACTIONS).toContain("revert");
			const action: RegistrationChangeAction = "drop";
			expect(isRegistrationChangeAction(action)).toBe(true);
		});

		it("validates actions correctly with isRegistrationChangeAction", () => {
			expect(isRegistrationChangeAction("drop")).toBe(true);
			expect(isRegistrationChangeAction("transfer")).toBe(true);
			expect(isRegistrationChangeAction("waitlist_promote")).toBe(true);
			expect(isRegistrationChangeAction("revert")).toBe(true);
			expect(isRegistrationChangeAction("unknown")).toBe(false);
			expect(isRegistrationChangeAction("")).toBe(false);
			expect(isRegistrationChangeAction(null)).toBe(false);
			expect(isRegistrationChangeAction(undefined)).toBe(false);
			expect(isRegistrationChangeAction(123)).toBe(false);
		});
	});

	describe("RegistrationActorRole constants and type guards", () => {
		it("includes expected actor roles", () => {
			expect(REGISTRATION_ACTOR_ROLES).toContain("customer");
			expect(REGISTRATION_ACTOR_ROLES).toContain("admin");
			expect(REGISTRATION_ACTOR_ROLES).toContain("system");
			const role: RegistrationActorRole = "customer";
			expect(isRegistrationActorRole(role)).toBe(true);
		});

		it("validates actor roles correctly with isRegistrationActorRole", () => {
			expect(isRegistrationActorRole("customer")).toBe(true);
			expect(isRegistrationActorRole("admin")).toBe(true);
			expect(isRegistrationActorRole("system")).toBe(true);
			expect(isRegistrationActorRole("teacher")).toBe(false);
			expect(isRegistrationActorRole(null)).toBe(false);
			expect(isRegistrationActorRole(undefined)).toBe(false);
			expect(isRegistrationActorRole({})).toBe(false);
		});
	});

	describe("RefundEvent and RefundEventStatus", () => {
		it("includes expected refund event statuses", () => {
			expect(REFUND_EVENT_STATUSES).toContain("pending");
			expect(REFUND_EVENT_STATUSES).toContain("completed");
			expect(REFUND_EVENT_STATUSES).toContain("failed");
		});

		it("validates refund event statuses with isRefundEventStatus", () => {
			expect(isRefundEventStatus("pending")).toBe(true);
			expect(isRefundEventStatus("completed")).toBe(true);
			expect(isRefundEventStatus("failed")).toBe(true);
			expect(isRefundEventStatus("cancelled")).toBe(false);
			expect(isRefundEventStatus(null)).toBe(false);
		});

		it("allows constructing typed RefundEvent", () => {
			const event: RefundEvent = {
				id: "rf-1",
				organizationId: "org-1",
				registrationChangeLogId: "log-1",
				classEntitlementId: "ent-1",
				shopifyOrderId: "gid://shopify/Order/1",
				shopifyRefundId: "gid://shopify/Refund/1",
				amountCents: 4500,
				currency: "USD",
				status: "completed",
				failureReason: null,
				createdAt: "2026-09-27T12:00:00Z",
				updatedAt: "2026-09-27T12:01:00Z",
			};
			expect(event.amountCents).toBe(4500);
			expect(event.status).toBe("completed");
		});
	});

	describe("RegistrationChangeLog", () => {
		it("allows constructing typed RegistrationChangeLog", () => {
			const log: RegistrationChangeLog = {
				id: "log-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				classEntitlementId: "ent-1",
				action: "drop",
				actorUid: "user-1",
				actorRole: "customer",
				previousState: { status: "confirmed" },
				newState: { status: "cancelled" },
				reason: "Schedule conflict",
				createdAt: "2026-09-27T12:00:00Z",
			};
			expect(log.action).toBe("drop");
			expect(log.actorRole).toBe("customer");
		});
	});

	describe("validateDropRegistrationInput", () => {
		it("validates minimal valid drop input", () => {
			const input: DropRegistrationInput = {
				classEntitlementId: "ent-100",
			};
			const result = validateDropRegistrationInput(input);
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.classEntitlementId).toBe("ent-100");
		});

		it("accepts id alias for classEntitlementId", () => {
			const result = validateDropRegistrationInput({
				id: "ent-200",
			});
			expect(result.valid).toBe(true);
			expect(result.data?.classEntitlementId).toBe("ent-200");
		});

		it("validates full drop input with all fields and trims strings", () => {
			const result = validateDropRegistrationInput({
				classEntitlementId: " ent-300 ",
				organizationId: " org-1 ",
				festivalId: " fest-1 ",
				actorUid: " uid-1 ",
				actorRole: "admin",
				reason: " Dropping upon parent request ",
				requestRefund: true,
				refundAmountCents: 5000,
				refundReason: " Full refund approved ",
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data).toEqual({
				classEntitlementId: "ent-300",
				organizationId: "org-1",
				festivalId: "fest-1",
				actorUid: "uid-1",
				actorRole: "admin",
				reason: "Dropping upon parent request",
				requestRefund: true,
				issueRefund: true,
				refundAmountCents: 5000,
				refundReason: "Full refund approved",
			});
		});

		it("accepts issueRefund flag as alias for requestRefund", () => {
			const result = validateDropRegistrationInput({
				classEntitlementId: "ent-400",
				issueRefund: true,
			});
			expect(result.valid).toBe(true);
			expect(result.data?.requestRefund).toBe(true);
			expect(result.data?.issueRefund).toBe(true);
		});

		it("handles reason as null", () => {
			const result = validateDropRegistrationInput({
				classEntitlementId: "ent-500",
				reason: null,
			});
			expect(result.valid).toBe(true);
			expect(result.data?.reason).toBeNull();
		});

		it("rejects non-object payload", () => {
			const nullRes = validateDropRegistrationInput(null);
			expect(nullRes.valid).toBe(false);
			expect(nullRes.errors).toContain(
				"Drop registration input must be an object.",
			);

			const arrRes = validateDropRegistrationInput([]);
			expect(arrRes.valid).toBe(false);

			const strRes = validateDropRegistrationInput("string");
			expect(strRes.valid).toBe(false);
		});

		it("rejects missing class entitlement ID", () => {
			const result = validateDropRegistrationInput({});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Class entitlement ID is required.");

			const emptyResult = validateDropRegistrationInput({
				classEntitlementId: "   ",
			});
			expect(emptyResult.valid).toBe(false);
			expect(emptyResult.errors).toContain("Class entitlement ID is required.");
		});

		it("rejects invalid actor role", () => {
			const result = validateDropRegistrationInput({
				classEntitlementId: "ent-1",
				actorRole: "superhero",
			});
			expect(result.valid).toBe(false);
			expect(result.errors[0]).toContain("Invalid actor role");
		});

		it("rejects reason exceeding 500 characters", () => {
			const result = validateDropRegistrationInput({
				classEntitlementId: "ent-1",
				reason: "a".repeat(501),
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Reason must be 500 characters or less.");
		});

		it("rejects refund reason exceeding 500 characters", () => {
			const result = validateDropRegistrationInput({
				classEntitlementId: "ent-1",
				refundReason: "b".repeat(501),
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Refund reason must be 500 characters or less.",
			);
		});

		it("rejects invalid refund amount cents", () => {
			const negative = validateDropRegistrationInput({
				classEntitlementId: "ent-1",
				refundAmountCents: -50,
			});
			expect(negative.valid).toBe(false);
			expect(negative.errors).toContain(
				"Refund amount in cents must be a non-negative integer.",
			);

			const floatVal = validateDropRegistrationInput({
				classEntitlementId: "ent-1",
				refundAmountCents: 12.34,
			});
			expect(floatVal.valid).toBe(false);
			expect(floatVal.errors).toContain(
				"Refund amount in cents must be a non-negative integer.",
			);
		});

		it("assertValidDropRegistrationInput returns valid data or throws", () => {
			const valid = assertValidDropRegistrationInput({
				classEntitlementId: "ent-1",
			});
			expect(valid.classEntitlementId).toBe("ent-1");

			expect(() => assertValidDropRegistrationInput({})).toThrow(
				"Class entitlement ID is required.",
			);
		});
	});

	describe("validateTransferRegistrationInput", () => {
		it("validates minimal valid transfer input", () => {
			const input: TransferRegistrationInput = {
				classEntitlementId: "ent-100",
				targetFestivalClassId: "cls-200",
			};
			const result = validateTransferRegistrationInput(input);
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.classEntitlementId).toBe("ent-100");
			expect(result.data?.targetFestivalClassId).toBe("cls-200");
		});

		it("accepts destination and target aliases for class IDs", () => {
			const destRes = validateTransferRegistrationInput({
				id: "ent-100",
				destinationFestivalClassId: "cls-target-1",
			});
			expect(destRes.valid).toBe(true);
			expect(destRes.data?.classEntitlementId).toBe("ent-100");
			expect(destRes.data?.targetFestivalClassId).toBe("cls-target-1");

			const toRes = validateTransferRegistrationInput({
				classEntitlementId: "ent-100",
				toFestivalClassId: "cls-target-2",
				fromFestivalClassId: "cls-source-1",
			});
			expect(toRes.valid).toBe(true);
			expect(toRes.data?.targetFestivalClassId).toBe("cls-target-2");
			expect(toRes.data?.sourceFestivalClassId).toBe("cls-source-1");
		});

		it("validates full transfer input with repertoire pieces and price difference", () => {
			const result = validateTransferRegistrationInput({
				classEntitlementId: " ent-100 ",
				targetFestivalClassId: " cls-200 ",
				sourceFestivalClassId: " cls-100 ",
				organizationId: " org-1 ",
				festivalId: " fest-1 ",
				actorUid: " admin-1 ",
				actorRole: "admin",
				reason: " Transferred to advanced division ",
				priceDifferenceCents: 1500,
				pieces: [
					{
						title: "Sonata in C",
						composer: "Mozart",
						movement: "I. Allegro",
						durationSeconds: 300,
					},
				],
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data).toEqual({
				classEntitlementId: "ent-100",
				targetFestivalClassId: "cls-200",
				sourceFestivalClassId: "cls-100",
				organizationId: "org-1",
				festivalId: "fest-1",
				actorUid: "admin-1",
				actorRole: "admin",
				reason: "Transferred to advanced division",
				priceDifferenceCents: 1500,
				pieces: [
					{
						title: "Sonata in C",
						composer: "Mozart",
						movement: "I. Allegro",
						durationSeconds: 300,
					},
				],
			});
		});

		it("allows negative price difference for downgrade/partial refund", () => {
			const result = validateTransferRegistrationInput({
				classEntitlementId: "ent-100",
				targetFestivalClassId: "cls-200",
				priceDifferenceCents: -1000,
			});
			expect(result.valid).toBe(true);
			expect(result.data?.priceDifferenceCents).toBe(-1000);
		});

		it("rejects non-object payload", () => {
			const result = validateTransferRegistrationInput(null);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Transfer registration input must be an object.",
			);
		});

		it("rejects missing class entitlement ID", () => {
			const result = validateTransferRegistrationInput({
				targetFestivalClassId: "cls-2",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Class entitlement ID is required.");
		});

		it("rejects missing target festival class ID", () => {
			const result = validateTransferRegistrationInput({
				classEntitlementId: "ent-1",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Target festival class ID is required.");
		});

		it("rejects transfer when target class matches source class", () => {
			const result = validateTransferRegistrationInput({
				classEntitlementId: "ent-1",
				targetFestivalClassId: "cls-same",
				sourceFestivalClassId: "cls-same",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Target festival class must be different from source festival class.",
			);
		});

		it("rejects invalid actor role", () => {
			const result = validateTransferRegistrationInput({
				classEntitlementId: "ent-1",
				targetFestivalClassId: "cls-2",
				actorRole: "invalid",
			});
			expect(result.valid).toBe(false);
			expect(result.errors[0]).toContain("Invalid actor role");
		});

		it("rejects non-integer price difference", () => {
			const result = validateTransferRegistrationInput({
				classEntitlementId: "ent-1",
				targetFestivalClassId: "cls-2",
				priceDifferenceCents: 12.5,
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Price difference in cents must be an integer.",
			);
		});

		it("rejects non-array pieces", () => {
			const result = validateTransferRegistrationInput({
				classEntitlementId: "ent-1",
				targetFestivalClassId: "cls-2",
				pieces: "not an array" as unknown as [],
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Repertoire pieces must be an array.");
		});

		it("rejects invalid pieces in repertoire array", () => {
			const result = validateTransferRegistrationInput({
				classEntitlementId: "ent-1",
				targetFestivalClassId: "cls-2",
				pieces: [
					{
						title: "",
						composer: "Bach",
						durationSeconds: 120,
					},
					{
						title: "Prelude",
						composer: "",
						durationSeconds: -5,
					},
					null as unknown as {
						title: string;
						composer: string;
						durationSeconds: number;
					},
				],
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Piece at index 0 requires a title.");
			expect(result.errors).toContain("Piece at index 1 requires a composer.");
			expect(result.errors).toContain(
				"Piece at index 1 durationSeconds must be a positive integer.",
			);
			expect(result.errors).toContain("Piece at index 2 must be an object.");
		});

		it("assertValidTransferRegistrationInput returns valid data or throws", () => {
			const valid = assertValidTransferRegistrationInput({
				classEntitlementId: "ent-1",
				targetFestivalClassId: "cls-2",
			});
			expect(valid.classEntitlementId).toBe("ent-1");
			expect(valid.targetFestivalClassId).toBe("cls-2");

			expect(() =>
				assertValidTransferRegistrationInput({ classEntitlementId: "ent-1" }),
			).toThrow("Target festival class ID is required.");
		});
	});

	describe("Result interfaces contract verification", () => {
		it("allows constructing valid DropRegistrationResult", () => {
			const dropResult: DropRegistrationResult = {
				success: true,
				classEntitlementId: "ent-1",
				changeLog: {
					id: "log-1",
					organizationId: "org-1",
					classEntitlementId: "ent-1",
					action: "drop",
					actorUid: "admin-1",
					actorRole: "admin",
					previousState: { status: "confirmed" },
					newState: { status: "cancelled" },
					createdAt: "2026-09-27T12:00:00Z",
				},
				refundEvent: {
					id: "rf-1",
					organizationId: "org-1",
					registrationChangeLogId: "log-1",
					classEntitlementId: "ent-1",
					amountCents: 4500,
					currency: "USD",
					status: "completed",
					createdAt: "2026-09-27T12:00:00Z",
					updatedAt: "2026-09-27T12:00:00Z",
				},
				promotedWaitlistEntitlements: [
					{
						classEntitlementId: "ent-waitlisted-1",
						festivalClassId: "cls-1",
						promoted: true,
						previousStatus: "waitlisted",
						newStatus: "confirmed",
					},
				],
				message: "Registration dropped successfully.",
			};
			expect(dropResult.success).toBe(true);
			expect(dropResult.promotedWaitlistEntitlements?.[0].promoted).toBe(true);
		});

		it("allows constructing valid TransferRegistrationResult", () => {
			const transferResult: TransferRegistrationResult = {
				success: true,
				classEntitlementId: "ent-1",
				targetFestivalClassId: "cls-2",
				previousFestivalClassId: "cls-1",
				promotedWaitlistEntitlements: [],
				message: "Registration transferred.",
			};
			expect(transferResult.success).toBe(true);
			expect(transferResult.targetFestivalClassId).toBe("cls-2");
		});

		it("allows constructing valid WaitlistPromotionResult", () => {
			const promotionResult: WaitlistPromotionResult = {
				classEntitlementId: "ent-wait-1",
				festivalClassId: "cls-1",
				promoted: true,
				previousStatus: "waitlisted",
				newStatus: "confirmed",
			};
			expect(promotionResult.promoted).toBe(true);
		});
	});
});
