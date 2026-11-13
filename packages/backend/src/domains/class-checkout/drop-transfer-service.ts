import {
	AppError,
	type ClassEntitlement,
	type DropRegistrationInput,
	type DropRegistrationResult,
	type RegistrationActorRole,
	type TransferRegistrationInput,
	type TransferRegistrationResult,
	type WaitlistPromotionResult,
} from "@festival/common";
import {
	processDropRefundWorkflow,
	resolveDropRefundAmountCents,
	type ShopifyRefundProvider,
} from "./drop-transfer-fees.js";
import {
	AsyncLock,
	assertDroppableEntitlement,
	assertTargetClassInFestival,
	assertTransferableEntitlement,
	type ClassCapacityResolver,
	entitlementStateSnapshot,
	resolveClassCapacity,
} from "./drop-transfer-validation.js";
import type { ClassCheckoutEventBus } from "./events.js";
import type { CheckoutCommerceReadPort } from "./ports.js";
import type { RegistrationChangeRepository } from "./registration-change-repository.js";

export type {
	ShopifyLineTargetedRefundAllocation,
	ShopifyLineTargetedRefundRequest,
	ShopifyLineTargetedRefundResult,
	ShopifyRefundProvider,
} from "./drop-transfer-fees.js";
export type {
	ClassCapacityResolver,
	FestivalClassQueryCapability,
} from "./drop-transfer-validation.js";
export { AsyncLock };

export interface DropTransferServiceOptions {
	entitlements: CheckoutCommerceReadPort;
	changeRepo: RegistrationChangeRepository;
	capacityResolver?: ClassCapacityResolver;
	refundProvider?: ShopifyRefundProvider;
	eventBus?: ClassCheckoutEventBus;
	now?: () => Date;
}

export interface PromoteTopWaitlistedInput {
	organizationId: string;
	festivalClassId: string;
	festivalId?: string;
	actorUid?: string;
	actorRole?: RegistrationActorRole;
	reason?: string | null;
}

export class DropTransferService {
	private readonly lock = new AsyncLock();
	private readonly entitlements: CheckoutCommerceReadPort;
	private readonly changeRepo: RegistrationChangeRepository;
	private readonly capacityResolver?: ClassCapacityResolver;
	private readonly refundProvider?: ShopifyRefundProvider;
	private readonly eventBus?: ClassCheckoutEventBus;
	private readonly now: () => Date;

	constructor(options: DropTransferServiceOptions) {
		this.entitlements = options.entitlements;
		this.changeRepo = options.changeRepo;
		this.capacityResolver = options.capacityResolver;
		this.refundProvider = options.refundProvider;
		this.eventBus = options.eventBus;
		this.now = options.now ?? (() => new Date());
	}

	async getEntitlement(
		organizationId: string,
		classEntitlementId: string,
	): Promise<ClassEntitlement | null> {
		if (!this.entitlements.getClassEntitlement) return null;
		return this.entitlements.getClassEntitlement(
			organizationId,
			classEntitlementId,
		);
	}

	async dropRegistration(
		input: DropRegistrationInput,
	): Promise<DropRegistrationResult> {
		const orgId = input.organizationId ?? "";
		return this.lock.acquire(
			`entitlement:${orgId}:${input.classEntitlementId}`,
			() => this.executeDrop(orgId, input),
		);
	}

	private async executeDrop(
		orgId: string,
		input: DropRegistrationInput,
	): Promise<DropRegistrationResult> {
		const existing = await this.getEntitlement(orgId, input.classEntitlementId);
		assertDroppableEntitlement(existing, input.festivalId);
		const shouldRefund = Boolean(input.issueRefund ?? input.requestRefund);
		if (shouldRefund) {
			resolveDropRefundAmountCents(existing, input.refundAmountCents);
		}
		const previousState = entitlementStateSnapshot(existing);
		const updated = await this.updateEntitlementStatusOrThrow(
			existing.organizationId,
			existing.id,
			"cancelled",
			["confirmed", "waitlisted"],
		);
		const changeLog = await this.changeRepo.createChangeLog({
			organizationId: existing.organizationId,
			festivalId: existing.festivalId,
			classEntitlementId: existing.id,
			action: "drop",
			actorUid: input.actorUid ?? "system",
			actorRole: input.actorRole ?? "customer",
			previousState,
			newState: entitlementStateSnapshot(updated),
			reason: input.reason ?? null,
		});
		const promotedWaitlistEntitlements: WaitlistPromotionResult[] = [];
		if (existing.status === "confirmed") {
			const promo = await this.promoteTopWaitlisted({
				organizationId: existing.organizationId,
				festivalClassId: existing.festivalClassId,
				festivalId: existing.festivalId,
				actorUid: input.actorUid ?? "system",
				actorRole: "system",
			});
			if (promo?.promoted) promotedWaitlistEntitlements.push(promo);
		}
		const refundEvent = shouldRefund
			? await processDropRefundWorkflow({
					changeRepo: this.changeRepo,
					refundProvider: this.refundProvider,
					entitlement: existing,
					changeLogId: changeLog.id,
					refundAmountCents: input.refundAmountCents,
					refundReason: input.refundReason ?? input.reason,
				})
			: null;
		this.emitCapacityChanged(
			orgId,
			existing.festivalId,
			existing.festivalClassId,
		);
		return {
			success: true,
			classEntitlementId: existing.id,
			classEntitlement: updated,
			changeLog,
			refundEvent,
			promotedWaitlistEntitlements,
		};
	}

