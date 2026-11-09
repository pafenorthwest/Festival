import { CustomerAccountTransport } from "../customer/customer-account-transport.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";
import type { ClassCheckoutStorefrontBinding } from "./class-checkout-execution.js";
import {
	ClassCheckoutCartObservationError,
	ClassCheckoutStorefrontChangedBeforeRequestError,
} from "./class-checkout-service.js";
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
		expectedStorefrontBinding?: ClassCheckoutStorefrontBinding;
		shopifyVariantGid?: string;
		buyerAccessToken: string;
		correlationId: string;
		lines?: Array<{
			merchandiseId: string;
			quantity: number;
			attributes?: Array<{ key: string; value: string }>;
		}>;
	}) {
		const payload = await this.call(
			input.organizationId,
			`mutation FestivalCreateCart($input: CartInput!) { cartCreate(input: $input) { cart { id } userErrors { message } warnings { message } } }`,
			{
				input: {
					lines: input.lines ?? [
						{ merchandiseId: input.shopifyVariantGid ?? "", quantity: 1 },
					],
					attributes: [
						{ key: "festival_checkout_intent_id", value: input.correlationId },
					],
					buyerIdentity: { customerAccessToken: input.buyerAccessToken },
				},
			},
			input.expectedStorefrontBinding,
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
		) {
			if (record(result?.cart) && typeof result.cart.id === "string")
				throw new ClassCheckoutCartObservationError(result.cart.id);
			throw unavailable();
		}
		return { shopifyCartId: result.cart.id };
	}

	async checkout(input: {
		organizationId: string;
		shopifyCartId: string;
		expectedStorefrontBinding?: ClassCheckoutStorefrontBinding;
	}) {
		const payload = await this.call(
			input.organizationId,
			`query FestivalCartCheckout($id: ID!) { cart(id: $id) { id checkoutUrl } }`,
			{ id: input.shopifyCartId },
			input.expectedStorefrontBinding,
		);
		const cart =
			record(payload.data) && record(payload.data.cart)
				? payload.data.cart
				: undefined;
		if (!cart || typeof cart.checkoutUrl !== "string") throw unavailable();
		return { checkoutUrl: cart.checkoutUrl };
	}

	/** Read-only evidence verification; Festival request identities are never sent. */
	async inspectCart(input: {
		organizationId: string;
		shopifyCartId: string;
		expectedStorefrontBinding?: ClassCheckoutStorefrontBinding;
	}) {
		const payload = await this.call(
			input.organizationId,
			`query FestivalCartEvidence($id: ID!) { cart(id: $id) { attributes { key value } buyerIdentity { customer { id } } lines(first: 250) { pageInfo { hasNextPage } nodes { quantity attributes { key value } merchandise { ... on ProductVariant { id } } } } } }`,
			{ id: input.shopifyCartId },
			input.expectedStorefrontBinding,
		);
		const cart =
			record(payload.data) && record(payload.data.cart)
				? payload.data.cart
				: null;
		if (
			!cart ||
			!record(cart.lines) ||
			!Array.isArray(cart.lines.nodes) ||
			!record(cart.lines.pageInfo) ||
			cart.lines.pageInfo.hasNextPage !== false
		)
			throw unavailable();
		const attribute = (values: unknown, key: string): string | null => {
			if (!Array.isArray(values)) return null;
			const matches = values.filter(
				(value) => record(value) && value.key === key,
			);
			return matches.length === 1 &&
				record(matches[0]) &&
				typeof matches[0].value === "string"
				? matches[0].value
				: null;
		};
		const buyer =
			record(cart.buyerIdentity) && record(cart.buyerIdentity.customer)
				? cart.buyerIdentity.customer
				: null;
		return {
			correlationId: attribute(cart.attributes, "festival_checkout_intent_id"),
			customerGid: buyer && typeof buyer.id === "string" ? buyer.id : null,
			lines: cart.lines.nodes.map((value) => {
				if (
					!record(value) ||
					!record(value.merchandise) ||
					typeof value.merchandise.id !== "string" ||
					typeof value.quantity !== "number"
				)
					throw unavailable();
				return {
					intentLineId: attribute(
						value.attributes,
						"festival_checkout_intent_line_id",
					),
					variantGid: value.merchandise.id,
					quantity: value.quantity,
				};
			}),
		};
	}

	private async call(
		organizationId: string,
		query: string,
		variables: Record<string, unknown>,
		expectedStorefrontBinding?: ClassCheckoutStorefrontBinding,
	): Promise<Record<string, unknown>> {
		const integration =
			await this.organizations.getShopifyIntegration(organizationId);
		if (
			expectedStorefrontBinding &&
			(!integration ||
				integration.storeDomain.toLowerCase() !==
					expectedStorefrontBinding.shopDomain ||
				integration.integrationVersion !==
					expectedStorefrontBinding.integrationVersion)
		)
			throw new ClassCheckoutStorefrontChangedBeforeRequestError();
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
			if (!record(payload)) throw unavailable();
			if (payload.errors !== undefined) {
				const creation =
					record(payload.data) && record(payload.data.cartCreate)
						? payload.data.cartCreate
						: null;
				if (
					creation &&
					record(creation.cart) &&
					typeof creation.cart.id === "string"
				)
					throw new ClassCheckoutCartObservationError(creation.cart.id);
				throw unavailable();
			}
			return payload;
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw unavailable();
		}
	}
}
