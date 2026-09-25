import type {
	MembershipProductSummary,
	ShopifyAdminCapability,
	ShopifyFailureCategory,
} from "@festival/common";
import {
	ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
	assertValidEntitlementDurationDays,
	type EntitlementClass,
	INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
	normalizeEffectiveShopifyScopes,
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
import { ShopifyIntegrationError, ShopifyScopeError } from "./errors.js";
import { ShopifyProductLifecycleService } from "./shopify-product-lifecycle-service.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyCredentials,
	ShopifyProductClient,
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
	if (error instanceof ShopifyScopeError) {
		return new AppError(
			"Shopify integration is missing a required scope. Save and verify Shopify settings after approving write_inventory.",
			409,
		);
	}

	if (error instanceof ShopifyIntegrationError || error instanceof Error) {
		return new AppError("Shopify membership product operation failed.", 502);
	}

	return new AppError("Shopify membership product operation failed.", 502);
}

function assertSupportedProductShape(
	product: ShopifyProductDetails,
	expectedProductGid?: string,
	requireDigital = true,
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

	if (requireDigital && variant.requiresShipping !== false) {
		throw new AppError(
			"Shopify membership product variant must not require shipping.",
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
		private readonly shopifyClient: ShopifyProductClient,
		private readonly mutationAudit: ShopifyMutationAuditWriter,
		private readonly cleanupFailureLogger: ShopifyCleanupFailureLogger = silentCleanupFailureLogger,
		private readonly lifecycleService: ShopifyProductLifecycleService = new ShopifyProductLifecycleService(
			shopifyClient,
			mutationAudit,
		),
	) {}

	async createMembershipProduct(
		tenant: TenantContext,
		input: unknown,
	): Promise<MembershipProductSummary> {
		return this.createOffering(tenant, input, {
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
		});
	}

	async createAccompanistOffering(
		tenant: TenantContext,
		input: unknown,
	): Promise<MembershipProductSummary> {
		if (!input || typeof input !== "object") {
			throw new AppError("Accompanist offering is required.", 400);
		}
		let durationDays: number;
		try {
			durationDays = assertValidEntitlementDurationDays(
				(input as { durationDays?: unknown }).durationDays,
			);
		} catch (error) {
			throw new AppError(
				error instanceof Error ? error.message : "Duration is invalid.",
				400,
			);
		}
		return this.createOffering(tenant, input, {
			entitlementClass: ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays,
		});
	}

	async updateAccompanistOffering(
		tenant: TenantContext,
		offeringId: string,
		input: unknown,
	): Promise<MembershipProductSummary> {
		if (!input || typeof input !== "object") {
			throw new AppError("Accompanist offering is required.", 400);
		}
		const validation = validateMembershipProductInput(input);
		if (!validation.valid) throw new AppError(validation.errors.join(" "), 400);
		let durationDays: number;
		try {
			durationDays = assertValidEntitlementDurationDays(
				(input as { durationDays?: unknown }).durationDays,
			);
		} catch (error) {
			throw new AppError(
				error instanceof Error ? error.message : "Duration is invalid.",
				400,
			);
		}
		const offering = await this.repository.findMembershipProductRecordByClass(
			tenant.organization.id,
			ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
		);
		if (!offering || offering.id !== offeringId) {
			throw new AppError("Accompanist offering was not found.", 404);
		}
		const writeContext = await this.loadOperationContext(
			tenant,
			"write_products",
		);
		await this.loadOperationContext(tenant, "write_inventory");
		const readContext = await this.loadOperationContext(
			tenant,
			"read_products",
		);
		try {
			await this.lifecycleService.updateProductDetails(writeContext, {
				productId: offering.shopifyProductGid,
				name: validation.input.name,
				description: validation.input.description,
			});
			await this.lifecycleService.updateVariantPrice(writeContext, {
				productId: offering.shopifyProductGid,
				variantId: offering.shopifyVariantGid,
				price: validation.input.price,
			});
			await this.setInventoryItemShipping(
				writeContext,
				readContext,
				offering.shopifyVariantGid,
				offering.shopifyProductGid,
			);
			const { value: confirmed } = await this.shopifyClient.readProductsByGid(
				readContext,
				[offering.shopifyProductGid],
			);
			const product = confirmed[0];
			if (!product)
				throw new AppError("Shopify membership product was not found.", 502);
			const variant = assertSupportedProductShape(
				product,
				offering.shopifyProductGid,
			);
			if (variant.id !== offering.shopifyVariantGid)
				throw new AppError(
					"Shopify membership product variant did not match the local association.",
					502,
				);
			const updated = await this.repository.updateMembershipProductRecord({
				organizationId: tenant.organization.id,
				productId: offering.id,
				productNameSnapshot: product.title,
				durationDays,
			});
			if (!updated)
				throw new AppError("Accompanist offering was not found.", 404);
			return toSummary(updated, product, variant);
		} catch (error) {
			throw toAppError(error);
		}
	}

	async resolveActiveFreeAccompanistOffering(
		organizationId: string,
	): Promise<ProductRecord> {
		const offering = await this.repository.findMembershipProductRecordByClass(
			organizationId,
			ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
		);
		if (!offering?.isActive)
			throw new AppError("Accompanist offering is unavailable.", 409);
		const integration =
			await this.repository.getShopifyIntegration(organizationId);
		this.assertVerifiedIntegration(integration, "read_products");
		const context: ShopifyAdminOperationContext = {
			organizationId,
			firebaseActorUid: "accompanist-form",
			verifiedShopGid: integration.verifiedShopGid,
			verifiedShopDomain: integration.verifiedShopDomain,
			integrationVersion: integration.integrationVersion,
			grantedScopes: [...integration.grantedScopes],
			capability: "read_products",
			credentials: {
				organizationId,
				storeDomain: integration.storeDomain,
				clientId: integration.clientId,
				clientSecret: this.secretKeyring.decrypt(
					integration.encryptedClientSecret,
					{ organizationId, purpose: SHOPIFY_CLIENT_SECRET_PURPOSE },
				),
				integrationVersion: integration.integrationVersion,
			},
		};
		try {
			const { value } = await this.shopifyClient.readProductsByGid(context, [
				offering.shopifyProductGid,
			]);
			const product = value[0];
			if (!product)
				throw new AppError("Accompanist offering is unavailable.", 409);
			const variant = assertSupportedProductShape(
				product,
				offering.shopifyProductGid,
			);
			if (
				variant.id !== offering.shopifyVariantGid ||
				!/^0(?:\.0{1,2})?$/.test(variant.price.amount)
			) {
				throw new AppError(
					"Accompanist offering is not available for free acquisition.",
					409,
				);
			}
			return offering;
		} catch (error) {
			throw toAppError(error);
		}
	}

	private async createOffering(
		tenant: TenantContext,
		input: unknown,
		options: { entitlementClass: EntitlementClass; durationDays: number },
	): Promise<MembershipProductSummary> {
		const validation = validateMembershipProductInput(input);
		if (!validation.valid) {
			throw new AppError(validation.errors.join(" "), 400);
		}

		const existingOffering =
			await this.repository.findMembershipProductRecordByClass(
				tenant.organization.id,
				options.entitlementClass,
			);
		if (existingOffering) {
			throw new AppError(
				"An active Teacher Membership already exists for this organization.",
				409,
			);
		}
		const integration = await this.repository.getShopifyIntegration(
			tenant.organization.id,
		);
		this.assertPublicationScopes(integration);

		const writeContext = await this.loadOperationContext(
			tenant,
			"write_products",
		);
		await this.loadOperationContext(tenant, "write_inventory");
		const readContext = await this.loadOperationContext(
			tenant,
			"read_products",
		);
		let createdProductGid: string | null = null;

		try {
			const { productGid, variantGid } =
				await this.lifecycleService.createAndPublishDigitalProduct(
					writeContext,
					{
						name: validation.input.name,
						description: validation.input.description,
						price: validation.input.price,
					},
				);
			createdProductGid = productGid;

			const { value: confirmedProducts } =
				await this.shopifyClient.readProductsByGid(readContext, [productGid]);
			const [confirmedProduct] = confirmedProducts;
			if (!confirmedProduct) {
				throw new AppError("Shopify membership product was not found.", 502);
			}
			const variant = assertSupportedProductShape(confirmedProduct, productGid);
			if (variant.id !== variantGid) {
				throw new AppError(
					"Shopify membership product variant did not match the local association.",
					502,
				);
			}

			const record = await this.repository.createMembershipProductRecord({
				organizationId: tenant.organization.id,
				entitlementClass: options.entitlementClass,
				durationDays: options.durationDays,
				isActive: true,
				shopifyProductGid: confirmedProduct.id,
				shopifyVariantGid: variant.id,
				productNameSnapshot: confirmedProduct.title,
			});

			return toSummary(record, confirmedProduct, variant);
		} catch (error) {
			if (createdProductGid) {
				await this.tryCleanupProduct(writeContext, createdProductGid);
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

	async retireMembershipOffering(
		tenant: TenantContext,
		offeringId: string,
	): Promise<void> {
		const offerings = await this.repository.listMembershipProductRecords(
			tenant.organization.id,
		);
		const offering = offerings.find((candidate) => candidate.id === offeringId);
		if (!offering)
			throw new AppError("Membership offering was not found.", 404);
		if (!offering.isActive) return;

		const retired = await this.repository.updateMembershipProductRecord({
			organizationId: tenant.organization.id,
			productId: offering.id,
			isActive: false,
		});
		if (!retired) throw new AppError("Membership offering was not found.", 404);
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

	private async setInventoryItemShipping(
		context: ShopifyAdminOperationContext,
		readContext: ShopifyAdminOperationContext,
		variantId: string,
		productId: string,
	): Promise<void> {
		const { value: products } = await this.shopifyClient.readProductsByGid(
			readContext,
			[productId],
		);
		const product = products[0];
		if (!product) {
			throw new AppError("Shopify membership product was not found.", 502);
		}
		const variant = assertSupportedProductShape(product, productId, false);
		if (variant.id !== variantId || !variant.inventoryItemId) {
			throw new AppError(
				"Shopify membership product inventory item was not found.",
				502,
			);
		}
		const updated = await this.attemptMutation(
			context,
			"inventoryItemUpdate",
			() =>
				this.shopifyClient.updateInventoryItem(context, {
					inventoryItemId: variant.inventoryItemId ?? "",
					requiresShipping: false,
				}),
		);
		if (updated.requiresShipping) {
			throw new AppError(
				"Shopify membership product variant must not require shipping.",
				502,
			);
		}
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
				capability === "write_inventory"
					? "Shopify integration does not grant write_inventory. Save and verify Shopify settings after approving the scope."
					: "Shopify integration does not grant the required capability.",
				409,
			);
		}
	}

	private assertPublicationScopes(
		integration: ShopifyIntegrationRecord | null,
	): void {
		this.assertVerifiedIntegration(integration, "write_products");
		const scopes = new Set(
			normalizeEffectiveShopifyScopes(integration?.grantedScopes ?? []),
		);
		if (!scopes.has("read_publications") || !scopes.has("write_publications")) {
			throw new AppError(
				"Shopify integration must grant write_publications, which includes read_publications, to publish membership products to Headless. Save and verify Shopify settings after approving this scope.",
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
		await this.lifecycleService.tryCleanupProduct(
			context,
			productGid,
			(error) => {
				this.cleanupFailureLogger.error(
					"Shopify membership product cleanup failed after local persistence failure.",
					{
						operation: "shopify.membershipProduct.cleanup",
						errorName: error instanceof Error ? error.name : undefined,
					},
				);
			},
		);
	}
}
