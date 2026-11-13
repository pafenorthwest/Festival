import { AppError, calendarDateInTimezone } from "@festival/common";
import { lifecycleForEntitlementRead } from "../../infra/s11-infra.js";
import { assertAllowedCheckoutUrl } from "./checkout-recovery-helpers.js";
import type {
	CheckoutCartRecord,
	CheckoutIntentRecord,
	CheckoutRepository,
} from "./checkout-types.js";
import type { ClassCheckoutEventBus } from "./events.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutOrganizationReadPort,
	CheckoutTeacherDirectoryPort,
	MembershipCheckoutStorefrontPort,
	MembershipListingsPort,
} from "./ports.js";

export interface StartMembershipInputLike {
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

export interface MembershipCheckoutHelperDeps {
	organizations: CheckoutOrganizationReadPort;
	catalog: CheckoutCatalogReadPort;
	teachers: CheckoutTeacherDirectoryPort;
	checkout: CheckoutRepository;
	storefront: MembershipCheckoutStorefrontPort;
	listings: MembershipListingsPort;
	now: () => Date;
	eventBus?: ClassCheckoutEventBus;
}

export function validateStartMembershipInput(
	input: StartMembershipInputLike,
): void {
	if (!input.staffAccessConsent) {
		throw new AppError(
			"Staff directory access consent is required for teacher membership.",
			400,
		);
	}
	if (!input.divisionId?.trim()) {
		throw new AppError("Division selection is required.", 400);
	}
}

export async function assertNoDuplicateActiveMembershipOp(
	deps: Pick<
		MembershipCheckoutHelperDeps,
		"organizations" | "teachers" | "now"
	>,
	organizationId: string,
	customerId: string,
	divisionId: string,
): Promise<void> {
	if (!deps.teachers.listEntitlementGrantSnapshots) return;
	const tz =
		(await deps.organizations.getOrganizationTimezone(organizationId)) || "UTC";
	const today = calendarDateInTimezone(deps.now().toISOString(), tz);
	const grants = await (
		deps.teachers.listEntitlementGrantSnapshots as (
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

export async function resolveMembershipOfferingAndProductOp(
	deps: Pick<MembershipCheckoutHelperDeps, "listings" | "catalog">,
	input: StartMembershipInputLike,
) {
	const listingResult = await deps.listings.list(input.organizationSlug);
	const offering = listingResult.membershipProducts.find(
		(p) => p.id === input.offeringId,
	);
	if (!offering) {
		throw new AppError("Selected membership offering was not found.", 404);
	}
	const product = deps.catalog.findMembershipProductRecordByClass
		? await deps.catalog.findMembershipProductRecordByClass(
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

export async function createAndAttachMembershipCartOp(
	deps: Pick<
		MembershipCheckoutHelperDeps,
		"organizations" | "checkout" | "storefront" | "now"
	>,
	input: StartMembershipInputLike,
	intent: CheckoutIntentRecord,
): Promise<CheckoutCartRecord> {
	const integration = await deps.organizations.getShopifyIntegration(
		input.organizationId,
	);
	if (!integration) {
		await deps.checkout.markFailed(intent.id);
		throw new AppError("Shopify storefront integration is missing.", 503);
	}
	try {
		const upstream = await deps.storefront.createCart({
			organizationId: input.organizationId,
			shopifyVariantGid: intent.shopifyVariantGid,
			buyerAccessToken: input.buyerAccessToken,
			shopifyCustomerGid: input.shopifyCustomerGid ?? undefined,
			correlationId: intent.correlationId,
		});
		return await deps.checkout.attachCart({
			intentId: intent.id,
			shopifyCartId: upstream.shopifyCartId,
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			integrationVersion: integration.integrationVersion,
			expiresAtIso: new Date(
				deps.now().getTime() + 30 * 60 * 1000,
			).toISOString(),
		});
	} catch (error) {
		await deps.checkout.markFailed(intent.id);
		if (error instanceof AppError) throw error;
		throw new AppError("Failed to create Shopify checkout cart.", 502);
	}
}

export async function startMembershipStorefrontCheckoutOp(
	deps: Pick<
		MembershipCheckoutHelperDeps,
		"organizations" | "checkout" | "storefront" | "eventBus"
	>,
	intent: CheckoutIntentRecord,
	cart: CheckoutCartRecord,
) {
	const integration = await deps.organizations.getShopifyIntegration(
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
		await deps.checkout.markCheckoutStarted(intent.id);
		const result = await deps.storefront.checkout({
			organizationId: intent.organizationId,
			shopifyCartId: cart.shopifyCartId,
		});
		assertAllowedCheckoutUrl(result.checkoutUrl, domain);
		deps.eventBus?.emit({
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
		await deps.checkout.markFailed(intent.id);
		if (error instanceof AppError) throw error;
		throw new AppError("Failed to start Shopify checkout.", 502);
	}
}
