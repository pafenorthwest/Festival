import { AppError, type FestivalClassConfiguration } from "@festival/common";
import type {
	ClassCheckoutClaim,
	ClassCheckoutStorefrontBinding,
} from "./checkout-execution-types.js";
import {
	CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY,
	requireClassCheckoutIntentLineMapping,
} from "./checkout-line-helpers.js";
import type {
	CheckoutCartRecord,
	CheckoutIntentRecord,
} from "./checkout-types.js";
import {
	type CartHandoffDeps,
	handleAttachCartFailure,
	handleCreateCartFailure,
	handleStorefrontCheckoutError,
	isInvalidShopifyCartError,
	isValidCheckoutUrlForDomain,
	markAttachedRetryable,
	recordRemoteCartKnownOrThrow,
	resolveStorefrontBinding,
	sameStorefrontBinding,
} from "./class-checkout-cart-recovery.js";
import {
	ClassCheckoutPersistenceUnavailableError,
	ClassCheckoutStorefrontChangedBeforeRequestError,
} from "./class-checkout-errors.js";
import { verifyPostCartCreateCapacityCutoff } from "./class-checkout-validation.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCommerceReadPort,
	CheckoutOrganizationReadPort,
} from "./ports.js";

export {
	type CartHandoffDeps,
	isInvalidShopifyCartError,
	resolveStorefrontBinding,
	sameStorefrontBinding,
};

async function loadFreshClassConfigs(
	catalog: CheckoutCatalogReadPort | undefined,
	organizationId: string,
	entries: Array<{ festivalClass: FestivalClassConfiguration; count: number }>,
): Promise<Map<string, FestivalClassConfiguration>> {
	const freshById = new Map<string, FestivalClassConfiguration>();
	if (entries.length === 0) return freshById;
	if (catalog?.findFestivalClassConfigurationsByIds) {
		const freshList = await catalog.findFestivalClassConfigurationsByIds(
			organizationId,
			entries[0].festivalClass.festivalId,
			entries.map((entry) => entry.festivalClass.id),
		);
		for (const fc of freshList) freshById.set(fc.id, fc);
	} else if (catalog?.findFestivalClassConfigurationById) {
		for (const entry of entries) {
			const fresh = await catalog.findFestivalClassConfigurationById(
				organizationId,
				entry.festivalClass.festivalId,
				entry.festivalClass.id,
			);
			if (fresh) freshById.set(fresh.id, fresh);
		}
	}
	return freshById;
}

export function buildMultiLineCapacityCheck(
	deps: {
		commerce?: CheckoutCommerceReadPort;
		organizations?: CheckoutOrganizationReadPort;
		catalog?: CheckoutCatalogReadPort;
	},
	organizationId: string,
	lines: Array<{ festivalClass: FestivalClassConfiguration }>,
): (() => Promise<AppError | null>) | undefined {
	if (!deps.commerce) return undefined;
	const commerce = deps.commerce;
	const seatDemandByClass = new Map<
		string,
		{ festivalClass: FestivalClassConfiguration; count: number }
	>();
	for (const line of lines) {
		const existing = seatDemandByClass.get(line.festivalClass.id);
		if (existing) existing.count += 1;
		else
			seatDemandByClass.set(line.festivalClass.id, {
				festivalClass: line.festivalClass,
				count: 1,
			});
	}
	return async () => {
		const entries = [...seatDemandByClass.values()];
		const freshById = await loadFreshClassConfigs(
			deps.catalog,
			organizationId,
			entries,
		);
		for (const entry of entries) {
			const err = await verifyPostCartCreateCapacityCutoff({
				commerce,
				organizations: deps.organizations,
				organizationId,
				festivalClass:
					freshById.get(entry.festivalClass.id) ?? entry.festivalClass,
				requestedSeats: entry.count,
			});
			if (err) return err;
		}
		return null;
	};
}

async function transitionCreateDispatchedOrThrow(
	deps: CartHandoffDeps,
	binding: ClassCheckoutStorefrontBinding,
	claim?: ClassCheckoutClaim,
): Promise<void> {
	if (!claim || !deps.checkout.classExecutions) return;
	const transitioned = await deps.checkout.classExecutions.transition({
		claim,
		checkpoint: "create_dispatched",
		storefrontBinding: binding,
		eventType: "create_dispatched",
	});
	if (!transitioned) throw new ClassCheckoutPersistenceUnavailableError();
}

export interface CreateShopifyCartParams {
	organizationId: string;
	customerId: string;
	buyerAccessToken: string;
	shopifyCustomerGid?: string | null;
	intent: CheckoutIntentRecord;
	expectedLineSpecs: Array<{
		festivalClassId: string;
		childId: string;
		shopifyProductGid: string;
		shopifyVariantGid: string;
		amount: string;
		currencyCode: string;
	}>;
	binding: ClassCheckoutStorefrontBinding;
	claim?: ClassCheckoutClaim;
}

