import { AppError, calendarDateInTimezone } from "@festival/common";
import { lifecycleForEntitlementRead } from "../../infra/s11-infra.js";
import { assertAllowedCheckoutUrl } from "./checkout-recovery-helpers.js";
import {
	assertCheckoutIntentType,
	type CheckoutCartRecord,
	type CheckoutIntentRecord,
	type CheckoutRepository,
} from "./checkout-types.js";
import type { ClassCheckoutEventBus } from "./events.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutOrganizationReadPort,
	CheckoutTeacherDirectoryPort,
	MembershipCheckoutStorefrontPort,
	MembershipListingsPort,
} from "./ports.js";

export type MembershipCheckoutStorefront = MembershipCheckoutStorefrontPort;

export interface StartTeacherMembershipCheckoutInput {
	organizationId: string;
	organizationSlug: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
	buyerAccessToken: string;
	shopifyCustomerGid?: string | null;
	offeringId: string;
	divisionId: string;
	staffAccessConsent: boolean;
}

export class MembershipCheckoutService {
	constructor(
		private readonly organizations: CheckoutOrganizationReadPort,
		private readonly catalog: CheckoutCatalogReadPort,
		private readonly teachers: CheckoutTeacherDirectoryPort,
		private readonly checkout: CheckoutRepository,
		private readonly storefront: MembershipCheckoutStorefrontPort,
		private readonly listings: MembershipListingsPort,
		private readonly now: () => Date = () => new Date(),
		private readonly eventBus?: ClassCheckoutEventBus,
	) {}

	async start(input: StartTeacherMembershipCheckoutInput): Promise<{
		checkoutUrl: string;
		intentId: string;
		correlationId: string;
	}> {
		if (!input.staffAccessConsent) {
			throw new AppError(
				"Staff directory access consent is required for teacher membership.",
				400,
			);
		}
		if (!input.divisionId?.trim()) {
			throw new AppError("Division selection is required.", 400);
		}
		const existing = await this.checkout.getOutcome({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
		});
		if (existing?.kind === "ready") {
			return this.resumeReadyIntent(input, existing.intent, existing.cart);
		}
		if (existing?.kind === "active" || existing?.kind === "in_progress") {
			throw new AppError("Checkout is already in progress.", 409);
		}
		if (existing?.kind === "expired" || existing?.kind === "failed") {
			throw new AppError("Previous checkout attempt is no longer active.", 409);
		}

		const divisions = await this.catalog.listDivisions(
			input.organizationId,
			true,
		);
		const division = divisions.find((d) => d.id === input.divisionId.trim());
		if (!division) {
			throw new AppError("Selected division is invalid or inactive.", 400);
		}
		await this.assertNoDuplicateActiveMembership(
			input.organizationId,
			input.customerId,
			division.id,
		);

		const processing = await this.checkout.hasProcessingIntent(
			input.organizationId,
			input.customerId,
			this.now().toISOString(),
			"membership",
		);
		if (processing) {
			throw new AppError(
				"Another membership checkout is already in progress.",
				409,
			);
		}

		const { listing } = await this.resolveOfferingAndProduct(input);
		const outcome = await this.checkout.createIntent({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
			intentType: "membership",
			offeringId: listing.offeringId,
			entitlementClass: "teacher_membership",
			durationDays: listing.durationDays,
			shopifyProductGid: listing.shopifyProductGid,
			shopifyVariantGid: listing.shopifyVariantGid,
			policyVersion: "v1",
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			staffAccessConsent: true,
			amount: listing.amount,
			currencyCode: listing.currencyCode,
			expiresAtIso: new Date(
				this.now().getTime() + 15 * 60 * 1000,
			).toISOString(),
		});
		if (outcome.kind === "ready") {
			return this.resumeReadyIntent(input, outcome.intent, outcome.cart);
		}
		if (outcome.kind !== "created") {
			throw new AppError("Unable to start membership checkout.", 409);
		}

		const cart = await this.createAndAttachCart(input, outcome.intent);
		return this.startStorefrontCheckout(outcome.intent, cart);
	}

