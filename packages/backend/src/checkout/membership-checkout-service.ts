import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import type {
	CheckoutIntentOutcome,
	CheckoutRepository,
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

export class MembershipCheckoutService {
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly listings: PublicMembershipProductService,
		private readonly checkout: CheckoutRepository,
		private readonly storefront: MembershipCheckoutStorefront,
		private readonly now = () => new Date(),
	) {}
	async start(input: {
		organizationId: string;
		organizationSlug: string;
		customerId: string;
		sessionId: string;
		integrationVersion: number;
		buyerAccessToken: string;
		idempotencyKey: string;
		offeringId: string;
	}) {
		// TODO(#78): reject active or processing Teacher Membership purchases.
		const existing = await this.checkout.getOutcome({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
		});
		if (existing) return this.resume(existing, input);
		const listing = await this.listings.list(input.organizationSlug);
		const displayed = listing.membershipProducts.find(
			(value) => value.id === input.offeringId,
		);
		if (!displayed?.available)
			throw new AppError("Membership selection is unavailable.", 409);
		const offering =
			await this.organizations.findMembershipProductRecordByClass(
				input.organizationId,
				"teacher_membership",
			);
		if (!offering || offering.id !== input.offeringId)
			throw new AppError("Membership selection is unavailable.", 409);
		const expiresAtIso = new Date(
			this.now().getTime() + 30 * 60_000,
		).toISOString();
		const outcome = await this.checkout.createIntent({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
			offeringId: offering.id,
			entitlementClass: "teacher_membership",
			durationDays: offering.durationDays,
			shopifyProductGid: offering.shopifyProductGid,
			shopifyVariantGid: offering.shopifyVariantGid,
			policyVersion: "v1",
			amount: displayed.price.amount,
			currencyCode: displayed.price.currencyCode,
			expiresAtIso,
		});
		if (outcome.kind === "in_progress")
			throw new AppError(
				"Checkout is already in progress.",
				409,
				"checkout_in_progress",
			);
		if (outcome.kind === "expired")
			throw new AppError("Checkout has expired.", 409, "checkout_expired");
		if (outcome.kind === "failed")
			throw new AppError(
				"This checkout attempt cannot continue.",
				409,
				"checkout_terminal_failure",
			);
		const intent = outcome.intent;
		try {
			const cart =
				outcome.kind === "ready"
					? outcome.cart
					: await this.createCart(intent, input, expiresAtIso);
			await this.checkout.markCheckoutStarted(intent.id);
			const checkout = await this.storefront.checkout({
				organizationId: input.organizationId,
				shopifyCartId: cart.shopifyCartId,
			});
			const integration = await this.organizations.getShopifyIntegration(
				input.organizationId,
			);
			if (
				!integration ||
				integration.integrationVersion !== input.integrationVersion ||
				!isAllowedCheckoutUrl(checkout.checkoutUrl, integration.storeDomain)
			)
				throw new AppError("Shopify checkout is unavailable.", 503);
			return { checkoutUrl: checkout.checkoutUrl };
		} catch (_error) {
			await this.checkout.markFailed(intent.id);
			throw retryableCheckoutError();
		}
	}

	private async resume(
		outcome: Exclude<CheckoutIntentOutcome, { kind: "created" }>,
		input: {
			organizationId: string;
			integrationVersion: number;
		},
	) {
		if (outcome.kind === "in_progress")
			throw new AppError(
				"Checkout is already in progress.",
				409,
				"checkout_in_progress",
			);
		if (outcome.kind === "expired")
			throw new AppError("Checkout has expired.", 409, "checkout_expired");
		if (outcome.kind === "failed")
			throw new AppError(
				"This checkout attempt cannot continue.",
				409,
				"checkout_terminal_failure",
			);
		try {
			await this.checkout.markCheckoutStarted(outcome.intent.id);
			const checkout = await this.storefront.checkout({
				organizationId: input.organizationId,
				shopifyCartId: outcome.cart.shopifyCartId,
			});
			const integration = await this.organizations.getShopifyIntegration(
				input.organizationId,
			);
			if (
				!integration ||
				integration.integrationVersion !== input.integrationVersion ||
				!isAllowedCheckoutUrl(checkout.checkoutUrl, integration.storeDomain)
			)
				throw new AppError("Shopify checkout is unavailable.", 503);
			return { checkoutUrl: checkout.checkoutUrl };
		} catch (_error) {
			await this.checkout.markFailed(outcome.intent.id);
			throw retryableCheckoutError();
		}
	}

	private async createCart(
		intent: { id: string; correlationId: string; shopifyVariantGid: string },
		input: {
			organizationId: string;
			customerId: string;
			sessionId: string;
			integrationVersion: number;
			buyerAccessToken: string;
		},
		expiresAtIso: string,
	) {
		const upstream = await this.storefront.createCart({
			organizationId: input.organizationId,
			shopifyVariantGid: intent.shopifyVariantGid,
			buyerAccessToken: input.buyerAccessToken,
			correlationId: intent.correlationId,
		});
		return this.checkout.attachCart({
			intentId: intent.id,
			shopifyCartId: upstream.shopifyCartId,
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			integrationVersion: input.integrationVersion,
			expiresAtIso,
		});
	}
}

function retryableCheckoutError(): AppError {
	return new AppError(
		"Shopify checkout is temporarily unavailable. Please try again.",
		503,
		"checkout_retryable_upstream",
	);
}

function isAllowedCheckoutUrl(value: string, storeDomain: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" && url.hostname === storeDomain.toLowerCase()
		);
	} catch {
		return false;
	}
}
