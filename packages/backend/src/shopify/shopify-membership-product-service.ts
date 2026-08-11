import type {
	MembershipProductSummary,
	OrganizationRecord,
} from "@festival/common";
import { validateMembershipProductInput } from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type {
	OrganizationRepository,
	ProductRecord,
	ShopifyIntegrationRecord,
} from "../repo/organization-repository.js";
import type { AesSecretEncryptor } from "./encryption.js";
import { ShopifyIntegrationError } from "./errors.js";
import type {
	ShopifyCredentials,
	ShopifyMembershipProductClient,
	ShopifyProductDetails,
	ShopifyProductVariant,
} from "./types.js";

const FIXED_OPTION_NAME = "Plan";
const FIXED_OPTION_VALUE = "Standard";

export interface ShopifyCleanupFailureLogger {
	error(
		message: string,
		context: {
			operation: "shopify.membershipProduct.cleanup";
			shopifyProductGid: string;
			errorName?: string;
			errorMessage?: string;
		},
	): void;
}

const consoleCleanupFailureLogger: ShopifyCleanupFailureLogger = {
	error(message, context) {
		console.error(message, context);
	},
};

function isValidPrice(value: string): boolean {
	return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value);
}

function toAppError(error: unknown): AppError {
	if (error instanceof AppError) {
		return error;
	}

	if (error instanceof ShopifyIntegrationError) {
		return new AppError(error.message, 502);
	}

	if (error instanceof Error) {
		return new AppError(error.message, 502);
	}

	return new AppError("Shopify membership product operation failed.", 502);
}

function assertSupportedProductShape(
	product: ShopifyProductDetails,
	expectedProductGid?: string,
): ShopifyProductVariant {
	if (!product.id) {
		throw new AppError(
			"Shopify product response did not include a Product GID.",
			502,
		);
	}

	if (expectedProductGid && product.id !== expectedProductGid) {
		throw new AppError(
			"Shopify product response did not match the requested Product GID.",
			502,
		);
	}

	if (product.variants.length !== 1) {
		throw new AppError(
			"Shopify membership product must have exactly one variant.",
			502,
		);
	}

	const variant = product.variants[0];
	if (!variant.id) {
		throw new AppError(
			"Shopify product response did not include a Variant GID.",
			502,
		);
	}

	if (variant.productId !== product.id) {
		throw new AppError(
			"Shopify membership product variant does not belong to the returned product.",
			502,
		);
	}

	const hasStandardPlan = variant.selectedOptions.some(
		(option) =>
			option.name === FIXED_OPTION_NAME && option.value === FIXED_OPTION_VALUE,
	);
	if (!hasStandardPlan) {
		throw new AppError(
			"Shopify membership product variant must use Plan = Standard.",
			502,
		);
	}

	if (!isValidPrice(variant.price.amount)) {
		throw new AppError(
			"Shopify membership product variant price is unsupported.",
			502,
		);
	}

	return variant;
}

function toSummary(
	record: ProductRecord,
	product: ShopifyProductDetails,
	variant: ShopifyProductVariant,
): MembershipProductSummary {
	return {
		id: record.id,
		name: product.title,
		description: product.description,
		shopifyProductGid: product.id,
		shopifyVariantGid: variant.id,
		variantName: FIXED_OPTION_VALUE,
		membershipType: record.membershipType,
		entitlementPeriod: record.entitlementPeriod,
		price: variant.price,
		status: product.status,
		createdAtIso: record.createdAtIso,
	};
}

export class ShopifyMembershipProductService {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly encryptor: AesSecretEncryptor,
		private readonly shopifyClient: ShopifyMembershipProductClient,
		private readonly cleanupFailureLogger: ShopifyCleanupFailureLogger = consoleCleanupFailureLogger,
	) {}

	async createMembershipProduct(
		organization: OrganizationRecord,
		input: unknown,
	): Promise<MembershipProductSummary> {
		const validation = validateMembershipProductInput(input);
		if (!validation.valid) {
			throw new AppError(validation.errors.join(" "), 400);
		}

		const credentials = await this.loadVerifiedCredentials(organization.id);
		let createdProduct: ShopifyProductDetails | null = null;

		try {
			createdProduct = await this.shopifyClient.createProduct(credentials, {
				name: validation.input.name,
				description: validation.input.description,
			});
			let variant = assertSupportedProductShape(createdProduct);

			const pricedProduct = await this.shopifyClient.updateVariantPrice(
				credentials,
				{
					productId: createdProduct.id,
					variantId: variant.id,
					price: validation.input.price,
				},
			);
			variant = assertSupportedProductShape(pricedProduct, createdProduct.id);

			const record = await this.repository.createMembershipProductRecord({
				organizationId: organization.id,
				membershipType: validation.input.membershipType,
				entitlementPeriod: validation.input.entitlementPeriod,
				shopifyProductGid: pricedProduct.id,
				shopifyVariantGid: variant.id,
				productNameSnapshot: pricedProduct.title,
			});

			return toSummary(record, pricedProduct, variant);
		} catch (error) {
			if (createdProduct) {
				await this.tryCleanupProduct(credentials, createdProduct.id);
			}

			throw toAppError(error);
		}
	}

	async listMembershipProductsForOrganization(
		organization: OrganizationRecord,
	): Promise<MembershipProductSummary[]> {
		const records = await this.repository.listMembershipProductRecords(
			organization.id,
		);
		if (records.length === 0) {
			return [];
		}

		const credentials = await this.loadVerifiedCredentials(organization.id);
		try {
			const products = await this.shopifyClient.readProductsByGid(
				credentials,
				records.map((record) => record.shopifyProductGid),
			);
			const productsByGid = new Map(
				products.map((product) => [product.id, product]),
			);

			return records.map((record) => {
				const product = productsByGid.get(record.shopifyProductGid);
				if (!product) {
					throw new AppError("Shopify membership product was not found.", 502);
				}

				const variant = assertSupportedProductShape(
					product,
					record.shopifyProductGid,
				);
				if (variant.id !== record.shopifyVariantGid) {
					throw new AppError(
						"Shopify membership product variant did not match the local association.",
						502,
					);
				}

				return toSummary(record, product, variant);
			});
		} catch (error) {
			throw toAppError(error);
		}
	}

	private async loadVerifiedCredentials(
		organizationId: string,
	): Promise<ShopifyCredentials> {
		const integration =
			await this.repository.getShopifyIntegration(organizationId);
		this.assertVerifiedIntegration(integration);

		return {
			storeDomain: integration.storeDomain,
			clientId: integration.clientId,
			clientSecret: this.encryptor.decrypt(integration.encryptedClientSecret),
		};
	}

	private assertVerifiedIntegration(
		integration: ShopifyIntegrationRecord | null,
	): asserts integration is ShopifyIntegrationRecord {
		if (!integration) {
			throw new AppError("Shopify integration is not configured.", 409);
		}

		if (integration.verificationStatus !== "ok") {
			throw new AppError("Shopify integration has not been verified.", 409);
		}
	}

	private async tryCleanupProduct(
		credentials: ShopifyCredentials,
		productGid: string,
	): Promise<void> {
		try {
			await this.shopifyClient.deleteProduct(credentials, productGid);
		} catch (error) {
			this.cleanupFailureLogger.error(
				"Shopify membership product cleanup failed after local persistence failure.",
				{
					operation: "shopify.membershipProduct.cleanup",
					shopifyProductGid: productGid,
					errorName: error instanceof Error ? error.name : undefined,
					errorMessage: error instanceof Error ? error.message : undefined,
				},
			);
		}
	}
}
