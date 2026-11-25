import type {
	ClassEntitlement,
	DropRegistrationInput,
	DropRegistrationResult,
	RegistrationActorRole,
	TransferRegistrationInput,
	TransferRegistrationResult,
	WaitlistPromotionResult,
} from "@festival/common";
import type { ShopifyRefundProvider } from "./drop-transfer-fees.js";
import {
	type DropTransferOpsContext,
	executeDropOp,
	executePromotionOp,
	executeTransferOp,
	getEntitlementOp,
	type PromoteTopWaitlistedParams,
	promoteTopWaitlistedUnlockedOp,
} from "./drop-transfer-ops.js";
import {
	AsyncLock,
	assertDroppableEntitlement,
	assertPromotableEntitlement,
	assertTargetClassInFestival,
	assertTransferableEntitlement,
	type ClassCapacityResolver,
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

export type PromoteTopWaitlistedInput = PromoteTopWaitlistedParams;

const RETRY_CLASS_LOCK = Symbol("RETRY_CLASS_LOCK");

export class DropTransferService {
	private readonly lock = new AsyncLock();
	private readonly ops: DropTransferOpsContext;

	constructor(options: DropTransferServiceOptions) {
		this.ops = {
			entitlements: options.entitlements,
			changeRepo: options.changeRepo,
			capacityResolver: options.capacityResolver,
			refundProvider: options.refundProvider,
			eventBus: options.eventBus,
		};
	}

	async getEntitlement(
		organizationId: string,
		classEntitlementId: string,
	): Promise<ClassEntitlement | null> {
		return getEntitlementOp(
			this.ops.entitlements,
			organizationId,
			classEntitlementId,
		);
	}

	async dropRegistration(
		input: DropRegistrationInput,
	): Promise<DropRegistrationResult> {
		const orgId = input.organizationId ?? "";
		const initial = await this.getEntitlement(orgId, input.classEntitlementId);
		assertDroppableEntitlement(initial, input.festivalId);
		const resolvedOrgId = initial.organizationId;
		let lockedClassId = initial.festivalClassId;

		while (true) {
			const outcome = await this.lock.acquire(
				[
					`entitlement:${resolvedOrgId}:${initial.id}`,
					`class:${resolvedOrgId}:${lockedClassId}`,
				],
				async () => {
					const current = await this.getEntitlement(resolvedOrgId, initial.id);
					assertDroppableEntitlement(current, input.festivalId);
					if (current.festivalClassId !== lockedClassId) {
						lockedClassId = current.festivalClassId;
						return RETRY_CLASS_LOCK;
					}
					return executeDropOp(this.ops, current, input);
				},
			);
			if (outcome !== RETRY_CLASS_LOCK) return outcome;
		}
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
			this.ops.capacityResolver,
			initial.organizationId,
			initial.festivalId,
			input.targetFestivalClassId,
		);
		const resolvedOrgId = initial.organizationId;
		let lockedClassId = initial.festivalClassId;

		while (true) {
			const outcome = await this.lock.acquire(
				[
					`entitlement:${resolvedOrgId}:${initial.id}`,
					`class:${resolvedOrgId}:${lockedClassId}`,
					`class:${resolvedOrgId}:${input.targetFestivalClassId}`,
				],
				async () => {
					const current = await this.getEntitlement(resolvedOrgId, initial.id);
					assertTransferableEntitlement(
						current,
						input.targetFestivalClassId,
						input.festivalId,
					);
					if (current.festivalClassId !== lockedClassId) {
						lockedClassId = current.festivalClassId;
						return RETRY_CLASS_LOCK;
					}
					return executeTransferOp(this.ops, {
						existing: current,
						input,
						targetCapacity,
					});
				},
			);
			if (outcome !== RETRY_CLASS_LOCK) return outcome;
		}
	}

	async promoteTopWaitlisted(
		input: PromoteTopWaitlistedInput,
	): Promise<WaitlistPromotionResult | null> {
		return this.lock.acquire(
			`class:${input.organizationId}:${input.festivalClassId}`,
			() => promoteTopWaitlistedUnlockedOp(this.ops, input),
		);
	}

	async promoteRegistration(input: {
		organizationId: string;
		classEntitlementId: string;
		festivalId?: string;
		actorUid?: string;
		actorRole?: RegistrationActorRole;
		reason?: string | null;
	}): Promise<WaitlistPromotionResult> {
		const initial = await this.getEntitlement(
			input.organizationId,
			input.classEntitlementId,
		);
		assertPromotableEntitlement(initial, input.festivalId);
		const resolvedOrgId = initial.organizationId;
		let lockedClassId = initial.festivalClassId;

		while (true) {
			const outcome = await this.lock.acquire(
				[
					`entitlement:${resolvedOrgId}:${initial.id}`,
					`class:${resolvedOrgId}:${lockedClassId}`,
				],
				async () => {
					const current = await this.getEntitlement(resolvedOrgId, initial.id);
					assertPromotableEntitlement(current, input.festivalId);
					if (current.festivalClassId !== lockedClassId) {
						lockedClassId = current.festivalClassId;
						return RETRY_CLASS_LOCK;
					}
					return executePromotionOp(this.ops, current, {
						...input,
						actorRole: input.actorRole ?? "admin",
						reason: input.reason ?? "Admin manual waitlist promotion",
					});
				},
			);
			if (outcome !== RETRY_CLASS_LOCK) return outcome;
		}
	}
}
