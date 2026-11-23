import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import type { CheckoutRepository } from "./checkout-repository.js";
import {
	type MembershipCheckoutStartInput,
	type MembershipCheckoutStorefront,
	resolveMembershipSelection,
	resumeMembershipCheckoutOutcome,
	startNewMembershipCartAndCheckout,
} from "./membership-checkout-helpers.js";

export type { MembershipCheckoutStorefront } from "./membership-checkout-helpers.js";

export class MembershipCheckoutService {
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly listings: PublicMembershipProductService,
		private readonly checkout: CheckoutRepository,
		private readonly storefront: MembershipCheckoutStorefront,
		private readonly commerce?: MembershipCommerceRepository,
		private readonly now = () => new Date(),
	) {}

	async start(input: MembershipCheckoutStartInput) {
		if (!input.divisionId.trim() || input.staffAccessConsent !== true) {
			throw new AppError(
				"Select a division and agree to sharing data before purchasing.",
				400,
			);
		}
		const deps = {
			organizations: this.organizations,
			listings: this.listings,
			checkout: this.checkout,
			storefront: this.storefront,
			commerce: this.commerce,
			now: this.now,
		};
		const existing = await this.checkout.getOutcome({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
		});
		if (existing) return resumeMembershipCheckoutOutcome(deps, existing, input);
		const { division, displayed, offering } = await resolveMembershipSelection(
			deps,
			input,
		);
		const expiresAtIso = new Date(
			this.now().getTime() + 30 * 60_000,
		).toISOString();
		const outcome = await this.checkout.createIntent({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
			intentType: "membership",
			offeringId: offering.id,
			entitlementClass: "teacher_membership",
			durationDays: offering.durationDays,
			shopifyProductGid: offering.shopifyProductGid,
			shopifyVariantGid: offering.shopifyVariantGid,
			policyVersion: "v1",
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			staffAccessConsent: input.staffAccessConsent,
			amount: displayed.price.amount,
			currencyCode: displayed.price.currencyCode,
			expiresAtIso,
		});
		if (outcome.kind !== "created") {
			return resumeMembershipCheckoutOutcome(deps, outcome, input);
		}
		return startNewMembershipCartAndCheckout(
			deps,
			outcome.intent,
			input,
			expiresAtIso,
		);
	}
}
