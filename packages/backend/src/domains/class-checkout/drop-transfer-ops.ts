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
	assertDroppableEntitlement,
	assertTransferableEntitlement,
	type ClassCapacityResolver,
	entitlementStateSnapshot,
	resolveClassCapacity,
} from "./drop-transfer-validation.js";
import type { ClassCheckoutEventBus } from "./events.js";
import type { CheckoutCommerceReadPort } from "./ports.js";
import type { RegistrationChangeRepository } from "./registration-change-repository.js";

export interface DropTransferOpsContext {
	entitlements: CheckoutCommerceReadPort;
	changeRepo: RegistrationChangeRepository;
	capacityResolver?: ClassCapacityResolver;
	refundProvider?: ShopifyRefundProvider;
	eventBus?: ClassCheckoutEventBus;
}

export interface PromoteTopWaitlistedParams {
	organizationId: string;
	festivalClassId: string;
	festivalId?: string;
	actorUid?: string;
	actorRole?: RegistrationActorRole;
	reason?: string | null;
}

export function emitCapacityChanged(
	eventBus: ClassCheckoutEventBus | undefined,
	organizationId: string,
	festivalId: string,
	festivalClassId: string,
): void {
	eventBus?.emit({
		type: "ClassCapacityChanged",
		organizationId,
		festivalId,
		festivalClassId,
	});
}

export async function getEntitlementOp(
	entitlements: CheckoutCommerceReadPort,
	organizationId: string,
	classEntitlementId: string,
): Promise<ClassEntitlement | null> {
	if (!entitlements.getClassEntitlement) return null;
	return entitlements.getClassEntitlement(organizationId, classEntitlementId);
}

