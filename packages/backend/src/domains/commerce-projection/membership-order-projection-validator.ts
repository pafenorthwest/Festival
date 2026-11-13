import {
	CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	calendarDaysUntil,
	deriveEntitlementDates,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS,
} from "@festival/common";
import {
	lifecycleForEntitlementRead,
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../../infra/s11-infra.js";
import type { CheckoutIntentRecord } from "../class-checkout/index.js";
import type { ClassEntitlementRepository } from "./class-entitlement-repository.js";
import {
	hasMatchingPaidMoney,
	timestampMilliseconds,
} from "./order-line-classifier.js";
import { nowIso } from "./order-projection-helpers.js";
import type { OrderProjectionRepository } from "./order-projection-repository.js";
import type {
	MembershipReasonCode,
	ShopifyOrderProjectionInput,
} from "./order-projection-types.js";
import type {
	CommerceCheckoutPort,
	CommerceCustomerPort,
	CommerceOrganizationPort,
} from "./ports.js";
import { ShopifyCredentialsError } from "./shopify-errors.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyPaidOrder,
	ShopifyPaidOrderReader,
} from "./shopify-types.js";
import type { ShopifyWebhookDeliveryRepository } from "./webhook-delivery-repository.js";

export type ProjectionOrgPort = Pick<
	CommerceOrganizationPort,
	| "getShopifyIntegration"
	| "getOrganizationTimezone"
	| "listEntitlementGrantSnapshots"
	| "listFestivals"
	| "listFestivalClassConfigurations"
>;

export type ProjectionCommercePort = Pick<
	OrderProjectionRepository,
	| "upsertOrderProjection"
	| "listOrderProjectionsByGids"
	| "recordPendingDecision"
	| "finalizeDecision"
	| "hasScheduledEntitlement"
	| "recordReconciliationRun"
> &
	Pick<
		ShopifyWebhookDeliveryRepository,
		"claimDelivery" | "markDeliveryFailed" | "markDeliveryProcessed"
	> &
	Pick<ClassEntitlementRepository, "countConfirmedClassEntitlements">;

export interface ProjectionServiceDeps {
	organizations: ProjectionOrgPort;
	checkout: CommerceCheckoutPort;
	commerce: ProjectionCommercePort;
	orders: ShopifyPaidOrderReader;
	secretKeyring: ShopifySecretKeyring | undefined;
	customers?: CommerceCustomerPort;
	now: () => Date;
}

const REVIEW_REASONS = new Set<MembershipReasonCode>([
	"intent_expired",
	"correlation_invalid",
	"upstream_invalid",
	"payment_incomplete",
]);

export function buildReviewOrRejectStatus(
	reason: MembershipReasonCode | undefined,
): "needs_review" | "rejected" {
	return reason && REVIEW_REASONS.has(reason) ? "needs_review" : "rejected";
}

export function buildProjectionInput(
	organizationId: string,
	order: ShopifyPaidOrder,
	updatedAtIso: string,
	correlationId?: string,
): ShopifyOrderProjectionInput {
	return {
		organizationId,
		shopifyOrderGid: order.id,
		shopifyCustomerGid: order.customerGid,
		correlationId,
		fullyPaidAtIso: order.fullyPaidAtIso,
		currencyCode: order.currencyCode,
		updatedAtIso,
	};
}

export async function readAdminOrderContext(
	deps: ProjectionServiceDeps,
	organizationId: string,
): Promise<ShopifyAdminOperationContext> {
	const integration =
		await deps.organizations.getShopifyIntegration(organizationId);
	if (!integration || integration.verificationStatus !== "ok") {
		throw new ShopifyCredentialsError(
			"Shopify integration must be verified before reading orders.",
		);
	}
	if (!integration.verifiedShopGid || !integration.verifiedShopDomain) {
		throw new ShopifyCredentialsError("Shopify shop identity is not verified.");
	}
	if (!integration.grantedScopes.includes("read_orders")) {
		throw new ShopifyCredentialsError(
			"Shopify integration lacks read_orders scope.",
			"missing_scope",
		);
	}
	if (!deps.secretKeyring) {
		throw new ShopifyCredentialsError("Shopify secret keyring is missing.");
	}
	const clientSecret = deps.secretKeyring.decrypt(
		integration.encryptedClientSecret,
		{
			organizationId: integration.organizationId,
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
		},
	);
	return {
		organizationId: integration.organizationId,
		firebaseActorUid: "system:shopify-order-projection",
		verifiedShopGid: integration.verifiedShopGid,
		verifiedShopDomain: integration.verifiedShopDomain,
		integrationVersion: integration.integrationVersion,
		grantedScopes: integration.grantedScopes,
		capability: "read_orders",
		credentials: {
			organizationId: integration.organizationId,
			storeDomain: integration.storeDomain,
			clientId: integration.clientId,
			clientSecret,
			integrationVersion: integration.integrationVersion,
		},
	};
}