	private async resolveOfferingAndProduct(
		input: StartTeacherMembershipCheckoutInput,
	) {
		const listingResult = await this.listings.list(input.organizationSlug);
		const offering = listingResult.membershipProducts.find(
			(p) => p.id === input.offeringId,
		);
		if (!offering) {
			throw new AppError("Selected membership offering was not found.", 404);
		}
		const product = this.catalog.findMembershipProductRecordByClass
			? await this.catalog.findMembershipProductRecordByClass(
					input.organizationId,
					"teacher_membership",
				)
			: null;
		if (!product) {
			throw new AppError(
				"Teacher membership product integration is unavailable.",
				503,
			);
		}
		return {
			listing: {
				offeringId: offering.id,
				durationDays: offering.durationDays,
				amount: offering.price.amount,
				currencyCode: offering.price.currencyCode,
				shopifyProductGid: product.shopifyProductGid,
				shopifyVariantGid: product.shopifyVariantGid,
			},
		};
	}

	private async assertNoDuplicateActiveMembership(
		organizationId: string,
		customerId: string,
		divisionId: string,
	): Promise<void> {
		if (!this.teachers.listEntitlementGrantSnapshots) return;
		const tz =
			(await this.organizations.getOrganizationTimezone(organizationId)) ||
			"UTC";
		const today = calendarDateInTimezone(this.now().toISOString(), tz);
		const grants = await (
			this.teachers.listEntitlementGrantSnapshots as (
				orgId: string,
				custId?: string,
			) => Promise<
				Array<{
					divisionIds: string[];
					startsOn: string;
					endsOn: string;
					revokedAtIso?: string | null;
					supersededOn?: string | null;
				}>
			>
		)(organizationId, customerId);
		const hasActive = grants.some((grant) => {
			if (!grant.divisionIds.includes(divisionId)) return false;
			const status = lifecycleForEntitlementRead(grant as never, today);
			return status === "active" || status === "scheduled";
		});
		if (hasActive) {
			throw new AppError(
				"You already hold an active or scheduled teacher membership for this division.",
				409,
			);
		}
	}

	private async createAndAttachCart(
		input: StartTeacherMembershipCheckoutInput,
		intent: CheckoutIntentRecord,
	): Promise<CheckoutCartRecord> {
		const integration = await this.organizations.getShopifyIntegration(
			input.organizationId,
		);
		if (!integration) {
			await this.checkout.markFailed(intent.id);
			throw new AppError("Shopify storefront integration is missing.", 503);
		}
		try {
			const upstream = await this.storefront.createCart({
				organizationId: input.organizationId,
				shopifyVariantGid: intent.shopifyVariantGid,
				buyerAccessToken: input.buyerAccessToken,
				shopifyCustomerGid: input.shopifyCustomerGid ?? undefined,
				correlationId: intent.correlationId,
			});
			return await this.checkout.attachCart({
				intentId: intent.id,
				shopifyCartId: upstream.shopifyCartId,
				organizationId: input.organizationId,
				customerId: input.customerId,
				sessionId: input.sessionId,
				integrationVersion: integration.integrationVersion,
				expiresAtIso: new Date(
					this.now().getTime() + 30 * 60 * 1000,
				).toISOString(),
			});
		} catch (error) {
			await this.checkout.markFailed(intent.id);
			if (error instanceof AppError) throw error;
			throw new AppError("Failed to create Shopify checkout cart.", 502);
		}
	}

	private async resumeReadyIntent(
		_input: StartTeacherMembershipCheckoutInput,
		intent: CheckoutIntentRecord,
		cart: CheckoutCartRecord,
	) {
		assertCheckoutIntentType(intent, "membership");
		return this.startStorefrontCheckout(intent, cart);
	}

	private async startStorefrontCheckout(
		intent: CheckoutIntentRecord,
		cart: CheckoutCartRecord,
	) {
		const integration = await this.organizations.getShopifyIntegration(
			intent.organizationId,
		);
		const domain =
			integration?.verifiedShopDomain ??
			integration?.storeDomain ??
			integration?.shopDomain ??
			"";
		if (!integration || !domain) {
			throw new AppError("Shopify storefront integration is missing.", 503);
		}
		try {
			await this.checkout.markCheckoutStarted(intent.id);
			const result = await this.storefront.checkout({
				organizationId: intent.organizationId,
				shopifyCartId: cart.shopifyCartId,
			});
			assertAllowedCheckoutUrl(result.checkoutUrl, domain);
			this.eventBus?.emit({
				type: "CheckoutIntentResolved",
				organizationId: intent.organizationId,
				customerId: intent.customerId,
				checkoutIntentId: intent.id,
			});
			return {
				checkoutUrl: result.checkoutUrl,
				intentId: intent.id,
				correlationId: intent.correlationId,
			};
		} catch (error) {
			await this.checkout.markFailed(intent.id);
			if (error instanceof AppError) throw error;
			throw new AppError("Failed to start Shopify checkout.", 502);
		}
	}
}
