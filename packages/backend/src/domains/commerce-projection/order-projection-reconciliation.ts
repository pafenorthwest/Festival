import { AppError } from "@festival/common";
import {
	buildProjectionInput,
	type ProjectionServiceDeps,
	readAdminOrderContext,
	validateMembershipPurchase,
} from "./membership-order-projection-validator.js";
import { readCorrelationId } from "./order-line-classifier.js";
import {
	buildMembershipGrantInput,
	nowIso,
	type ProcessingResult,
	reconciliationFailureCategory,
	reconciliationWebhookId,
	SHOPIFY_API_VERSION,
	safeOrderHash,
} from "./order-projection-helpers.js";
import type { ShopifyPaidOrder } from "./shopify-types.js";
import type { ShopifyWebhookDeliveryRepository } from "./webhook-delivery-repository.js";

const RECONCILIATION_OVERLAP_MS = 48 * 60 * 60 * 1_000;
const RECONCILIATION_LIMIT = 50;
const DELIVERY_PROCESSING_LEASE_MS = 15 * 60 * 1_000;

async function readOrderForManualApproval(
	deps: ProjectionServiceDeps,
	organizationId: string,
	shopifyOrderGid: string,
): Promise<ShopifyPaidOrder> {
	let order: ShopifyPaidOrder | null;
	try {
		const context = await readAdminOrderContext(deps, organizationId);
		const result = await deps.orders.readPaidOrderByGid(
			context,
			shopifyOrderGid,
		);
		order = result.value;
	} catch {
		throw new AppError("Shopify order could not be verified.", 503);
	}
	if (!order || order.id !== shopifyOrderGid) {
		throw new AppError(
			"Order cannot be manually approved: upstream_invalid.",
			422,
		);
	}
	return order;
}

async function resolveValidatedManualIntent(
	deps: ProjectionServiceDeps,
	organizationId: string,
	order: ShopifyPaidOrder,
) {
	const correlation = readCorrelationId(order);
	if (!correlation.correlationId) {
		throw new AppError(
			`Order cannot be manually approved: ${correlation.reasonCode ?? "correlation_invalid"}.`,
			422,
		);
	}
	const intent = await deps.checkout.findIntentByCorrelation(
		organizationId,
		correlation.correlationId,
	);
	if (!intent) {
		throw new AppError(
			"Order cannot be manually approved: correlation_invalid.",
			422,
		);
	}
	const reason = await validateMembershipPurchase(
		deps,
		organizationId,
		intent,
		order,
	);
	if (reason) {
		throw new AppError(
			`Order cannot be manually approved: ${reason}.`,
			reason === "duplicate_purchase" ? 409 : 422,
		);
	}
	return { correlationId: correlation.correlationId, intent };
}

export async function prepareManualApprovalPayload(
	deps: ProjectionServiceDeps,
	organizationId: string,
	shopifyOrderGid: string,
) {
	const order = await readOrderForManualApproval(
		deps,
		organizationId,
		shopifyOrderGid,
	);
	const { correlationId, intent } = await resolveValidatedManualIntent(
		deps,
		organizationId,
		order,
	);
	const timezone =
		await deps.organizations.getOrganizationTimezone(organizationId);
	const existingGrants =
		(await deps.organizations.listEntitlementGrantSnapshots?.(
			organizationId,
			intent.customerId,
		)) ?? [];
	const grant = buildMembershipGrantInput({
		organizationId,
		intent,
		order,
		timezone,
		existingGrants,
	});
	const line = order.lineItems[0];
	if (
		!line ||
		!order.fullyPaidAtIso ||
		!intent.divisionId ||
		!intent.divisionNameSnapshot ||
		!intent.offeringId ||
		intent.durationDays == null ||
		!grant.verifiedIdentityEmail
	) {
		throw new AppError(
			"Order cannot be manually approved: upstream_invalid.",
			422,
		);
	}
	return {
		customerId: intent.customerId,
		checkoutIntentId: intent.id,
		shopifyOrderLineGid: line.id,
		projection: buildProjectionInput(
			organizationId,
			order,
			nowIso(deps.now),
			correlationId,
		),
		grant,
	};
}