	async transferRegistration(
		input: TransferRegistrationInput,
	): Promise<TransferRegistrationResult> {
		const orgId = input.organizationId ?? "";
		const initial = await this.getEntitlement(orgId, input.classEntitlementId);
		assertTransferableEntitlement(
			initial,
			input.targetFestivalClassId,
			input.festivalId,
		);
		const targetCapacity = await assertTargetClassInFestival(
			this.capacityResolver,
			initial.organizationId,
			initial.festivalId,
			input.targetFestivalClassId,
		);
		return this.lock.acquire(
			[
				`entitlement:${initial.organizationId}:${initial.id}`,
				`class:${initial.organizationId}:${initial.festivalClassId}`,
				`class:${initial.organizationId}:${input.targetFestivalClassId}`,
			],
			() => this.executeTransfer(initial, input, targetCapacity),
		);
	}

	private async executeTransfer(
		initial: ClassEntitlement,
		input: TransferRegistrationInput,
		targetCapacity: number,
	): Promise<TransferRegistrationResult> {
		const orgId = initial.organizationId;
		const existing = await this.getEntitlement(orgId, initial.id);
		assertTransferableEntitlement(
			existing,
			input.targetFestivalClassId,
			input.festivalId,
		);
		const targetConfirmed = await this.entitlements.listClassEntitlements({
			organizationId: orgId,
			festivalClassId: input.targetFestivalClassId,
			status: "confirmed",
		});
		const nextStatus: ClassEntitlement["status"] =
			targetConfirmed.length < targetCapacity ? "confirmed" : "waitlisted";
		const previousClassId = existing.festivalClassId;
		const previousState = entitlementStateSnapshot(existing);
		const updated = await this.updateEntitlementTransferOrThrow(
			orgId,
			existing.id,
			input.targetFestivalClassId,
			nextStatus,
		);
		const changeLog = await this.changeRepo.createChangeLog({
			organizationId: orgId,
			festivalId: existing.festivalId,
			classEntitlementId: existing.id,
			action: "transfer",
			actorUid: input.actorUid ?? "system",
			actorRole: input.actorRole ?? "customer",
			previousState,
			newState: entitlementStateSnapshot(updated),
			reason: input.reason ?? null,
		});
		const promotedWaitlistEntitlements: WaitlistPromotionResult[] = [];
		if (existing.status === "confirmed") {
			const promo = await this.promoteTopWaitlistedUnlocked({
				organizationId: orgId,
				festivalClassId: previousClassId,
				festivalId: existing.festivalId,
				actorUid: input.actorUid ?? "system",
				actorRole: "system",
			});
			if (promo?.promoted) promotedWaitlistEntitlements.push(promo);
		}
		this.emitCapacityChanged(orgId, existing.festivalId, previousClassId);
		this.emitCapacityChanged(
			orgId,
			existing.festivalId,
			input.targetFestivalClassId,
		);
		return {
			success: true,
			classEntitlementId: existing.id,
			targetFestivalClassId: input.targetFestivalClassId,
			previousFestivalClassId: previousClassId,
			classEntitlement: updated,
			changeLog,
			refundEvent: null,
			promotedWaitlistEntitlements,
		};
	}

	async promoteTopWaitlisted(
		input: PromoteTopWaitlistedInput,
	): Promise<WaitlistPromotionResult | null> {
		return this.lock.acquire(
			`class:${input.organizationId}:${input.festivalClassId}`,
			() => this.promoteTopWaitlistedUnlocked(input),
		);
	}

