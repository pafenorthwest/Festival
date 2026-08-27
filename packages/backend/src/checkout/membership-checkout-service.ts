import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import type { CheckoutRepository } from "./checkout-repository.js";

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
		offeringId: string;
	}) {
		// TODO(#78): reject active or processing Teacher Membership purchases.
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
		const intent = await this.checkout.createIntent({
			organizationId: input.organizationId,
			customerId: input.customerId,
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
		const upstream = await this.storefront.createCart({
			organizationId: input.organizationId,
			shopifyVariantGid: offering.shopifyVariantGid,
			buyerAccessToken: input.buyerAccessToken,
			correlationId: intent.correlationId,
		});
		const cart = await this.checkout.attachCart({
			intentId: intent.id,
			shopifyCartId: upstream.shopifyCartId,
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			integrationVersion: input.integrationVersion,
			expiresAtIso,
		});
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
		await this.checkout.markCheckoutStarted(intent.id);
		return { checkoutUrl: checkout.checkoutUrl };
	}
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