async function validateMembershipRenewalWindow(
	deps: ProjectionServiceDeps,
	organizationId: string,
	customerId: string,
	fullyPaidAtIso: string,
): Promise<MembershipReasonCode | undefined> {
	const timezone =
		await deps.organizations.getOrganizationTimezone(organizationId);
	const paidDate = deriveEntitlementDates({
		fullyPaidAtIso,
		organizationTimezone: timezone,
		durationDays: 1,
	}).startsOn;
	if (
		await deps.commerce.hasScheduledEntitlement(
			organizationId,
			customerId,
			TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			paidDate,
		)
	) {
		return "duplicate_purchase";
	}
	const existingGrants =
		(await deps.organizations.listEntitlementGrantSnapshots?.(
			organizationId,
			customerId,
		)) ?? [];
	const blockedActive = existingGrants.some(
		(grant) =>
			grant.entitlementClass === TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS &&
			lifecycleForEntitlementRead(grant, paidDate) === "active" &&
			calendarDaysUntil(paidDate, grant.endsOn) >
				TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS,
	);
	return blockedActive ? "duplicate_purchase" : undefined;
}

export async function validateMembershipPurchase(
	deps: ProjectionServiceDeps,
	organizationId: string,
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
): Promise<MembershipReasonCode | undefined> {
	if (!order.fullyPaid) return "order_not_paid";
	if (!order.fullyPaidAtIso) return "payment_incomplete";
	if (
		timestampMilliseconds(intent.expiresAtIso, "Checkout intent expiry") <=
		timestampMilliseconds(order.fullyPaidAtIso, "Shopify payment")
	) {
		return "intent_expired";
	}
	if (!deps.customers) return "upstream_invalid";
	const customer = await deps.customers.getCustomer(
		organizationId,
		intent.customerId,
	);
	if (!customer || customer.shopifyCustomerGid !== order.customerGid) {
		return "customer_mismatch";
	}
	const line = order.lineItems[0];
	if (
		order.lineItems.length !== 1 ||
		line?.productGid !== intent.shopifyProductGid ||
		line?.variantGid !== intent.shopifyVariantGid ||
		line?.quantity !== 1
	) {
		return "offering_mismatch";
	}
	if (
		order.currencyCode !== intent.currencyCode ||
		!hasMatchingPaidMoney(
			intent.amount,
			intent.currencyCode,
			line.paidAmount,
			line.paidCurrencyCode,
		)
	) {
		return "payment_mismatch";
	}
	return validateMembershipRenewalWindow(
		deps,
		organizationId,
		intent.customerId,
		order.fullyPaidAtIso,
	);
}

export async function projectConsentedCustomerProfile(
	deps: ProjectionServiceDeps,
	organizationId: string,
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
): Promise<void> {
	if (!intent.staffAccessConsent || !deps.customers) return;
	const reader = deps.orders.readOrderCustomerProfileByGid;
	if (!reader) return;
	const context = await readAdminOrderContext(deps, organizationId);
	const { value: profile } = await reader.call(deps.orders, context, order.id);
	await deps.customers.recordStaffAccessConsent?.({
		organizationId,
		customerId: intent.customerId,
		privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
		consentedAtIso: nowIso(deps.now),
	});
	if (!profile) return;
	await deps.customers.applyCustomerProfile?.({
		organizationId,
		customerId: intent.customerId,
		source: "shopify",
		updatedAtIso: nowIso(deps.now),
		profile,
	});
}
