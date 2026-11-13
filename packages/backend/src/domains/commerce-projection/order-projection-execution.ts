import type { CheckoutIntentRecord } from "../class-checkout/index.js";
import {
	buildMultiLineClassEntitlements,
	buildSingleLineClassEntitlement,
	type ClassValidationResult,
} from "./class-order-projection-validator.js";
import type { CommerceProjectionEventBus } from "./events.js";
import {
	buildReviewOrRejectStatus,
	type ProjectionCommercePort,
	type ProjectionServiceDeps,
	projectConsentedCustomerProfile,
	validateMembershipPurchase,
} from "./membership-order-projection-validator.js";
import {
	buildMembershipGrantInput,
	nowIso,
	type ProcessingResult,
} from "./order-projection-helpers.js";
import type {
	MembershipReasonCode,
	ShopifyOrderProjectionInput,
} from "./order-projection-types.js";
import type { ShopifyPaidOrder } from "./shopify-types.js";
import type { ShopifyWebhookDelivery } from "./webhook-delivery-repository.js";

export type FinalizeDecisionArg = {
	customerId?: string;
	checkoutIntentId?: string;
	shopifyOrderLineGid?: string;
	status: "approved" | "rejected" | "needs_review";
	reasonCode?: MembershipReasonCode;
	grant?: Parameters<ProjectionCommercePort["finalizeDecision"]>[0]["grant"];
	classEntitlement?: Parameters<
		ProjectionCommercePort["finalizeDecision"]
	>[0]["classEntitlement"];
	classEntitlements?: Parameters<
		ProjectionCommercePort["finalizeDecision"]
	>[0]["classEntitlements"];
};

export async function finalizeAndEmitEvent(
	deps: ProjectionServiceDeps,
	eventBus: CommerceProjectionEventBus | undefined,
	delivery: ShopifyWebhookDelivery,
	input: FinalizeDecisionArg,
	projection?: ShopifyOrderProjectionInput,
) {
	const result = await deps.commerce.finalizeDecision({
		deliveryId: delivery.id,
		decision: {
			organizationId: delivery.organizationId,
			customerId: input.customerId,
			checkoutIntentId: input.checkoutIntentId,
			shopifyOrderGid: delivery.shopifyOrderGid,
			shopifyOrderLineGid: input.shopifyOrderLineGid,
			status: input.status,
			reasonCode: input.reasonCode,
			updatedAtIso: nowIso(deps.now),
		},
		...(projection ? { projection } : {}),
		grant: input.grant,
		classEntitlement: input.classEntitlement,
		classEntitlements: input.classEntitlements,
	});
	if (!result.existing && eventBus) {
		eventBus.emit({
			type: "OrderProjected",
			organizationId: delivery.organizationId,
			shopifyOrderGid: delivery.shopifyOrderGid,
			customerId: result.decision.customerId,
		});
	}
	return result;
}

async function buildMembershipGrantForOrder(
	deps: ProjectionServiceDeps,
	delivery: ShopifyWebhookDelivery,
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
) {
	const timezone = await deps.organizations.getOrganizationTimezone(
		delivery.organizationId,
	);
	const existingGrants =
		(await deps.organizations.listEntitlementGrantSnapshots?.(
			delivery.organizationId,
			intent.customerId,
		)) ?? [];
	return buildMembershipGrantInput({
		organizationId: delivery.organizationId,
		intent,
		order,
		timezone,
		existingGrants,
	});
}

export async function processMembershipDelivery(
	deps: ProjectionServiceDeps,
	eventBus: CommerceProjectionEventBus | undefined,
	delivery: ShopifyWebhookDelivery,
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
	projection: ShopifyOrderProjectionInput,
): Promise<ProcessingResult> {
	const reason = await validateMembershipPurchase(
		deps,
		delivery.organizationId,
		intent,
		order,
	);
	if (reason) {
		await finalizeAndEmitEvent(
			deps,
			eventBus,
			delivery,
			{
				customerId: intent.customerId,
				checkoutIntentId: intent.id,
				status: buildReviewOrRejectStatus(reason),
				reasonCode: reason,
			},
			projection,
		);
		return "processed";
	}
	const grant = await buildMembershipGrantForOrder(
		deps,
		delivery,
		intent,
		order,
	);
	await finalizeAndEmitEvent(
		deps,
		eventBus,
		delivery,
		{
			customerId: intent.customerId,
			checkoutIntentId: intent.id,
			shopifyOrderLineGid: grant.shopifyOrderLineGid,
			status: "approved",
			grant,
		},
		projection,
	);
	await projectConsentedCustomerProfile(
		deps,
		delivery.organizationId,
		intent,
		order,
	);
	return "processed";
}

function buildApprovedClassLineDecision(
	delivery: ShopifyWebhookDelivery,
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
	validated: ClassValidationResult,
): FinalizeDecisionArg {
	const { classConfig, festivalId, correlatedLines, legacySingleLine } =
		validated;
	if (!classConfig || !festivalId) {
		return {
			customerId: intent.customerId,
			checkoutIntentId: intent.id,
			status: "needs_review",
			reasonCode: "upstream_invalid",
		};
	}
	if (intent.lines && intent.lines.length > 1) {
		if (!correlatedLines) {
			throw new Error("Multi-line class purchase correlation is missing.");
		}
		return {
			customerId: intent.customerId,
			checkoutIntentId: intent.id,
			status: "approved",
			classEntitlements: buildMultiLineClassEntitlements({
				organizationId: delivery.organizationId,
				intent,
				order,
				festivalId,
				classConfig,
				correlatedLines,
			}),
		};
	}
	const classEntitlement = buildSingleLineClassEntitlement({
		organizationId: delivery.organizationId,
		intent,
		order,
		festivalId,
		classConfig,
		correlatedLine: correlatedLines?.[0],
		legacySingleLine,
		placedCountBeforeAllocation: validated.placedCountBeforeAllocation,
	});
	if (!classEntitlement) {
		return {
			customerId: intent.customerId,
			checkoutIntentId: intent.id,
			status: "needs_review",
			reasonCode: "upstream_invalid",
		};
	}
	return {
		customerId: intent.customerId,
		checkoutIntentId: intent.id,
		shopifyOrderLineGid: classEntitlement.shopifyOrderLineGid,
		status: "approved",
		classEntitlement,
	};
}

export async function finalizeValidatedClassLines(
	deps: ProjectionServiceDeps,
	eventBus: CommerceProjectionEventBus | undefined,
	delivery: ShopifyWebhookDelivery,
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
	projection: ShopifyOrderProjectionInput,
	validated: ClassValidationResult,
): Promise<void> {
	const decision = buildApprovedClassLineDecision(
		delivery,
		intent,
		order,
		validated,
	);
	await finalizeAndEmitEvent(deps, eventBus, delivery, decision, projection);
}
