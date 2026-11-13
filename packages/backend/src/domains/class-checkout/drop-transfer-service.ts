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
		return this.lock.acquire(
			`entitlement:${orgId}:${input.classEntitlementId}`,
			() =>
				executeDropOp(this.ops, orgId, input, (promo) =>
					this.promoteTopWaitlisted(promo),
				),
		);
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
		return this.lock.acquire(
			[
				`entitlement:${initial.organizationId}:${initial.id}`,
				`class:${initial.organizationId}:${initial.festivalClassId}`,
				`class:${initial.organizationId}:${input.targetFestivalClassId}`,
			],
			() => executeTransferOp(this.ops, initial, input, targetCapacity),
		);
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
				executePromotionOp(this.ops, existing, {
					...input,
					actorRole: input.actorRole ?? "admin",
					reason: input.reason ?? "Admin manual waitlist promotion",
				}),
		);
	}
}
