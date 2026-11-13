import {
	ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
	AppError,
	assertValidEntitlementDurationDays,
	type EntitlementClass,
	type MembershipProductSummary,
	type ShopifyAdminCapability,
	validateMembershipProductInput,
} from "@festival/common";
import type {
	ShopifySecretKeyring,
	TenantContext,
} from "../../infra/s11-infra.js";
import type { CommerceOrganizationPort, ProductPortRecord } from "./ports.js";
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
import type { ShopifyProductLifecycleService } from "./shopify-product-lifecycle-service.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyProductClient,
} from "./shopify-types.js";

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

export type MembershipProductRepoPort = Pick<
	CommerceOrganizationPort,
	| "listMembershipProductRecords"
	| "findMembershipProductRecordByClass"
	| "createMembershipProductRecord"
	| "updateMembershipProductRecord"
	| "getShopifyIntegration"
>;

export interface MembershipProductOperationDeps {
	repository: MembershipProductRepoPort;
	secretKeyring: ShopifySecretKeyring;
	shopifyClient: ShopifyProductClient;
	lifecycleService: ShopifyProductLifecycleService;
	cleanupFailureLogger: ShopifyCleanupFailureLogger;
	emitMembershipChanged: (tenant: TenantContext) => void;
}

export function parseDurationDays(input: unknown): number {
	try {
		return assertValidEntitlementDurationDays(input);
	} catch (error) {
		throw new AppError(
			error instanceof Error ? error.message : "Duration is invalid.",
			400,
		);
	}
}

export async function loadOperationContext(
	deps: MembershipProductOperationDeps,
	tenant: TenantContext,
	capability: ShopifyAdminCapability,
): Promise<ShopifyAdminOperationContext> {
	const integration = await deps.repository.getShopifyIntegration(
		tenant.organization.id,
	);
	return buildOperationContext(integration, deps.secretKeyring, {
		organizationId: tenant.organization.id,
		firebaseActorUid: tenant.identity.uid,
		capability,
	});
}

async function readCurrentProductDescription(
	shopifyClient: ShopifyProductClient,
	readContext: ShopifyAdminOperationContext,
	productGid: string,
): Promise<string> {
	const { value: products } = await shopifyClient.readProductsByGid(
		readContext,
		[productGid],
	);
	const product = products[0];
	if (!product) {
		throw new AppError("Shopify membership product was not found.", 502);
	}
	return product.description ?? "";
}