async function reconcileReclaimableDeliveries(
	deps: ProjectionServiceDeps,
	processDelivery: (deliveryId: string) => Promise<ProcessingResult>,
	organizationId: string,
): Promise<number> {
	const staleBeforeIso = new Date(
		deps.now().getTime() - DELIVERY_PROCESSING_LEASE_MS,
	).toISOString();
	const reclaimable = await (
		deps.commerce as Partial<ShopifyWebhookDeliveryRepository>
	).listReclaimableDeliveries?.(
		organizationId,
		RECONCILIATION_LIMIT,
		staleBeforeIso,
	);
	let processedCount = 0;
	for (const delivery of reclaimable ?? []) {
		const res = await processDelivery(delivery.id);
		if (res === "processed") processedCount += 1;
		if (res === "failed") {
			throw new Error("A queued delivery could not be processed.");
		}
	}
	return processedCount;
}

async function recordReconciledOrderDelivery(
	deps: ProjectionServiceDeps,
	processDelivery: (deliveryId: string) => Promise<ProcessingResult>,
	organizationId: string,
	verifiedShopDomain: string,
	shopifyOrderGid: string,
): Promise<{ discovered: number; processed: number }> {
	const recorded = await (
		deps.commerce as Partial<ShopifyWebhookDeliveryRepository>
	).recordDelivery?.({
		organizationId,
		shopDomain: verifiedShopDomain,
		webhookId: reconciliationWebhookId(shopifyOrderGid),
		topic: "orders/paid",
		apiVersion: SHOPIFY_API_VERSION,
		shopifyOrderGid,
		payloadSha256: safeOrderHash(shopifyOrderGid),
		receivedAtIso: nowIso(deps.now),
	});
	if (!recorded || recorded.kind === "conflict") {
		throw new Error("Reconciliation delivery evidence conflicted.");
	}
	const res = await processDelivery(recorded.delivery.id);
	if (res === "failed") {
		throw new Error("A reconciled order could not be processed.");
	}
	return {
		discovered: recorded.kind === "accepted" ? 1 : 0,
		processed: res === "processed" ? 1 : 0,
	};
}

export async function reconcileOrganizationOrders(
	deps: ProjectionServiceDeps,
	processDelivery: (deliveryId: string) => Promise<ProcessingResult>,
	organizationId: string,
): Promise<{ discoveredCount: number; processedCount: number }> {
	const startedAtIso = nowIso(deps.now);
	let discoveredCount = 0;
	let processedCount = 0;
	try {
		processedCount += await reconcileReclaimableDeliveries(
			deps,
			processDelivery,
			organizationId,
		);
		const sinceIso = new Date(
			deps.now().getTime() - RECONCILIATION_OVERLAP_MS,
		).toISOString();
		const context = await readAdminOrderContext(deps, organizationId);
		const { value: orders } = await deps.orders.listPaidOrdersSince(
			context,
			sinceIso,
			RECONCILIATION_LIMIT,
		);
		for (const order of orders) {
			const outcome = await recordReconciledOrderDelivery(
				deps,
				processDelivery,
				organizationId,
				context.verifiedShopDomain,
				order.id,
			);
			discoveredCount += outcome.discovered;
			processedCount += outcome.processed;
		}
		await deps.commerce.recordReconciliationRun({
			organizationId,
			status: "completed",
			discoveredCount,
			processedCount,
			startedAtIso,
			finishedAtIso: nowIso(deps.now),
		});
		return { discoveredCount, processedCount };
	} catch (error) {
		await deps.commerce.recordReconciliationRun({
			organizationId,
			status: "failed",
			discoveredCount,
			processedCount,
			startedAtIso,
			finishedAtIso: nowIso(deps.now),
			failureCategory: reconciliationFailureCategory(error),
		});
		throw new Error("Shopify order reconciliation failed.");
	}
}
