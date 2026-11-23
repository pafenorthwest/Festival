import {
	ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
	AppError,
	INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
	type MembershipProductSummary,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
} from "@festival/common";
import type {
	DomainCacheInvalidator,
	ShopifySecretKeyring,
	TenantContext,
} from "../../infra/s11-infra.js";
import type { ShopifyMutationAuditWriter } from "./admin-mutation-audit.js";
import type { ProductPortRecord } from "./ports.js";
import {
	assertSupportedProductShape,
	buildOperationContext,
	toAppError,
	toSummary,
} from "./shopify-membership-product-helpers.js";
import {
	createMembershipOfferingOperation,
	loadOperationContext,
	type MembershipProductOperationDeps,
	type MembershipProductRepoPort,
	parseDurationDays,
	type ShopifyCleanupFailureLogger,
	updateAccompanistOfferingOperation,
	updateTeacherOfferingOperation,
} from "./shopify-membership-product-operations.js";
import { ShopifyProductLifecycleService } from "./shopify-product-lifecycle-service.js";
import type { ShopifyProductClient } from "./shopify-types.js";

export type { ShopifyCleanupFailureLogger };

const silentCleanupFailureLogger: ShopifyCleanupFailureLogger = {
	error() {},
};

export class ShopifyMembershipProductService {
	private cacheInvalidator?: DomainCacheInvalidator;
	private readonly deps: MembershipProductOperationDeps;

	constructor(
		private readonly repository: MembershipProductRepoPort,
		private readonly secretKeyring: ShopifySecretKeyring,
		private readonly shopifyClient: ShopifyProductClient,
		mutationAudit: ShopifyMutationAuditWriter,
		cleanupFailureLogger: ShopifyCleanupFailureLogger = silentCleanupFailureLogger,
		lifecycleService: ShopifyProductLifecycleService = new ShopifyProductLifecycleService(
			shopifyClient,
			mutationAudit,
		),
	) {
		this.deps = {
			repository,
			secretKeyring,
			shopifyClient,
			lifecycleService,
			cleanupFailureLogger,
			emitMembershipChanged: (tenant) => this.emitMembershipChanged(tenant),
		};
	}

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
		return createMembershipOfferingOperation(this.deps, tenant, input, {
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS,
		});
	}

	async updateMembershipProduct(
		tenant: TenantContext,
		offeringId: string,
		input: unknown,
	): Promise<MembershipProductSummary> {
		return updateTeacherOfferingOperation(this.deps, tenant, offeringId, input);
	}

	async createAccompanistOffering(
		tenant: TenantContext,
		input: unknown,
	): Promise<MembershipProductSummary> {
		if (!input || typeof input !== "object") {
			throw new AppError("Accompanist offering is required.", 400);
		}
		const durationDays = parseDurationDays(
			(input as { durationDays?: unknown }).durationDays,
		);
		return createMembershipOfferingOperation(this.deps, tenant, input, {
			entitlementClass: ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays,
		});
	}

	async updateAccompanistOffering(
		tenant: TenantContext,
		offeringId: string,
		input: unknown,
	): Promise<MembershipProductSummary> {
		return updateAccompanistOfferingOperation(
			this.deps,
			tenant,
			offeringId,
			input,
		);
	}

	async resolveActiveFreeAccompanistOffering(
		organizationId: string,
	): Promise<ProductPortRecord> {
		const offering = await this.repository.findMembershipProductRecordByClass(
			organizationId,
			ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
		);
		if (!offering?.isActive) {
			throw new AppError("Accompanist offering is unavailable.", 409);
		}
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
			if (!product) {
				throw new AppError("Accompanist offering is unavailable.", 409);
			}
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

	async listMembershipProductsForOrganization(
		tenant: TenantContext,
	): Promise<MembershipProductSummary[]> {
		const records = await this.repository.listMembershipProductRecords(
			tenant.organization.id,
		);
		if (records.length === 0) return [];
		const context = await loadOperationContext(
			this.deps,
			tenant,
			"read_products",
		);
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
}
