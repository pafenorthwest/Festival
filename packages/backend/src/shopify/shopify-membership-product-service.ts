import type {
	MembershipProductSummary,
	ShopifyAdminCapability,
	ShopifyFailureCategory,
} from "@festival/common";
import {
	INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	validateMembershipProductInput,
} from "@festival/common";
import type { TenantContext } from "../auth/tenant-context.js";
import { AppError } from "../errors/app-error.js";
import type {
	OrganizationRepository,
	ProductRecord,
	ShopifyIntegrationRecord,
} from "../repo/organization-repository.js";
import type {
	ShopifyMutationAuditOperation,
	ShopifyMutationAuditWriter,
} from "./admin-mutation-audit.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "./encryption.js";
import { ShopifyIntegrationError } from "./errors.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
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
			errorName?: string;
		},
	): void;
}

const silentCleanupFailureLogger: ShopifyCleanupFailureLogger = {
	error() {},
};

function isValidPrice(value: string): boolean {
	return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value);
}

function toAppError(error: unknown): AppError {
	if (error instanceof AppError) {
		return error;
	}

	if (error instanceof ShopifyIntegrationError || error instanceof Error) {
		return new AppError("Shopify membership product operation failed.", 502);
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
		name: record.productNameSnapshot,
		description: product.description,
		shopifyProductGid: product.id,
		shopifyVariantGid: variant.id,
		variantName: FIXED_OPTION_VALUE,
		entitlementClass: record.entitlementClass,
		durationDays: record.durationDays,
		isActive: record.isActive,
		price: variant.price,
		status: product.status,
		createdAtIso: record.createdAtIso,
	};
}

