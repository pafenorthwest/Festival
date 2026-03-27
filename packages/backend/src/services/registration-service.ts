import {
	type CheckoutRequest,
	type CheckoutResult,
	FESTIVAL_CLASS_CATALOG,
	type PayerProfile,
	type PayerProfileInput,
	type RefundRequest,
	type RefundResult,
	type StudentMetadata,
	validateCartRules,
} from "@festival/common";
import type { ShopifyAdminClient } from "../clients/shopify-admin-client.js";
import type { ShopifyStorefrontClient } from "../clients/shopify-storefront-client.js";
import type { StripeClient } from "../clients/stripe-client.js";
import type { InMemoryRepository } from "../repo/in-memory-repository.js";

export class RegistrationService {
	constructor(
		private readonly repository: InMemoryRepository,
		private readonly shopifyAdminClient: ShopifyAdminClient,
		private readonly shopifyStorefrontClient: ShopifyStorefrontClient,
		private readonly stripeClient: StripeClient,
	) {}

	async createPayer(input: PayerProfileInput): Promise<PayerProfile> {
		const customer = await this.shopifyAdminClient.upsertCustomer(input);
		return this.repository.createPayer(input, customer.id);
	}

	async createDigitalPass(
		payerId: string,
		studentId: string,
		classId: string,
		metadata: StudentMetadata,
	): Promise<{
		passId: string;
		passToken: string;
		providerMode: "live" | "mock";
	}> {
		const payer = this.repository.getPayerById(payerId);
		if (!payer) {
			throw new Error(`Payer not found: ${payerId}`);
		}

		const classExists = FESTIVAL_CLASS_CATALOG.some(
			(festivalClass) => festivalClass.id === classId,
		);
		if (!classExists) {
			throw new Error(`Class not found: ${classId}`);
		}

		const pass = this.repository.createPass(studentId, classId, metadata);
		const metadataResult = await this.shopifyAdminClient.storeStudentMetadata(
			payer.shopifyCustomerId,
			metadata,
		);

		return {
			passId: pass.id,
			passToken: pass.passToken,
			providerMode: metadataResult.providerMode,
		};
	}

	validateSelection(
		selection: CheckoutRequest["selection"],
		eligibility: CheckoutRequest["eligibility"],
	): ReturnType<typeof validateCartRules> {
		return validateCartRules(selection, FESTIVAL_CLASS_CATALOG, eligibility);
	}

	async createCheckout(
		checkoutRequest: CheckoutRequest,
	): Promise<CheckoutResult> {
		const payer = this.repository.getPayerById(checkoutRequest.payerId);
		if (!payer) {
			throw new Error(`Payer not found: ${checkoutRequest.payerId}`);
		}

		const validation = this.validateSelection(
			checkoutRequest.selection,
			checkoutRequest.eligibility,
		);
		if (!validation.valid) {
			throw new Error(
				`Cart validation failed: ${validation.errors.join("; ")}`,
			);
		}

		const selectedClasses = FESTIVAL_CLASS_CATALOG.filter((festivalClass) =>
			validation.selectedClassIds.includes(festivalClass.id),
		);

		const amountCents = selectedClasses.reduce(
			(sum, item) => sum + item.priceCents,
			0,
		);
		if (amountCents <= 0) {
			throw new Error("Checkout amount must be greater than 0.");
		}

		const cart = await this.shopifyStorefrontClient.createCart(
			selectedClasses.map((festivalClass) => ({
				merchandiseId: festivalClass.shopifyVariantId,
				quantity: 1,
			})),
			payer.email,
		);

		const paymentIntent = await this.stripeClient.createPaymentIntent(
			amountCents,
			checkoutRequest.currency,
			{
				payerId: checkoutRequest.payerId,
				studentId: checkoutRequest.studentId,
				cartId: cart.id,
			},
		);

		return {
			cartId: cart.id,
			checkoutUrl: cart.checkoutUrl,
			paymentIntentId: paymentIntent.id,
			amountCents,
			providerMode:
				cart.providerMode === "live" && paymentIntent.providerMode === "live"
					? "live"
					: "mock",
		};
	}

	async processDropRefund(refundRequest: RefundRequest): Promise<RefundResult> {
		const [shopifyRefund, stripeRefund] = await Promise.all([
			this.shopifyAdminClient.createRefund(refundRequest),
			this.stripeClient.createRefund(
				refundRequest.paymentIntentId,
				refundRequest.amountCents,
			),
		]);

		return {
			shopifyRefundId: shopifyRefund.id,
			stripeRefundId: stripeRefund.id,
			reconciled: true,
			providerMode:
				shopifyRefund.providerMode === "live" &&
				stripeRefund.providerMode === "live"
					? "live"
					: "mock",
		};
	}
}
