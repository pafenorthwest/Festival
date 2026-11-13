import type { ShopifySecretKeyring } from "../../infra/s11-infra.js";
import type { CheckoutIntentRecord } from "../class-checkout/index.js";
import { ClassOrderProjectionValidator } from "./class-order-projection-validator.js";
import type { CommerceProjectionEventBus } from "./events.js";
import {
	buildProjectionInput,
	buildReviewOrRejectStatus,
	type ProjectionCommercePort,
	type ProjectionOrgPort,
	type ProjectionServiceDeps,
	projectConsentedCustomerProfile,
	readAdminOrderContext,
} from "./membership-order-projection-validator.js";
import { readCorrelationId } from "./order-line-classifier.js";
import {
	finalizeAndEmitEvent,
	finalizeValidatedClassLines,
	processMembershipDelivery,
} from "./order-projection-execution.js";
import {
	failureClassification,
	failureDiagnostic,
	nowIso,
	type ProcessingResult,
	safeOrderHash,
} from "./order-projection-helpers.js";
import {
	prepareManualApprovalPayload,
	reconcileOrganizationOrders,
} from "./order-projection-reconciliation.js";
import type { ShopifyOrderProjectionInput } from "./order-projection-types.js";
import type { CommerceCheckoutPort, CommerceCustomerPort } from "./ports.js";
import type {
	ShopifyPaidOrder,
	ShopifyPaidOrderReader,
} from "./shopify-types.js";
import type { ShopifyWebhookDelivery } from "./webhook-delivery-repository.js";

export type { ProjectionCommercePort, ProjectionOrgPort };

async function readOrderSafelyForDelivery(
	deps: ProjectionServiceDeps,
	delivery: ShopifyWebhookDelivery,
): Promise<ShopifyPaidOrder | null | undefined> {
	try {
		const context = await readAdminOrderContext(deps, delivery.organizationId);
		const { value } = await deps.orders.readPaidOrderByGid(
			context,
			delivery.shopifyOrderGid,
		);
		return value;
	} catch (error) {
		const failure = failureClassification(error, "order_read");
		await deps.commerce.markDeliveryFailed(delivery.id, {
			...failure,
			failedAtIso: nowIso(deps.now),
		});
		return undefined;
	}
}

export class ShopifyOrderProjectionService {
	private readonly deps: ProjectionServiceDeps;
	private readonly classValidator: ClassOrderProjectionValidator;
	private eventBus?: CommerceProjectionEventBus;

	constructor(
		organizations: ProjectionOrgPort,
		checkout: CommerceCheckoutPort,
		commerce: ProjectionCommercePort,
		orders: ShopifyPaidOrderReader,
		secretKeyring: ShopifySecretKeyring | undefined,
		customers?: CommerceCustomerPort,
		now: () => Date = () => new Date(),
	) {
		this.deps = {
			organizations,
			checkout,
			commerce,
			orders,
			secretKeyring,
			customers,
			now,
		};
		this.classValidator = new ClassOrderProjectionValidator(
			organizations,
			commerce,
			customers,
		);
	}

	bindEventBus(eventBus: CommerceProjectionEventBus): void {
		this.eventBus = eventBus;
	}

	async processDelivery(deliveryId: string): Promise<ProcessingResult> {
		const delivery = await this.deps.commerce.claimDelivery(deliveryId);
		if (!delivery) return "skipped";
		try {
			const pending = await this.deps.commerce.recordPendingDecision({
				organizationId: delivery.organizationId,
				shopifyOrderGid: delivery.shopifyOrderGid,
				updatedAtIso: nowIso(this.deps.now),
			});
			if (
				pending.status !== "pending_validation" &&
				pending.status !== "approved"
			) {
				await this.deps.commerce.markDeliveryProcessed(delivery.id);
				return "skipped";
			}
			const order = await readOrderSafelyForDelivery(this.deps, delivery);
			if (order === undefined) return "failed";
			if (!order || order.id !== delivery.shopifyOrderGid) {
				await finalizeAndEmitEvent(this.deps, this.eventBus, delivery, {
					status: "needs_review",
					reasonCode: "upstream_invalid",
				});
				return "processed";
			}
			return await this.projectClaimedOrder(delivery, order, pending.status);
		} catch (error) {
			const failure = failureClassification(error, "projection");
			await this.deps.commerce.markDeliveryFailed(delivery.id, {
				...failure,
				failedAtIso: nowIso(this.deps.now),
			});
			console.error("Shopify order projection failed", {
				deliveryId: delivery.id,
				orderHash: safeOrderHash(delivery.shopifyOrderGid),
				diagnostic: failureDiagnostic(error),
			});
			return "failed";
		}
	}