export async function updateEntitlementStatusOrThrow(
	entitlements: CheckoutCommerceReadPort,
	organizationId: string,
	entitlementId: string,
	status: ClassEntitlement["status"],
	expectedStatus: ClassEntitlement["status"] | ClassEntitlement["status"][],
): Promise<ClassEntitlement> {
	const updated = entitlements.updateClassEntitlement
		? await entitlements.updateClassEntitlement(
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

async function updateEntitlementTransferOrThrow(
	entitlements: CheckoutCommerceReadPort,
	organizationId: string,
	entitlementId: string,
	targetFestivalClassId: string,
	status: ClassEntitlement["status"],
): Promise<ClassEntitlement> {
	const updated = entitlements.updateClassEntitlement
		? await entitlements.updateClassEntitlement(
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

export async function executePromotionOp(
	ctx: DropTransferOpsContext,
	existing: ClassEntitlement,
	input: {
		organizationId: string;
		actorUid?: string;
		actorRole?: RegistrationActorRole;
		reason?: string | null;
	},
): Promise<WaitlistPromotionResult> {
	const previousState = entitlementStateSnapshot(existing);
	const updated = await updateEntitlementStatusOrThrow(
		ctx.entitlements,
		input.organizationId,
		existing.id,
		"confirmed",
		"waitlisted",
	);
	const changeLog = await ctx.changeRepo.createChangeLog({
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
	emitCapacityChanged(
		ctx.eventBus,
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

export async function promoteTopWaitlistedUnlockedOp(
	ctx: DropTransferOpsContext,
	input: PromoteTopWaitlistedParams,
): Promise<WaitlistPromotionResult | null> {
	const capacity = await resolveClassCapacity(
		ctx.capacityResolver,
		input.organizationId,
		input.festivalId,
		input.festivalClassId,
	);
	const confirmed = await ctx.entitlements.listClassEntitlements({
		organizationId: input.organizationId,
		festivalClassId: input.festivalClassId,
		status: "confirmed",
	});
	if (capacity !== null && confirmed.length >= capacity) {
		return null;
	}
	const waitlisted = await ctx.entitlements.listClassEntitlements({
		organizationId: input.organizationId,
		festivalClassId: input.festivalClassId,
		status: "waitlisted",
	});
	const top = waitlisted.sort(
		(a, b) =>
			a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
	)[0];
	if (!top) return null;
	return executePromotionOp(ctx, top, {
		organizationId: input.organizationId,
		actorUid: input.actorUid,
		actorRole: input.actorRole ?? "system",
		reason: input.reason ?? "Waitlist promotion on drop/transfer",
	});
}

async function finalizeDropSideEffects(
	ctx: DropTransferOpsContext,
	params: {
		orgId: string;
		existing: ClassEntitlement;
		changeLogId: string;
		shouldRefund: boolean;
		input: DropRegistrationInput;
		promoteLocked: (
			params: PromoteTopWaitlistedParams,
		) => Promise<WaitlistPromotionResult | null>;
	},
) {
	const { existing, input } = params;
	const promotedWaitlistEntitlements: WaitlistPromotionResult[] = [];
	if (existing.status === "confirmed") {
		const promo = await params.promoteLocked({
			organizationId: existing.organizationId,
			festivalClassId: existing.festivalClassId,
			festivalId: existing.festivalId,
			actorUid: input.actorUid ?? "system",
			actorRole: "system",
		});
		if (promo?.promoted) promotedWaitlistEntitlements.push(promo);
	}
	const refundEvent = params.shouldRefund
		? await processDropRefundWorkflow({
				changeRepo: ctx.changeRepo,
				refundProvider: ctx.refundProvider,
				entitlement: existing,
				changeLogId: params.changeLogId,
				refundAmountCents: input.refundAmountCents,
				refundReason: input.refundReason ?? input.reason,
			})
		: null;
	emitCapacityChanged(
		ctx.eventBus,
		params.orgId,
		existing.festivalId,
		existing.festivalClassId,
	);
	return { promotedWaitlistEntitlements, refundEvent };
}

export async function executeDropOp(
	ctx: DropTransferOpsContext,
	orgId: string,
	input: DropRegistrationInput,
	promoteLocked: (
		params: PromoteTopWaitlistedParams,
	) => Promise<WaitlistPromotionResult | null>,
): Promise<DropRegistrationResult> {
	const existing = await getEntitlementOp(
		ctx.entitlements,
		orgId,
		input.classEntitlementId,
	);
	assertDroppableEntitlement(existing, input.festivalId);
	const shouldRefund = Boolean(input.issueRefund ?? input.requestRefund);
	if (shouldRefund) {
		resolveDropRefundAmountCents(existing, input.refundAmountCents);
	}
	const previousState = entitlementStateSnapshot(existing);
	const updated = await updateEntitlementStatusOrThrow(
		ctx.entitlements,
		existing.organizationId,
		existing.id,
		"cancelled",
		["confirmed", "waitlisted"],
	);
	const changeLog = await ctx.changeRepo.createChangeLog({
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
	const { promotedWaitlistEntitlements, refundEvent } =
		await finalizeDropSideEffects(ctx, {
			orgId,
			existing,
			changeLogId: changeLog.id,
			shouldRefund,
			input,
			promoteLocked,
		});
	return {
		success: true,
		classEntitlementId: existing.id,
		classEntitlement: updated,
		changeLog,
		refundEvent,
		promotedWaitlistEntitlements,
	};
}

async function finalizeTransferSideEffects(
	ctx: DropTransferOpsContext,
	orgId: string,
	existing: ClassEntitlement,
	previousClassId: string,
	input: TransferRegistrationInput,
): Promise<WaitlistPromotionResult[]> {
	const promotedWaitlistEntitlements: WaitlistPromotionResult[] = [];
	if (existing.status === "confirmed") {
		const promo = await promoteTopWaitlistedUnlockedOp(ctx, {
			organizationId: orgId,
			festivalClassId: previousClassId,
			festivalId: existing.festivalId,
			actorUid: input.actorUid ?? "system",
			actorRole: "system",
		});
		if (promo?.promoted) promotedWaitlistEntitlements.push(promo);
	}
	emitCapacityChanged(
		ctx.eventBus,
		orgId,
		existing.festivalId,
		previousClassId,
	);
	emitCapacityChanged(
		ctx.eventBus,
		orgId,
		existing.festivalId,
		input.targetFestivalClassId,
	);
	return promotedWaitlistEntitlements;
}

export async function executeTransferOp(
	ctx: DropTransferOpsContext,
	initial: ClassEntitlement,
	input: TransferRegistrationInput,
	targetCapacity: number,
): Promise<TransferRegistrationResult> {
	const orgId = initial.organizationId;
	const existing = await getEntitlementOp(ctx.entitlements, orgId, initial.id);
	assertTransferableEntitlement(
		existing,
		input.targetFestivalClassId,
		input.festivalId,
	);
	const targetConfirmed = await ctx.entitlements.listClassEntitlements({
		organizationId: orgId,
		festivalClassId: input.targetFestivalClassId,
		status: "confirmed",
	});
	const nextStatus: ClassEntitlement["status"] =
		targetConfirmed.length < targetCapacity ? "confirmed" : "waitlisted";
	const previousClassId = existing.festivalClassId;
	const previousState = entitlementStateSnapshot(existing);
	const updated = await updateEntitlementTransferOrThrow(
		ctx.entitlements,
		orgId,
		existing.id,
		input.targetFestivalClassId,
		nextStatus,
	);
	const changeLog = await ctx.changeRepo.createChangeLog({
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
	const promotedWaitlistEntitlements = await finalizeTransferSideEffects(
		ctx,
		orgId,
		existing,
		previousClassId,
		input,
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