async function setInventoryItemShipping(
	deps: MembershipProductOperationDeps,
	writeContext: ShopifyAdminOperationContext,
	readContext: ShopifyAdminOperationContext,
	variantId: string,
	productId: string,
): Promise<void> {
	const { value: products } = await deps.shopifyClient.readProductsByGid(
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
	const updated = await deps.lifecycleService.disableInventoryItemShipping(
		writeContext,
		variant.inventoryItemId ?? "",
	);
	if (updated.requiresShipping) {
		throw new AppError(
			"Shopify membership product variant must not require shipping.",
			502,
		);
	}
}

async function cleanupCreatedProduct(
	deps: MembershipProductOperationDeps,
	context: ShopifyAdminOperationContext,
	productGid: string,
): Promise<void> {
	await deps.lifecycleService.tryCleanupProduct(
		context,
		productGid,
		(error) => {
			deps.cleanupFailureLogger.error(
				"Shopify membership product cleanup failed after local persistence failure.",
				{
					operation: "shopify.membershipProduct.cleanup",
					errorName: error instanceof Error ? error.name : undefined,
				},
			);
		},
	);
}

async function confirmProductAndVariant(
	shopifyClient: ShopifyProductClient,
	readContext: ShopifyAdminOperationContext,
	productGid: string,
	expectedVariantGid: string,
) {
	const { value: products } = await shopifyClient.readProductsByGid(
		readContext,
		[productGid],
	);
	const product = products[0];
	if (!product) {
		throw new AppError("Shopify membership product was not found.", 502);
	}
	const variant = assertSupportedProductShape(product, productGid);
	if (variant.id !== expectedVariantGid) {
		throw new AppError(
			"Shopify membership product variant did not match the local association.",
			502,
		);
	}
	return { product, variant };
}

export async function createMembershipOfferingOperation(
	deps: MembershipProductOperationDeps,
	tenant: TenantContext,
	input: unknown,
	options: { entitlementClass: EntitlementClass; durationDays: number },
): Promise<MembershipProductSummary> {
	const validation = validateMembershipProductInput(input);
	if (!validation.valid) throw new AppError(validation.errors.join(" "), 400);
	const existing = await deps.repository.findMembershipProductRecordByClass(
		tenant.organization.id,
		options.entitlementClass,
	);
	if (existing) {
		throw new AppError(
			"An active Teacher Membership already exists for this organization.",
			409,
		);
	}
	const integration = await deps.repository.getShopifyIntegration(
		tenant.organization.id,
	);
	assertPublicationScopes(integration);
	const writeContext = await loadOperationContext(
		deps,
		tenant,
		"write_products",
	);
	await loadOperationContext(deps, tenant, "write_inventory");
	const readContext = await loadOperationContext(deps, tenant, "read_products");
	let createdProductGid: string | null = null;
	try {
		const created = await deps.lifecycleService.createAndPublishDigitalProduct(
			writeContext,
			validation.input,
		);
		createdProductGid = created.productGid;
		const { product, variant } = await confirmProductAndVariant(
			deps.shopifyClient,
			readContext,
			created.productGid,
			created.variantGid,
		);
		const record = await deps.repository.createMembershipProductRecord({
			organizationId: tenant.organization.id,
			entitlementClass: options.entitlementClass,
			durationDays: options.durationDays,
			isActive: true,
			shopifyProductGid: product.id,
			shopifyVariantGid: variant.id,
			productNameSnapshot: product.title,
		});
		deps.emitMembershipChanged(tenant);
		return toSummary(record, product, variant);
	} catch (error) {
		if (createdProductGid) {
			await cleanupCreatedProduct(deps, writeContext, createdProductGid);
		}
		throw toAppError(error);
	}
}

async function applyAndConfirmTeacherUpdate(
	deps: MembershipProductOperationDeps,
	writeContext: ShopifyAdminOperationContext,
	readContext: ShopifyAdminOperationContext,
	offering: ProductPortRecord,
	validated: ReturnType<typeof validateTeacherOfferingUpdateInput>,
	onMutated: () => void,
) {
	const description = validated.descriptionProvided
		? (validated.description ?? "")
		: await readCurrentProductDescription(
				deps.shopifyClient,
				readContext,
				offering.shopifyProductGid,
			);
	await deps.lifecycleService.updateProductDetails(writeContext, {
		productId: offering.shopifyProductGid,
		name: validated.name,
		description,
	});
	onMutated();
	await deps.lifecycleService.updateVariantPrice(writeContext, {
		productId: offering.shopifyProductGid,
		variantId: offering.shopifyVariantGid,
		price: validated.price,
	});
	const { value: confirmedProducts } =
		await deps.shopifyClient.readProductsByGid(readContext, [
			offering.shopifyProductGid,
		]);
	return assertConfirmedTeacherProductUpdate(confirmedProducts[0], offering, {
		...validated,
		description,
	});
}

export async function updateTeacherOfferingOperation(
	deps: MembershipProductOperationDeps,
	tenant: TenantContext,
	offeringId: string,
	input: unknown,
): Promise<MembershipProductSummary> {
	const validated = validateTeacherOfferingUpdateInput(input);
	const offerings = await deps.repository.listMembershipProductRecords(
		tenant.organization.id,
	);
	const offering = resolveEditableTeacherOffering(offerings, offeringId);
	const integration = await deps.repository.getShopifyIntegration(
		tenant.organization.id,
	);
	const writeContext = buildOperationContext(integration, deps.secretKeyring, {
		organizationId: tenant.organization.id,
		firebaseActorUid: tenant.identity.uid,
		capability: "write_products",
	});
	assertVerifiedIntegration(integration, "read_products");
	const readContext: ShopifyAdminOperationContext = {
		...writeContext,
		capability: "read_products",
	};
	let shopifyMutated = false;
	try {
		const { product, variant } = await applyAndConfirmTeacherUpdate(
			deps,
			writeContext,
			readContext,
			offering,
			validated,
			() => {
				shopifyMutated = true;
			},
		);
		const updated = await deps.repository.updateMembershipProductRecord({
			organizationId: tenant.organization.id,
			productId: offering.id,
			productNameSnapshot: product.title,
		});
		if (!updated) {
			throw new AppError("Teacher membership offering was not found.", 502);
		}
		deps.emitMembershipChanged(tenant);
		return toSummary(updated, product, variant);
	} catch (error) {
		if (shopifyMutated) {
			return handleTeacherUpdateReconciliationError(
				deps,
				tenant,
				offering,
				error,
			);
		}
		throw toAppError(error);
	}
}

function handleTeacherUpdateReconciliationError(
	deps: MembershipProductOperationDeps,
	tenant: TenantContext,
	offering: ProductPortRecord,
	error: unknown,
): never {
	deps.emitMembershipChanged(tenant);
	deps.cleanupFailureLogger.error(
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

async function syncAndConfirmAccompanistProduct(
	deps: MembershipProductOperationDeps,
	tenant: TenantContext,
	offering: ProductPortRecord,
	validatedInput: { name: string; description?: string; price: string },
) {
	const writeContext = await loadOperationContext(
		deps,
		tenant,
		"write_products",
	);
	await loadOperationContext(deps, tenant, "write_inventory");
	const readContext = await loadOperationContext(deps, tenant, "read_products");
	await deps.lifecycleService.updateProductDetails(writeContext, {
		productId: offering.shopifyProductGid,
		name: validatedInput.name,
		description: validatedInput.description,
	});
	await deps.lifecycleService.updateVariantPrice(writeContext, {
		productId: offering.shopifyProductGid,
		variantId: offering.shopifyVariantGid,
		price: validatedInput.price,
	});
	await setInventoryItemShipping(
		deps,
		writeContext,
		readContext,
		offering.shopifyVariantGid,
		offering.shopifyProductGid,
	);
	return confirmProductAndVariant(
		deps.shopifyClient,
		readContext,
		offering.shopifyProductGid,
		offering.shopifyVariantGid,
	);
}

export async function updateAccompanistOfferingOperation(
	deps: MembershipProductOperationDeps,
	tenant: TenantContext,
	offeringId: string,
	input: unknown,
): Promise<MembershipProductSummary> {
	if (!input || typeof input !== "object") {
		throw new AppError("Accompanist offering is required.", 400);
	}
	const validation = validateMembershipProductInput(input);
	if (!validation.valid) throw new AppError(validation.errors.join(" "), 400);
	const durationDays = parseDurationDays(
		(input as { durationDays?: unknown }).durationDays,
	);
	const offering = await deps.repository.findMembershipProductRecordByClass(
		tenant.organization.id,
		ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
	);
	if (!offering || offering.id !== offeringId) {
		throw new AppError("Accompanist offering was not found.", 404);
	}
	try {
		const { product, variant } = await syncAndConfirmAccompanistProduct(
			deps,
			tenant,
			offering,
			validation.input,
		);
		const updated = await deps.repository.updateMembershipProductRecord({
			organizationId: tenant.organization.id,
			productId: offering.id,
			productNameSnapshot: product.title,
			durationDays,
		});
		if (!updated)
			throw new AppError("Accompanist offering was not found.", 404);
		deps.emitMembershipChanged(tenant);
		return toSummary(updated, product, variant);
	} catch (error) {
		throw toAppError(error);
	}
}