	reconcile(organizationId: string): Promise<{
		discoveredCount: number;
		processedCount: number;
	}> {
		return reconcileOrganizationOrders(
			this.deps,
			(deliveryId) => this.processDelivery(deliveryId),
			organizationId,
		);
	}

	prepareManualApproval(organizationId: string, shopifyOrderGid: string) {
		return prepareManualApprovalPayload(
			this.deps,
			organizationId,
			shopifyOrderGid,
		);
	}

	private async resolveIntentOrFinalize(
		delivery: ShopifyWebhookDelivery,
		order: ShopifyPaidOrder,
		projection: ShopifyOrderProjectionInput,
	): Promise<CheckoutIntentRecord | undefined> {
		const correlation = readCorrelationId(order);
		if (!correlation.correlationId) {
			await finalizeAndEmitEvent(
				this.deps,
				this.eventBus,
				delivery,
				{
					status: buildReviewOrRejectStatus(correlation.reasonCode),
					reasonCode: correlation.reasonCode ?? "correlation_missing",
				},
				projection,
			);
			return undefined;
		}
		const intent = await this.deps.checkout.findIntentByCorrelation(
			delivery.organizationId,
			correlation.correlationId,
		);
		if (!intent) {
			await finalizeAndEmitEvent(
				this.deps,
				this.eventBus,
				delivery,
				{ status: "needs_review", reasonCode: "correlation_invalid" },
				projection,
			);
			return undefined;
		}
		return intent;
	}

	private async projectClaimedOrder(
		delivery: ShopifyWebhookDelivery,
		order: ShopifyPaidOrder,
		pendingStatus: string,
	): Promise<ProcessingResult> {
		const correlation = readCorrelationId(order);
		const projection = buildProjectionInput(
			delivery.organizationId,
			order,
			nowIso(this.deps.now),
			correlation.correlationId,
		);
		await this.deps.commerce.upsertOrderProjection(projection);
		const intent = await this.resolveIntentOrFinalize(
			delivery,
			order,
			projection,
		);
		if (!intent) return "processed";
		if (pendingStatus === "approved") {
			if (delivery.attemptCount > 1) {
				await projectConsentedCustomerProfile(
					this.deps,
					delivery.organizationId,
					intent,
					order,
				);
			}
			await this.deps.commerce.markDeliveryProcessed(delivery.id);
			return delivery.attemptCount > 1 ? "processed" : "skipped";
		}
		if (
			intent.intentType === "class_entry" ||
			Boolean(intent.festivalClassId)
		) {
			return this.processClassDelivery(delivery, intent, order, projection);
		}
		return processMembershipDelivery(
			this.deps,
			this.eventBus,
			delivery,
			intent,
			order,
			projection,
		);
	}

	private async processClassDelivery(
		delivery: ShopifyWebhookDelivery,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
		projection: ShopifyOrderProjectionInput,
	): Promise<ProcessingResult> {
		const validated = await this.classValidator.validateClassPurchase(
			delivery.organizationId,
			intent,
			order,
		);
		if (
			validated.reason ||
			!validated.classConfig ||
			!validated.festivalId ||
			(!validated.correlatedLines && !validated.legacySingleLine)
		) {
			await finalizeAndEmitEvent(
				this.deps,
				this.eventBus,
				delivery,
				{
					customerId: intent.customerId,
					checkoutIntentId: intent.id,
					status: buildReviewOrRejectStatus(validated.reason),
					reasonCode: validated.reason ?? "upstream_invalid",
				},
				projection,
			);
			return "processed";
		}
		await finalizeValidatedClassLines(
			this.deps,
			this.eventBus,
			delivery,
			intent,
			order,
			projection,
			validated,
		);
		await projectConsentedCustomerProfile(
			this.deps,
			delivery.organizationId,
			intent,
			order,
		);
		return "processed";
	}
}
