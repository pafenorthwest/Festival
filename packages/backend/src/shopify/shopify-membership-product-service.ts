import type {
	MembershipProductSummary,
	ShopifyAdminCapability,
} from "@festival/common";
import {
	ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
	assertValidEntitlementDurationDays,
	type EntitlementClass,
	INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	validateMembershipProductInput,
} from "@festival/common";
import type { TenantContext } from "../auth/tenant-context.js";
import { AppError } from "../errors/app-error.js";
import type { DomainCacheInvalidator } from "../lib/domain-cache-invalidator.js";
import type {
	OrganizationRepository,
	ProductRecord,
} from "../repo/organization-repository.js";
import type { ShopifyMutationAuditWriter } from "./admin-mutation-audit.js";
import type { ShopifySecretKeyring } from "./encryption.js";
import {
	assertConfirmedTeacherProductUpdate,
	assertPublicationScopes,
	assertSupportedProductShape,
	assertVerifiedIntegration,
	buildOperationContext,
	resolveEditableTeacherOffering,
	toAppError,
	toManualReconciliationError,
	toSummary,
	validateTeacherOfferingUpdateInput,
} from "./shopify-membership-product-helpers.js";
import { ShopifyProductLifecycleService } from "./shopify-product-lifecycle-service.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyProductClient,
} from "./types.js";

export interface ShopifyCleanupFailureLogger {
	error(
		message: string,
		context:
			| {
					operation: "shopify.membershipProduct.cleanup";
					errorName?: string;
			  }
			| {
					operation: "shopify.membershipProduct.reconcile";
					offeringId: string;
					organizationId: string;
					shopifyProductGid: string;
					shopifyVariantGid: string;
					errorName?: string;
					errorCode?: string;
			  },
	): void;
}

const silentCleanupFailureLogger: ShopifyCleanupFailureLogger = {
	error() {},
};

export class ShopifyMembershipProductService {
	private cacheInvalidator?: DomainCacheInvalidator;

	constructor(
		private readonly repository: OrganizationRepository,
		private readonly secretKeyring: ShopifySecretKeyring,
		private readonly shopifyClient: ShopifyProductClient,
		mutationAudit: ShopifyMutationAuditWriter,
		private readonly cleanupFailureLogger: ShopifyCleanupFailureLogger = silentCleanupFailureLogger,
		private readonly lifecycleService: ShopifyProductLifecycleService = new ShopifyProductLifecycleService(
			shopifyClient,
			mutationAudit,
		),
	) {}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.cacheInvalidator = invalidator;
	}

	private emitMembershipChanged(tenant: TenantContext): void {
		this.cacheInvalidator?.emit({
			type: "MembershipChanged",
			organizationId: tenant.organization.id,
			slug: tenant.organization.slug,
		});
	}

	async createMembershipProduct(
		tenant: TenantContext,
		input: unknown,
	): Promise<MembershipProductSummary> {
		return this.createOffering(tenant, input, {
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
		});
	}

	async updateMembershipProduct(
		tenant: TenantContext,
		offeringId: string,
		input: unknown,
	): Promise<MembershipProductSummary> {
		const validated = validateTeacherOfferingUpdateInput(input);
		const offerings = await this.repository.listMembershipProductRecords(
			tenant.organization.id,
		);
		const offering = resolveEditableTeacherOffering(offerings, offeringId);
		const integration = await this.repository.getShopifyIntegration(
			tenant.organization.id,
		);
		const writeContext = buildOperationContext(
			integration,
			this.secretKeyring,
			{
				organizationId: tenant.organization.id,
				firebaseActorUid: tenant.identity.uid,
				capability: "write_products",
			},
		);
		assertVerifiedIntegration(integration, "read_products");
		const readContext: ShopifyAdminOperationContext = {
			...writeContext,
			capability: "read_products",
		};
		let shopifyMutated = false;
		try {
			const description = validated.descriptionProvided
				? (validated.description ?? "")
				: await this.readCurrentProductDescription(
						readContext,
						offering.shopifyProductGid,
					);
			await this.lifecycleService.updateProductDetails(writeContext, {
				productId: offering.shopifyProductGid,
				name: validated.name,
				description,
			});
			shopifyMutated = true;
			await this.lifecycleService.updateVariantPrice(writeContext, {
				productId: offering.shopifyProductGid,
				variantId: offering.shopifyVariantGid,
				price: validated.price,
			});
			const { value: confirmedProducts } =
				await this.shopifyClient.readProductsByGid(readContext, [
					offering.shopifyProductGid,
				]);
			const { product, variant } = assertConfirmedTeacherProductUpdate(
				confirmedProducts[0],
				offering,
				{ ...validated, description },
			);
			const updated = await this.repository.updateMembershipProductRecord({
				organizationId: tenant.organization.id,
				productId: offering.id,
				productNameSnapshot: product.title,
			});
			if (!updated) {
				throw new AppError("Teacher membership offering was not found.", 502);
			}
			this.emitMembershipChanged(tenant);
			return toSummary(updated, product, variant);
		} catch (error) {
			if (shopifyMutated) {
				this.emitMembershipChanged(tenant);
				this.cleanupFailureLogger.error(
					"Shopify membership product update requires manual reconciliation.",
					{
						operation: "shopify.membershipProduct.reconcile",
						offeringId: offering.id,
						organizationId: offering.organizationId,
						shopifyProductGid: offering.shopifyProductGid,
						shopifyVariantGid: offering.shopifyVariantGid,
						errorName: error instanceof Error ? error.name : undefined,
						errorCode: error instanceof AppError ? error.code : undefined,
					},
				);
				throw toManualReconciliationError(offering, error);
			}
			throw toAppError(error);
		}
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
			this.emitMembershipChanged(tenant);
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
		const context = buildOperationContext(integration, this.secretKeyring, {
			organizationId,
			firebaseActorUid: "accompanist-form",
			capability: "read_products",
		});
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
		assertPublicationScopes(integration);

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

			this.emitMembershipChanged(tenant);
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
		this.emitMembershipChanged(tenant);
	}

	private async loadOperationContext(
		tenant: TenantContext,
		capability: ShopifyAdminCapability,
	): Promise<ShopifyAdminOperationContext> {
		const organizationId = tenant.organization.id;
		const integration =
			await this.repository.getShopifyIntegration(organizationId);
		return buildOperationContext(integration, this.secretKeyring, {
			organizationId,
			firebaseActorUid: tenant.identity.uid,
			capability,
		});
	}

	private async readCurrentProductDescription(
		readContext: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<string> {
		const { value: existingProducts } =
			await this.shopifyClient.readProductsByGid(readContext, [productGid]);
		const existingProduct = existingProducts[0];
		if (!existingProduct) {
			throw new AppError("Shopify membership product was not found.", 502);
		}
		return existingProduct.description ?? "";
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
		const updated = await this.lifecycleService.disableInventoryItemShipping(
			context,
			variant.inventoryItemId ?? "",
		);
		if (updated.requiresShipping) {
			throw new AppError(
				"Shopify membership product variant must not require shipping.",
				502,
			);
		}
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
