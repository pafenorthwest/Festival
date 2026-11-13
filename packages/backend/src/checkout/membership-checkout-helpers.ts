import {
	calendarDateInTimezone,
	calendarDaysUntil,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS,
} from "@festival/common";
import { lifecycleForEntitlementRead } from "../commerce/entitlement-lifecycle.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import { isAllowedCheckoutUrl } from "../domains/class-checkout/index.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import {
	assertCheckoutIntentType,
	type CheckoutIntentOutcome,
	type CheckoutRepository,
} from "./checkout-repository.js";

export interface MembershipCheckoutStorefront {
	createCart(input: {
		organizationId: string;
		shopifyVariantGid: string;
		buyerAccessToken: string;
		correlationId: string;
	}): Promise<{ shopifyCartId: string }>;
	checkout(input: {
		organizationId: string;
		shopifyCartId: string;
	}): Promise<{ checkoutUrl: string }>;
}

export interface MembershipCheckoutStartInput {
	organizationId: string;
	organizationSlug: string;
	customerId: string;
	sessionId: string;
	integrationVersion: number;
	buyerAccessToken: string;
	idempotencyKey: string;
	offeringId: string;
	divisionId: string;
	staffAccessConsent: boolean;
}

export interface MembershipCheckoutDeps {
	organizations: OrganizationRepository;
	listings: PublicMembershipProductService;
	checkout: CheckoutRepository;
	storefront: MembershipCheckoutStorefront;
	commerce?: MembershipCommerceRepository;
	now: () => Date;
}

export function retryableCheckoutError(): AppError {
	return new AppError(
		"Shopify checkout is temporarily unavailable. Please try again.",
		503,
		"checkout_retryable_upstream",
	);
}

export async function verifyMembershipRenewalEligibility(
	deps: Pick<MembershipCheckoutDeps, "organizations" | "commerce" | "now">,
	organizationId: string,
	customerId: string,
): Promise<void> {
	const timezone =
		await deps.organizations.getOrganizationTimezone(organizationId);
	const today = calendarDateInTimezone(deps.now().toISOString(), timezone);
	const grants = await deps.organizations.listEntitlementGrantSnapshots(
		organizationId,
		customerId,
	);
	const hasIneligibleActive = grants.some(
		(grant) =>
			grant.entitlementClass === TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS &&
			lifecycleForEntitlementRead(grant, today) === "active" &&
			calendarDaysUntil(today, grant.endsOn) >
				TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS,
	);
	if (hasIneligibleActive) {
		throw new AppError(
			"Teacher Membership already exists.",
			409,
			"membership_active",
		);
	}
	if (
		deps.commerce &&
		(await deps.commerce.hasScheduledEntitlement(
			organizationId,
			customerId,
			TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			today,
		))
	) {
		throw new AppError(
			"A Teacher Membership renewal is already scheduled.",
			409,
			"membership_active",
		);
	}
}

export async function resolveMembershipSelection(
	deps: Pick<
		MembershipCheckoutDeps,
		"organizations" | "listings" | "checkout" | "commerce" | "now"
	>,
	input: MembershipCheckoutStartInput,
) {
	const division = (
		await deps.organizations.listDivisions(input.organizationId, true)
	).find((value) => value.id === input.divisionId);
	if (!division) {
		throw new AppError("Membership division is unavailable.", 409);
	}
	await verifyMembershipRenewalEligibility(
		deps,
		input.organizationId,
		input.customerId,
	);
	if (
		await deps.checkout.hasProcessingIntent(
			input.organizationId,
			input.customerId,
			deps.now().toISOString(),
			"membership",
		)
	) {
		throw new AppError(
			"Checkout is already in progress.",
			409,
			"checkout_in_progress",
		);
	}
	const listing = await deps.listings.list(input.organizationSlug);
	const displayed = listing.membershipProducts.find(
		(value) => value.id === input.offeringId,
	);
	if (!displayed?.available) {
		throw new AppError("Membership selection is unavailable.", 409);
	}
	const offering = await deps.organizations.findMembershipProductRecordByClass(
		input.organizationId,
		"teacher_membership",
	);
	if (!offering || offering.id !== input.offeringId) {
		throw new AppError("Membership selection is unavailable.", 409);
	}
	return { division, displayed, offering };
}