export class ShopifyMembershipProductService {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly secretKeyring: ShopifySecretKeyring,
		private readonly shopifyClient: ShopifyMembershipProductClient,
		private readonly mutationAudit: ShopifyMutationAuditWriter,
		private readonly cleanupFailureLogger: ShopifyCleanupFailureLogger = silentCleanupFailureLogger,
	) {}

	async createMembershipProduct(
		tenant: TenantContext,
		input: unknown,
	): Promise<MembershipProductSummary> {
		const validation = validateMembershipProductInput(input);
		if (!validation.valid) {
			throw new AppError(validation.errors.join(" "), 400);
		}

		const existingOffering =
			await this.repository.findMembershipProductRecordByClass(
				tenant.organization.id,
				TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			);
		if (existingOffering) {
			throw new AppError(
				"An active Teacher Membership already exists for this organization.",
				409,
			);
		}

		const writeContext = await this.loadOperationContext(
			tenant,
			"write_products",
		);
		const readContext = await this.loadOperationContext(
			tenant,
			"read_products",
		);
		let createdProduct: ShopifyProductDetails | null = null;

		try {
			createdProduct = await this.attemptMutation(
				writeContext,
				"productCreate",
				() =>
					this.shopifyClient.createProduct(writeContext, {
						name: validation.input.name,
						description: validation.input.description,
					}),
				(product) => {
					createdProduct = product;
				},
			);
			let variant = assertSupportedProductShape(createdProduct);

			const pricedProduct = await this.attemptMutation(
				writeContext,
				"productVariantUpdate",
				() =>
					this.shopifyClient.updateVariantPrice(writeContext, {
						productId: createdProduct?.id ?? "",
						variantId: variant.id,
						price: validation.input.price,
					}),
			);
			variant = assertSupportedProductShape(pricedProduct, createdProduct.id);
			const { value: confirmedProducts } =
				await this.shopifyClient.readProductsByGid(readContext, [
					pricedProduct.id,
				]);
			const [confirmedProduct] = confirmedProducts;
			if (!confirmedProduct) {
				throw new AppError("Shopify membership product was not found.", 502);
			}
			variant = assertSupportedProductShape(
				confirmedProduct,
				createdProduct.id,
			);

			const record = await this.repository.createMembershipProductRecord({
				organizationId: tenant.organization.id,
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				durationDays: INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
				isActive: true,
				shopifyProductGid: confirmedProduct.id,
				shopifyVariantGid: variant.id,
				productNameSnapshot: confirmedProduct.title,
			});

			return toSummary(record, confirmedProduct, variant);
		} catch (error) {
			if (createdProduct) {
				await this.tryCleanupProduct(writeContext, createdProduct.id);
			}

			throw toAppError(error);
		}
	}

	async listMembershipProductsForOrganization(
		tenant: TenantContext,
	): Promise<MembershipProductSummary[]> {
		const records = await this.repository.listMembershipProductRecords(
			tenant.organization.id,
		);
		if (records.length === 0) {
			return [];
		}

		const context = await this.loadOperationContext(tenant, "read_products");
		try {
			const { value: products } = await this.shopifyClient.readProductsByGid(
				context,
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

	private async loadOperationContext(
		tenant: TenantContext,
		capability: ShopifyAdminCapability,
	): Promise<ShopifyAdminOperationContext> {
		const organizationId = tenant.organization.id;
		const integration =
			await this.repository.getShopifyIntegration(organizationId);
		this.assertVerifiedIntegration(integration, capability);

		const credentials: ShopifyCredentials = {
			organizationId,
			storeDomain: integration.storeDomain,
			clientId: integration.clientId,
			clientSecret: this.secretKeyring.decrypt(
				integration.encryptedClientSecret,
				{
					organizationId,
					purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
				},
			),
			integrationVersion: integration.integrationVersion,
		};
		return {
			organizationId,
			firebaseActorUid: tenant.identity.uid,
			verifiedShopGid: integration.verifiedShopGid,
			verifiedShopDomain: integration.verifiedShopDomain,
			integrationVersion: integration.integrationVersion,
			grantedScopes: [...integration.grantedScopes],
			capability,
			credentials,
		};
	}

	private assertVerifiedIntegration(
		integration: ShopifyIntegrationRecord | null,
		capability: ShopifyAdminCapability,
	): asserts integration is ShopifyIntegrationRecord & {
		verifiedShopGid: string;
		verifiedShopDomain: string;
	} {
		if (!integration) {
			throw new AppError("Shopify integration is not configured.", 409);
		}

		if (
			integration.verificationStatus !== "ok" ||
			!integration.verifiedShopGid ||
			!integration.verifiedShopDomain
		) {
			throw new AppError("Shopify integration has not been verified.", 409);
		}
		if (integration.capabilities[capability] !== "granted") {
			throw new AppError(
				"Shopify integration does not grant the required capability.",
				409,
			);
		}
	}

	private async attemptMutation<T>(
		context: ShopifyAdminOperationContext,
		operation: ShopifyMutationAuditOperation,
		attempt: () => Promise<ShopifyAdminResult<T>>,
		onMutationSucceeded?: (value: T) => void,
	): Promise<T> {
		const auditAttempt = {
			timestampIso: new Date().toISOString(),
			firebaseActorUid: context.firebaseActorUid,
			organizationId: context.organizationId,
			operation,
		};
		await this.mutationAudit.ensureReady(auditAttempt);
		let response: ShopifyAdminResult<T>;
		try {
			response = await attempt();
		} catch (error) {
			const requestId =
				error instanceof ShopifyIntegrationError ? error.requestId : undefined;
			await this.mutationAudit.append({
				...auditAttempt,
				requestId,
				result: "failure",
				failureCategory: this.failureCategory(error),
			});
			throw error;
		}
		onMutationSucceeded?.(response.value);
		await this.mutationAudit.append({
			...auditAttempt,
			requestId: response.requestId,
			result: "success",
		});
		return response.value;
	}

	private failureCategory(error: unknown): ShopifyFailureCategory {
		return error instanceof ShopifyIntegrationError
			? error.failureCategory
			: "transport";
	}

	private async tryCleanupProduct(
		context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<void> {
		try {
			await this.attemptMutation(context, "productDelete", () =>
				this.shopifyClient.deleteProduct(context, productGid),
			);
		} catch (error) {
			this.cleanupFailureLogger.error(
				"Shopify membership product cleanup failed after local persistence failure.",
				{
					operation: "shopify.membershipProduct.cleanup",
					errorName: error instanceof Error ? error.name : undefined,
				},
			);
		}
	}
}
