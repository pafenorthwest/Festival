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
	finalizePendingDropRefund,
	recordInitialDropRefundEvent,
	resolveDropRefundAmountCents,
	type ShopifyRefundProvider,
} from "./drop-transfer-fees.js";
import { runDropTransferTransaction } from "./drop-transfer-transaction.js";
import {
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

export interface PromotionActionInput {
	organizationId: string;
	actorUid?: string;
	actorRole?: RegistrationActorRole;
	reason?: string | null;
}

export function emitCapacityChanged(
	eventBus: ClassCheckoutEventBus | undefined,
	target: {
		organizationId: string;
		festivalId: string;
		festivalClassId: string;
	},
): void {
	eventBus?.emit({
		type: "ClassCapacityChanged",
		organizationId: target.organizationId,
		festivalId: target.festivalId,
		festivalClassId: target.festivalClassId,
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
	params: {
		organizationId: string;
		entitlementId: string;
		status: ClassEntitlement["status"];
		expectedStatus: ClassEntitlement["status"] | ClassEntitlement["status"][];
	},
): Promise<ClassEntitlement> {
	const updated = entitlements.updateClassEntitlement
		? await entitlements.updateClassEntitlement(
				params.organizationId,
				params.entitlementId,
				{ status: params.status, expectedStatus: params.expectedStatus },
				params.expectedStatus,
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
	params: {
		organizationId: string;
		entitlementId: string;
		targetFestivalClassId: string;
		status: ClassEntitlement["status"];
	},
): Promise<ClassEntitlement> {
	const updated = entitlements.updateClassEntitlement
		? await entitlements.updateClassEntitlement(
				params.organizationId,
				params.entitlementId,
				{
					festivalClassId: params.targetFestivalClassId,
					status: params.status,
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

async function executePromotionTxOp(
	txCtx: DropTransferOpsContext,
	existing: ClassEntitlement,
	input: PromotionActionInput,
): Promise<WaitlistPromotionResult> {
	const previousState = entitlementStateSnapshot(existing);
	const updated = await updateEntitlementStatusOrThrow(txCtx.entitlements, {
		organizationId: input.organizationId,
		entitlementId: existing.id,
		status: "confirmed",
		expectedStatus: "waitlisted",
	});
	const changeLog = await txCtx.changeRepo.createChangeLog({
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
	emitCapacityChanged(txCtx.eventBus, {
		organizationId: input.organizationId,
		festivalId: existing.festivalId,
		festivalClassId: existing.festivalClassId,
	});
	return {
		classEntitlementId: existing.id,
		festivalClassId: existing.festivalClassId,
		promoted: true,
		previousStatus: existing.status,
		newStatus: updated.status,
		changeLog,
	};
}

export async function executePromotionOp(
	ctx: DropTransferOpsContext,
	existing: ClassEntitlement,
	input: PromotionActionInput,
): Promise<WaitlistPromotionResult> {
	return runDropTransferTransaction(ctx, (txDeps) =>
		executePromotionTxOp({ ...ctx, ...txDeps }, existing, input),
	);
}

async function promoteTopWaitlistedTxOp(
	txCtx: DropTransferOpsContext,
	input: PromoteTopWaitlistedParams,
	capacity: number | null,
): Promise<WaitlistPromotionResult | null> {
	const confirmed = await txCtx.entitlements.listClassEntitlements({
		organizationId: input.organizationId,
		festivalClassId: input.festivalClassId,
		status: "confirmed",
	});
	if (capacity !== null && confirmed.length >= capacity) {
		return null;
	}
	const waitlisted = await txCtx.entitlements.listClassEntitlements({
		organizationId: input.organizationId,
		festivalClassId: input.festivalClassId,
		status: "waitlisted",
	});
	const top = waitlisted.sort(
		(a, b) =>
			a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
	)[0];
	if (!top) return null;
	return executePromotionTxOp(txCtx, top, {
		organizationId: input.organizationId,
		actorUid: input.actorUid,
		actorRole: input.actorRole ?? "system",
		reason: input.reason ?? "Waitlist promotion on drop/transfer",
	});
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
	return runDropTransferTransaction(ctx, (txDeps) =>
		promoteTopWaitlistedTxOp({ ...ctx, ...txDeps }, input, capacity),
	);
}

async function maybePromoteSourceClass(
	txCtx: DropTransferOpsContext,
	target: {
		wasConfirmed: boolean;
		organizationId: string;
		festivalId: string;
		festivalClassId: string;
		actorUid?: string;
	},
	capacity: number | null,
): Promise<WaitlistPromotionResult[]> {
	if (!target.wasConfirmed) return [];
	const promo = await promoteTopWaitlistedTxOp(
		txCtx,
		{
			organizationId: target.organizationId,
			festivalClassId: target.festivalClassId,
			festivalId: target.festivalId,
			actorUid: target.actorUid ?? "system",
			actorRole: "system",
		},
		capacity,
	);
	return promo?.promoted ? [promo] : [];
}

async function runDropTxBody(
	txCtx: DropTransferOpsContext,
	params: {
		existing: ClassEntitlement;
		input: DropRegistrationInput;
		shouldRefund: boolean;
		sourceCapacity: number | null;
	},
) {
	const { existing, input, shouldRefund, sourceCapacity } = params;
	const previousState = entitlementStateSnapshot(existing);
	const updated = await updateEntitlementStatusOrThrow(txCtx.entitlements, {
		organizationId: existing.organizationId,
		entitlementId: existing.id,
		status: "cancelled",
		expectedStatus: ["confirmed", "waitlisted"],
	});
	const changeLog = await txCtx.changeRepo.createChangeLog({
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
	const promotedWaitlistEntitlements = await maybePromoteSourceClass(
		txCtx,
		{
			wasConfirmed: existing.status === "confirmed",
			organizationId: existing.organizationId,
			festivalId: existing.festivalId,
			festivalClassId: existing.festivalClassId,
			actorUid: input.actorUid,
		},
		sourceCapacity,
	);
	const preparedRefund = shouldRefund
		? await recordInitialDropRefundEvent({
				changeRepo: txCtx.changeRepo,
				refundProvider: txCtx.refundProvider,
				entitlement: existing,
				changeLogId: changeLog.id,
				refundAmountCents: input.refundAmountCents,
				refundReason: input.refundReason ?? input.reason,
			})
		: null;
	emitCapacityChanged(txCtx.eventBus, {
		organizationId: existing.organizationId,
		festivalId: existing.festivalId,
		festivalClassId: existing.festivalClassId,
	});
	return { updated, changeLog, promotedWaitlistEntitlements, preparedRefund };
}

export async function executeDropOp(
	ctx: DropTransferOpsContext,
	existing: ClassEntitlement,
	input: DropRegistrationInput,
): Promise<DropRegistrationResult> {
	const shouldRefund = Boolean(input.issueRefund ?? input.requestRefund);
	if (shouldRefund) {
		resolveDropRefundAmountCents(existing, input.refundAmountCents);
	}
	const sourceCapacity =
		existing.status === "confirmed"
			? await resolveClassCapacity(
					ctx.capacityResolver,
					existing.organizationId,
					existing.festivalId,
					existing.festivalClassId,
				)
			: null;
	const txResult = await runDropTransferTransaction(ctx, (txDeps) =>
		runDropTxBody(
			{ ...ctx, ...txDeps },
			{ existing, input, shouldRefund, sourceCapacity },
		),
	);
	const refundEvent = txResult.preparedRefund
		? txResult.preparedRefund.pendingDispatch
			? await finalizePendingDropRefund(
					ctx.changeRepo,
					txResult.preparedRefund.pendingDispatch,
				)
			: txResult.preparedRefund.refundEvent
		: null;
	return {
		success: true,
		classEntitlementId: existing.id,
		classEntitlement: txResult.updated,
		changeLog: txResult.changeLog,
		refundEvent,
		promotedWaitlistEntitlements: txResult.promotedWaitlistEntitlements,
	};
}

async function runTransferTxBody(
	txCtx: DropTransferOpsContext,
	params: {
		existing: ClassEntitlement;
		input: TransferRegistrationInput;
		targetCapacity: number;
		sourceCapacity: number | null;
	},
) {
	const { existing, input, targetCapacity, sourceCapacity } = params;
	const orgId = existing.organizationId;
	const previousClassId = existing.festivalClassId;
	const targetConfirmed = await txCtx.entitlements.listClassEntitlements({
		organizationId: orgId,
		festivalClassId: input.targetFestivalClassId,
		status: "confirmed",
	});
	const nextStatus: ClassEntitlement["status"] =
		targetConfirmed.length < targetCapacity ? "confirmed" : "waitlisted";
	const previousState = entitlementStateSnapshot(existing);
	const updated = await updateEntitlementTransferOrThrow(txCtx.entitlements, {
		organizationId: orgId,
		entitlementId: existing.id,
		targetFestivalClassId: input.targetFestivalClassId,
		status: nextStatus,
	});
	const changeLog = await txCtx.changeRepo.createChangeLog({
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
	const promotedWaitlistEntitlements = await maybePromoteSourceClass(
		txCtx,
		{
			wasConfirmed: existing.status === "confirmed",
			organizationId: orgId,
			festivalId: existing.festivalId,
			festivalClassId: previousClassId,
			actorUid: input.actorUid,
		},
		sourceCapacity,
	);
	emitCapacityChanged(txCtx.eventBus, {
		organizationId: orgId,
		festivalId: existing.festivalId,
		festivalClassId: previousClassId,
	});
	emitCapacityChanged(txCtx.eventBus, {
		organizationId: orgId,
		festivalId: existing.festivalId,
		festivalClassId: input.targetFestivalClassId,
	});
	return { previousClassId, updated, changeLog, promotedWaitlistEntitlements };
}

export async function executeTransferOp(
	ctx: DropTransferOpsContext,
	params: {
		existing: ClassEntitlement;
		input: TransferRegistrationInput;
		targetCapacity: number;
	},
): Promise<TransferRegistrationResult> {
	const { existing, input, targetCapacity } = params;
	const sourceCapacity =
		existing.status === "confirmed"
			? await resolveClassCapacity(
					ctx.capacityResolver,
					existing.organizationId,
					existing.festivalId,
					existing.festivalClassId,
				)
			: null;
	const txResult = await runDropTransferTransaction(ctx, (txDeps) =>
		runTransferTxBody(
			{ ...ctx, ...txDeps },
			{ existing, input, targetCapacity, sourceCapacity },
		),
	);
	return {
		success: true,
		classEntitlementId: existing.id,
		targetFestivalClassId: input.targetFestivalClassId,
		previousFestivalClassId: txResult.previousClassId,
		classEntitlement: txResult.updated,
		changeLog: txResult.changeLog,
		refundEvent: null,
		promotedWaitlistEntitlements: txResult.promotedWaitlistEntitlements,
	};
}