async function finalizeMembershipStorefrontCheckout(
	deps: Pick<
		MembershipCheckoutDeps,
		"organizations" | "checkout" | "storefront"
	>,
	input: {
		organizationId: string;
		integrationVersion: number;
		intentId: string;
		shopifyCartId: string;
	},
	storefrontIntegrationVersion: number,
): Promise<{ checkoutUrl: string }> {
	await deps.checkout.markCheckoutStarted(input.intentId);
	const checkout = await deps.storefront.checkout({
		organizationId: input.organizationId,
		shopifyCartId: input.shopifyCartId,
	});
	const integration = await deps.organizations.getShopifyIntegration(
		input.organizationId,
	);
	if (
		!integration ||
		integration.integrationVersion !== storefrontIntegrationVersion ||
		!isAllowedCheckoutUrl(checkout.checkoutUrl, integration.storeDomain)
	) {
		throw new AppError("Shopify checkout is unavailable.", 503);
	}
	return { checkoutUrl: checkout.checkoutUrl };
}

export async function startNewMembershipCartAndCheckout(
	deps: Pick<
		MembershipCheckoutDeps,
		"organizations" | "checkout" | "storefront"
	>,
	intent: { id: string; correlationId: string; shopifyVariantGid: string },
	input: MembershipCheckoutStartInput,
	expiresAtIso: string,
): Promise<{ checkoutUrl: string }> {
	try {
		const storefrontIntegration =
			await deps.organizations.getShopifyIntegration(input.organizationId);
		if (!storefrontIntegration) {
			throw new AppError("Shopify checkout is unavailable.", 503);
		}
		const upstream = await deps.storefront.createCart({
			organizationId: input.organizationId,
			shopifyVariantGid: intent.shopifyVariantGid,
			buyerAccessToken: input.buyerAccessToken,
			correlationId: intent.correlationId,
		});
		const cart = await deps.checkout.attachCart({
			intentId: intent.id,
			shopifyCartId: upstream.shopifyCartId,
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			integrationVersion: input.integrationVersion,
			expiresAtIso,
		});
		if (cart.integrationVersion !== input.integrationVersion) {
			throw new AppError("Customer checkout context has changed.", 503);
		}
		return await finalizeMembershipStorefrontCheckout(
			deps,
			{
				organizationId: input.organizationId,
				integrationVersion: input.integrationVersion,
				intentId: intent.id,
				shopifyCartId: cart.shopifyCartId,
			},
			storefrontIntegration.integrationVersion,
		);
	} catch (_error) {
		await deps.checkout.markFailed(intent.id);
		throw retryableCheckoutError();
	}
}

export async function resumeMembershipCheckoutOutcome(
	deps: Pick<
		MembershipCheckoutDeps,
		"organizations" | "checkout" | "storefront"
	>,
	outcome: Exclude<CheckoutIntentOutcome, { kind: "created" }>,
	input: { organizationId: string; integrationVersion: number },
): Promise<{ checkoutUrl: string }> {
	if (outcome.kind === "in_progress") {
		throw new AppError(
			"Checkout is already in progress.",
			409,
			"checkout_in_progress",
		);
	}
	if (outcome.kind === "active") {
		throw new AppError(
			"Teacher Membership already exists.",
			409,
			"membership_active",
		);
	}
	if (outcome.kind === "expired") {
		throw new AppError("Checkout has expired.", 409, "checkout_expired");
	}
	if (outcome.kind === "failed") {
		throw new AppError(
			"This checkout attempt cannot continue.",
			409,
			"checkout_terminal_failure",
		);
	}
	assertCheckoutIntentType(outcome.intent, "membership");
	try {
		const storefrontIntegration =
			await deps.organizations.getShopifyIntegration(input.organizationId);
		if (
			!storefrontIntegration ||
			outcome.cart.integrationVersion !== input.integrationVersion
		) {
			throw new AppError("Customer checkout context has changed.", 503);
		}
		return await finalizeMembershipStorefrontCheckout(
			deps,
			{
				organizationId: input.organizationId,
				integrationVersion: input.integrationVersion,
				intentId: outcome.intent.id,
				shopifyCartId: outcome.cart.shopifyCartId,
			},
			storefrontIntegration.integrationVersion,
		);
	} catch (_error) {
		await deps.checkout.markFailed(outcome.intent.id);
		throw retryableCheckoutError();
	}
}