export async function createShopifyCartForIntent(
	deps: CartHandoffDeps,
	params: CreateShopifyCartParams,
): Promise<{ shopifyCartId: string; checkoutUrl?: string }> {
	const mappedLines = requireClassCheckoutIntentLineMapping(
		params.intent,
		params.expectedLineSpecs,
	);
	await transitionCreateDispatchedOrThrow(deps, params.binding, params.claim);
	const current = await deps.organizations.getShopifyIntegration(
		params.organizationId,
	);
	if (
		!sameStorefrontBinding(resolveStorefrontBinding(current), params.binding)
	) {
		throw new ClassCheckoutStorefrontChangedBeforeRequestError();
	}
	try {
		const created = await deps.storefront.createCart({
			organizationId: params.organizationId,
			expectedStorefrontBinding: params.binding,
			shopifyVariantGid: mappedLines[0]?.shopifyVariantGid,
			buyerAccessToken: params.buyerAccessToken,
			shopifyCustomerGid: params.shopifyCustomerGid ?? undefined,
			correlationId: params.intent.correlationId,
			currencyCode: params.intent.currencyCode,
			lines: mappedLines.map((line) => ({
				merchandiseId: line.shopifyVariantGid,
				shopifyVariantGid: line.shopifyVariantGid,
				variantGid: line.shopifyVariantGid,
				quantity: 1,
				attributes: [
					{ key: CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY, value: line.id },
				],
			})),
		});
		if (params.claim) {
			await recordRemoteCartKnownOrThrow(deps, {
				organizationId: params.organizationId,
				intent: params.intent,
				claim: params.claim,
				shopifyCartId: created.shopifyCartId,
			});
		}
		return created;
	} catch (error) {
		return handleCreateCartFailure(
			deps,
			{
				organizationId: params.organizationId,
				intent: params.intent,
				claim: params.claim,
			},
			error,
		);
	}
}

function computeCartExpiresAtIso(
	now: Date,
	intentExpiresAtIso: string,
): string {
	const defaultMs = now.getTime() + 30 * 60 * 1000;
	const intentMs = Date.parse(intentExpiresAtIso);
	return Number.isFinite(intentMs)
		? new Date(Math.min(defaultMs, intentMs)).toISOString()
		: new Date(defaultMs).toISOString();
}

export async function attachCartAndStartCheckout(
	deps: CartHandoffDeps,
	params: {
		intent: CheckoutIntentRecord;
		shopifyCartId: string;
		binding: ClassCheckoutStorefrontBinding;
		capacityCheck?: () => Promise<AppError | null>;
		claim?: ClassCheckoutClaim;
	},
): Promise<{ cart: CheckoutCartRecord; checkoutUrl: string }> {
	const attachInput = {
		intentId: params.intent.id,
		shopifyCartId: params.shopifyCartId,
		organizationId: params.intent.organizationId,
		customerId: params.intent.customerId,
		sessionId: params.intent.sessionId,
		integrationVersion: params.binding.integrationVersion,
		expiresAtIso: computeCartExpiresAtIso(
			deps.now(),
			params.intent.expiresAtIso,
		),
		capacityCheck: params.capacityCheck,
		executionClaim: params.claim,
	};
	let cart: CheckoutCartRecord;
	try {
		cart = deps.checkout.markIntentReady
			? await deps.checkout.markIntentReady(attachInput)
			: await deps.checkout.attachCart(attachInput);
	} catch (error) {
		return handleAttachCartFailure(deps, params, error);
	}
	if (params.claim && deps.checkout.classExecutions) {
		await deps.checkout.classExecutions.transition({
			claim: params.claim,
			checkpoint: "attached",
			state: "completed",
			shopifyCartId: params.shopifyCartId,
			releaseLease: true,
			eventType: "cart_attached",
			evidence: { shopifyCartId: params.shopifyCartId },
		});
	}
	await deps.checkout.markCheckoutStarted(params.intent.id);
	const checkout = await runStorefrontCheckout(deps, {
		organizationId: params.intent.organizationId,
		intentId: params.intent.id,
		correlationId: params.intent.correlationId,
		shopifyCartId: cart.shopifyCartId,
		binding: params.binding,
	});
	return { cart, checkoutUrl: checkout.checkoutUrl };
}

export async function runStorefrontCheckout(
	deps: CartHandoffDeps,
	params: {
		organizationId: string;
		intentId: string;
		correlationId?: string;
		shopifyCartId: string;
		binding: ClassCheckoutStorefrontBinding;
	},
): Promise<{ checkoutUrl: string }> {
	const current = await deps.organizations.getShopifyIntegration(
		params.organizationId,
	);
	if (
		!sameStorefrontBinding(resolveStorefrontBinding(current), params.binding)
	) {
		await markAttachedRetryable(deps, params.organizationId, params.intentId);
		throw new AppError(
			"Shopify Storefront configuration changed before checkout URL retrieval.",
			503,
			"checkout_retryable_upstream",
		);
	}
	try {
		const result = await deps.storefront.checkout({
			organizationId: params.organizationId,
			shopifyCartId: params.shopifyCartId,
			expectedStorefrontBinding: params.binding,
		});
		const after = await deps.organizations.getShopifyIntegration(
			params.organizationId,
		);
		if (
			!sameStorefrontBinding(resolveStorefrontBinding(after), params.binding) ||
			!isValidCheckoutUrlForDomain(
				result.checkoutUrl,
				params.binding.shopDomain,
			)
		) {
			await markAttachedRetryable(deps, params.organizationId, params.intentId);
			throw new AppError(
				"Shopify checkout URL verification failed.",
				503,
				"checkout_retryable_upstream",
			);
		}
		return result;
	} catch (error) {
		return handleStorefrontCheckoutError(deps, params, error);
	}
}
