import {
	AppError,
	type ClassEntitlement,
	type RefundEvent,
	type RefundRequest,
} from "@festival/common";
import type { RegistrationChangeRepository } from "./registration-change-repository.js";

export interface ShopifyLineTargetedRefundAllocation {
	shopifyOrderLineId: string;
	amountCents: number;
	currency: string;
}

export interface ShopifyLineTargetedRefundResult {
	id: string;
	orderId: string;
	allocations: [ShopifyLineTargetedRefundAllocation];
	providerMode?: string;
}

export interface ShopifyLineTargetedRefundRequest extends RefundRequest {
	refundEventId: string;
	idempotencyKey: string;
	shopifyOrderLineId: string;
	currency: string;
}

export interface ShopifyRefundProvider {
	supportsLineTargetedRefund: true;
	createRefund(
		refund: ShopifyLineTargetedRefundRequest,
	): Promise<ShopifyLineTargetedRefundResult>;
}

export function isLineTargetedRefundProvider(
	provider: unknown,
): provider is ShopifyRefundProvider {
	return (
		provider !== null &&
		provider !== undefined &&
		typeof provider === "object" &&
		"supportsLineTargetedRefund" in provider &&
		(provider as { supportsLineTargetedRefund?: unknown })
			.supportsLineTargetedRefund === true &&
		typeof (provider as { createRefund?: unknown }).createRefund === "function"
	);
}

export function resolveDropRefundAmountCents(
	entitlement: ClassEntitlement,
	requestedCents?: number | null,
): number {
	if (requestedCents === undefined || requestedCents === null) {
		return entitlement.paidAmountCents;
	}
	if (!Number.isSafeInteger(requestedCents) || requestedCents <= 0) {
		throw new AppError("Refund amount must be a positive integer.", 400);
	}
	if (
		!Number.isSafeInteger(entitlement.paidAmountCents) ||
		entitlement.paidAmountCents <= 0 ||
		requestedCents > entitlement.paidAmountCents
	) {
		throw new AppError(
			"Refund amount cannot exceed the paid registration amount.",
			400,
		);
	}
	return requestedCents;
}

export function validateLineTargetedRefundResponse(
	request: ShopifyLineTargetedRefundRequest,
	result: ShopifyLineTargetedRefundResult,
): void {
	if (!result || typeof result.id !== "string" || result.id.length === 0) {
		throw new Error("Refund provider did not return a refund ID.");
	}
	if (result.orderId !== request.orderId) {
		throw new Error("Refund provider returned a different order.");
	}
	if (!Array.isArray(result.allocations) || result.allocations.length !== 1) {
		throw new Error("Refund provider must return exactly one line allocation.");
	}
	const [allocation] = result.allocations;
	if (
		!allocation ||
		allocation.shopifyOrderLineId !== request.shopifyOrderLineId ||
		allocation.amountCents !== request.amountCents ||
		allocation.currency !== request.currency
	) {
		throw new Error(
			"Refund provider allocation does not match the requested order line.",
		);
	}
}

export async function processDropRefundWorkflow(params: {
	changeRepo: RegistrationChangeRepository;
	refundProvider?: ShopifyRefundProvider | null;
	entitlement: ClassEntitlement;
	changeLogId: string;
	refundAmountCents?: number | null;
	refundReason?: string | null;
}): Promise<RefundEvent> {
	const { entitlement, changeLogId } = params;
	const amountCents = resolveDropRefundAmountCents(
		entitlement,
		params.refundAmountCents,
	);
	const currency = entitlement.paidCurrencyCode || "USD";
	const refundReason = params.refundReason?.trim() || "Registration dropped";
	const isValidAmount = Number.isFinite(amountCents) && amountCents > 0;
	const hasOrderIds = Boolean(
		entitlement.shopifyOrderGid && entitlement.shopifyOrderLineGid,
	);
	if (!isValidAmount || !hasOrderIds) {
		const failureReason = !isValidAmount
			? "Cannot refund unpriced or zero-amount registration."
			: !entitlement.shopifyOrderGid
				? "Missing Shopify order ID for refund."
				: "Missing Shopify order line ID for refund.";
		return params.changeRepo.createRefundEvent({
			organizationId: entitlement.organizationId,
			registrationChangeLogId: changeLogId,
			classEntitlementId: entitlement.id,
			shopifyOrderId: entitlement.shopifyOrderGid ?? null,
			shopifyOrderLineId: entitlement.shopifyOrderLineGid ?? null,
			amountCents: isValidAmount ? amountCents : 0,
			currency,
			status: "failed",
			failureReason,
		});
	}
	return executeVerifiedRefund(params, amountCents, currency, refundReason);
}

async function dispatchProviderRefund(
	changeRepo: RegistrationChangeRepository,
	provider: ShopifyRefundProvider,
	refundEvent: RefundEvent,
	entitlement: ClassEntitlement,
	refundRequest: ShopifyLineTargetedRefundRequest,
): Promise<RefundEvent> {
	try {
		const result = await provider.createRefund(refundRequest);
		validateLineTargetedRefundResponse(refundRequest, result);
		return (
			(await changeRepo.updateRefundEventStatus({
				id: refundEvent.id,
				organizationId: entitlement.organizationId,
				status: "completed",
				shopifyRefundId: result.id,
			})) ?? { ...refundEvent, status: "completed", shopifyRefundId: result.id }
		);
	} catch (error) {
		const failureReason =
			error instanceof Error ? error.message : "Shopify refund failed";
		return (
			(await changeRepo.updateRefundEventStatus({
				id: refundEvent.id,
				organizationId: entitlement.organizationId,
				status: "failed",
				failureReason,
			})) ?? { ...refundEvent, status: "failed", failureReason }
		);
	}
}

async function executeVerifiedRefund(
	params: {
		changeRepo: RegistrationChangeRepository;
		refundProvider?: ShopifyRefundProvider | null;
		entitlement: ClassEntitlement;
		changeLogId: string;
	},
	amountCents: number,
	currency: string,
	refundReason: string,
): Promise<RefundEvent> {
	const { entitlement, changeLogId } = params;
	const isPartial = amountCents !== entitlement.paidAmountCents;
	const provider = isLineTargetedRefundProvider(params.refundProvider)
		? params.refundProvider
		: null;
	const manualReason = isPartial
		? "Manual refund required: partial class-registration refunds are not supported."
		: !provider
			? "Manual refund required: no deterministic Shopify order-line refund provider is configured."
			: null;

	const refundEvent = await params.changeRepo.createRefundEvent({
		organizationId: entitlement.organizationId,
		registrationChangeLogId: changeLogId,
		classEntitlementId: entitlement.id,
		shopifyOrderId: entitlement.shopifyOrderGid,
		shopifyOrderLineId: entitlement.shopifyOrderLineGid,
		amountCents,
		currency,
		status: "pending",
		failureReason: manualReason,
	});
	if (!provider || isPartial) return refundEvent;

	return dispatchProviderRefund(
		params.changeRepo,
		provider,
		refundEvent,
		entitlement,
		{
			orderId: entitlement.shopifyOrderGid,
			paymentIntentId: entitlement.checkoutIntentId,
			refundEventId: refundEvent.id,
			idempotencyKey: `refund-event:${refundEvent.id}`,
			shopifyOrderLineId: entitlement.shopifyOrderLineGid,
			amountCents,
			currency,
			reason: refundReason,
		},
	);
}
