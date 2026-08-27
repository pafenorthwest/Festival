import { CustomerAccountTransport } from "../customer/customer-account-transport.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";
import type { MembershipCheckoutStorefront } from "./membership-checkout-service.js";

const API_VERSION = "2026-07";
const DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function unavailable(): AppError {
	return new AppError("Shopify checkout is temporarily unavailable.", 503);
}
function record(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class ShopifyMembershipCheckoutClient
	implements MembershipCheckoutStorefront
{
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly keyring: ShopifySecretKeyring,
		private readonly transport = new CustomerAccountTransport(),
	) {}

	async createCart(input: {
		organizationId: string;
		shopifyVariantGid: string;
		buyerAccessToken: string;
		correlationId: string;
	}) {
		const payload = await this.call(
			input.organizationId,
			`mutation FestivalCreateCart($input: CartInput!) { cartCreate(input: $input) { cart { id } userErrors { message } warnings { message } } }`,
			{
				input: {
					lines: [{ merchandiseId: input.shopifyVariantGid, quantity: 1 }],
					attributes: [
						{ key: "festival_checkout_intent_id", value: input.correlationId },
					],
					buyerIdentity: { customerAccessToken: input.buyerAccessToken },
				},
			},
		);
		const result =
			record(payload.data) && record(payload.data.cartCreate)
				? payload.data.cartCreate
				: undefined;
		if (
			!record(result) ||
			(Array.isArray(result.userErrors) && result.userErrors.length) ||
			(Array.isArray(result.warnings) && result.warnings.length) ||
			!record(result.cart) ||
			typeof result.cart.id !== "string"
		)
			throw unavailable();
		return { shopifyCartId: result.cart.id };
	}

	async checkout(input: { organizationId: string; shopifyCartId: string }) {
		const payload = await this.call(
			input.organizationId,
			`query FestivalCartCheckout($id: ID!) { cart(id: $id) { id checkoutUrl } }`,
			{ id: input.shopifyCartId },
		);
		const cart =
			record(payload.data) && record(payload.data.cart)
				? payload.data.cart
				: undefined;
		if (!cart || typeof cart.checkoutUrl !== "string") throw unavailable();
		return { checkoutUrl: cart.checkoutUrl };
	}

	private async call(
		organizationId: string,
		query: string,
		variables: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const integration =
			await this.organizations.getShopifyIntegration(organizationId);
		if (
			!integration?.encryptedStorefrontPrivateToken ||
			!DOMAIN.test(integration.storeDomain.toLowerCase())
		)
			throw unavailable();
		const token = this.keyring.decrypt(
			integration.encryptedStorefrontPrivateToken,
			{ organizationId, purpose: SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE },
		);
		try {
			const payload = await this.transport.json(
				new URL(
					`https://${integration.storeDomain.toLowerCase()}/api/${API_VERSION}/graphql.json`,
				),
				integration.storeDomain,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Shopify-Storefront-Private-Token": token,
						"User-Agent": "Festival-Membership-Checkout/1.0",
					},
					body: JSON.stringify({ query, variables }),
				},
			);
			if (!record(payload) || payload.errors !== undefined) throw unavailable();
			return payload;
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw unavailable();
		}
	}
}