	private async promoteTopWaitlistedUnlocked(
		input: PromoteTopWaitlistedInput,
	): Promise<WaitlistPromotionResult | null> {
		const capacity = await resolveClassCapacity(
			this.capacityResolver,
			input.organizationId,
			input.festivalId,
			input.festivalClassId,
		);
		const confirmed = await this.entitlements.listClassEntitlements({
			organizationId: input.organizationId,
			festivalClassId: input.festivalClassId,
			status: "confirmed",
		});
		if (capacity !== null && confirmed.length >= capacity) {
			return null;
		}
		const waitlisted = await this.entitlements.listClassEntitlements({
			organizationId: input.organizationId,
			festivalClassId: input.festivalClassId,
			status: "waitlisted",
		});
		const top = waitlisted.sort(
			(a, b) =>
				a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
		)[0];
		if (!top) return null;
		return this.executePromotion(top, {
			organizationId: input.organizationId,
			actorUid: input.actorUid,
			actorRole: input.actorRole ?? "system",
			reason: input.reason ?? "Waitlist promotion on drop/transfer",
		});
	}

	async promoteRegistration(input: {
		organizationId: string;
		classEntitlementId: string;
		festivalId?: string;
		actorUid?: string;
		actorRole?: RegistrationActorRole;
		reason?: string | null;
	}): Promise<WaitlistPromotionResult> {
		const existing = await this.getEntitlement(
			input.organizationId,
			input.classEntitlementId,
		);
		if (!existing) {
			throw new AppError("Class entitlement not found.", 404);
		}
		if (input.festivalId && existing.festivalId !== input.festivalId) {
			throw new AppError(
				"Class entitlement does not belong to this festival.",
				400,
			);
		}
		if (existing.status !== "waitlisted") {
			throw new AppError(
				`Cannot promote registration with status "${existing.status}".`,
				400,
			);
		}
		return this.lock.acquire(
			`class:${input.organizationId}:${existing.festivalClassId}`,
			() =>
				this.executePromotion(existing, {
					...input,
					actorRole: input.actorRole ?? "admin",
					reason: input.reason ?? "Admin manual waitlist promotion",
				}),
		);
	}

	private async executePromotion(
		existing: ClassEntitlement,
		input: {
			organizationId: string;
			actorUid?: string;
			actorRole?: RegistrationActorRole;
			reason?: string | null;
		},
	): Promise<WaitlistPromotionResult> {
		const previousState = entitlementStateSnapshot(existing);
		const updated = await this.updateEntitlementStatusOrThrow(
			input.organizationId,
			existing.id,
			"confirmed",
			"waitlisted",
		);
		const changeLog = await this.changeRepo.createChangeLog({
			organizationId: input.organizationId,
			festivalId: existing.festivalId,
			classEntitlementId: existing.id,
			action: "waitlist_promote",
			actorUid: input.actorUid ?? "system",
			actorRole: input.actorRole ?? "admin",
			previousState,
			newState: entitlementStateSnapshot(updated),
			reason: input.reason ?? null,
		});
		this.emitCapacityChanged(
			input.organizationId,
			existing.festivalId,
			existing.festivalClassId,
		);
		return {
			classEntitlementId: existing.id,
			festivalClassId: existing.festivalClassId,
			promoted: true,
			previousStatus: existing.status,
			newStatus: updated.status,
			changeLog,
		};
	}

	private async updateEntitlementStatusOrThrow(
		organizationId: string,
		entitlementId: string,
		status: ClassEntitlement["status"],
		expectedStatus: ClassEntitlement["status"] | ClassEntitlement["status"][],
	): Promise<ClassEntitlement> {
		const updated = this.entitlements.updateClassEntitlement
			? await this.entitlements.updateClassEntitlement(
					organizationId,
					entitlementId,
					{ status, expectedStatus },
					expectedStatus,
				)
			: null;
		if (!updated) {
			throw new AppError(
				"Registration state changed concurrently; update rejected.",
				409,
			);
		}
		return updated;
	}

	private async updateEntitlementTransferOrThrow(
		organizationId: string,
		entitlementId: string,
		targetFestivalClassId: string,
		status: ClassEntitlement["status"],
	): Promise<ClassEntitlement> {
		const updated = this.entitlements.updateClassEntitlement
			? await this.entitlements.updateClassEntitlement(
					organizationId,
					entitlementId,
					{
						festivalClassId: targetFestivalClassId,
						status,
						expectedStatus: ["confirmed", "waitlisted"],
					},
					["confirmed", "waitlisted"],
				)
			: null;
		if (!updated) {
			throw new AppError(
				"Registration state changed concurrently; transfer rejected.",
				409,
			);
		}
		return updated;
	}

	private emitCapacityChanged(
		organizationId: string,
		festivalId: string,
		festivalClassId: string,
	): void {
		this.eventBus?.emit({
			type: "ClassCapacityChanged",
			organizationId,
			festivalId,
			festivalClassId,
		});
	}
}
