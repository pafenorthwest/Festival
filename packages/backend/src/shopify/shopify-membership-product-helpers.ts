import type {
	CreateMembershipProductInput,
	MembershipProductSummary,
	ShopifyAdminCapability,
} from "@festival/common";
import {
	normalizeEffectiveShopifyScopes,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	validateMembershipProductInput,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type {
	ProductRecord,
	ShopifyIntegrationRecord,
} from "../repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "./encryption.js";
import { ShopifyIntegrationError, ShopifyScopeError } from "./errors.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyProductDetails,
	ShopifyProductVariant,
} from "./types.js";

const FIXED_OPTION_NAME = "Plan";
const FIXED_OPTION_VALUE = "Standard";
const ALLOWED_TEACHER_UPDATE_FIELDS = new Set(["name", "description", "price"]);

export type ValidatedTeacherOfferingUpdateInput =
	CreateMembershipProductInput & {
		readonly descriptionProvided: boolean;
	};

function normalizeProductDescriptionForComparison(
	value: string | undefined,
): string {
	const normalized = (value ?? "").replace(/\r\n/g, "\n").trim();
	const match = /^<p>([^<>]*)<\/p>$/is.exec(normalized);
	return match ? match[1].trim() : normalized;
}

export function isValidPrice(value: string): boolean {
	return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value);
}

export function toAppError(error: unknown): AppError {
	if (error instanceof AppError) {
		return error;
	}
	if (error instanceof ShopifyScopeError) {
		return new AppError(
			`${error.message} Save and verify Shopify settings after approving the required scope.`,
			409,
		);
	}
	if (error instanceof ShopifyIntegrationError || error instanceof Error) {
		return new AppError("Shopify membership product operation failed.", 502);
	}
	return new AppError("Shopify membership product operation failed.", 502);
}

export function toManualReconciliationError(
	offering: ProductRecord,
	cause?: unknown,
): AppError {
	const error = new AppError(
		"Shopify membership product was updated, but Festival could not confirm or persist the refreshed offering. Manual reconciliation is required.",
		502,
		"manual_reconciliation_required",
		{
			reconciliationRequired: true,
			offeringId: offering.id,
			organizationId: offering.organizationId,
			shopifyProductGid: offering.shopifyProductGid,
			shopifyVariantGid: offering.shopifyVariantGid,
		},
	);
	if (cause !== undefined) {
		error.cause = cause;
	}
	return error;
}

export function assertSupportedProductShape(
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

export function toSummary(
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

export function validateTeacherOfferingUpdateInput(
	input: unknown,
): ValidatedTeacherOfferingUpdateInput {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new AppError("Membership product is required.", 400);
	}
	const extraFields = Object.keys(input).filter(
		(field) => !ALLOWED_TEACHER_UPDATE_FIELDS.has(field),
	);
	if (extraFields.length > 0) {
		throw new AppError(
			`Membership product request cannot include browser-controlled fields: ${extraFields.join(", ")}.`,
			400,
		);
	}
	const descriptionProvided =
		typeof input === "object" &&
		input !== null &&
		"description" in input &&
		(input as Record<string, unknown>).description !== undefined;
	const validation = validateMembershipProductInput(input);
	if (!validation.valid) {
		throw new AppError(validation.errors.join(" "), 400);
	}
	return {
		...validation.input,
		descriptionProvided,
	};
}

export function resolveEditableTeacherOffering(
	offerings: readonly ProductRecord[],
	offeringId: string,
): ProductRecord {
	const offering = offerings.find(
		(candidate) =>
			candidate.id === offeringId &&
			candidate.entitlementClass === TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	);
	if (!offering) {
		throw new AppError("Teacher membership offering was not found.", 404);
	}
	if (!offering.isActive) {
		throw new AppError(
			"Retired Teacher membership offerings cannot be edited.",
			409,
		);
	}
	return offering;
}

export function assertConfirmedTeacherProductUpdate(
	product: ShopifyProductDetails | undefined,
	offering: ProductRecord,
	expected: CreateMembershipProductInput,
): { product: ShopifyProductDetails; variant: ShopifyProductVariant } {
	if (!product) {
		throw new AppError("Shopify membership product was not found.", 502);
	}
	const variant = assertSupportedProductShape(
		product,
		offering.shopifyProductGid,
	);
	if (variant.id !== offering.shopifyVariantGid) {
		throw new AppError(
			"Shopify membership product variant did not match the local association.",
			502,
		);
	}
	const normalizedReadbackDescription =
		normalizeProductDescriptionForComparison(product.description);
	const normalizedExpectedDescription =
		normalizeProductDescriptionForComparison(expected.description);
	const readbackValidation = validateMembershipProductInput({
		name: product.title,
		description: normalizedReadbackDescription,
		price: variant.price.amount,
	});
	if (
		!readbackValidation.valid ||
		product.status !== "ACTIVE" ||
		product.title !== expected.name ||
		normalizedReadbackDescription !== normalizedExpectedDescription ||
		Number(variant.price.amount) !== Number(expected.price)
	) {
		throw new AppError(
			"Shopify membership product readback did not match the updated values.",
			502,
		);
	}
	return { product, variant };
}

export function assertVerifiedIntegration(
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

export function assertPublicationScopes(
	integration: ShopifyIntegrationRecord | null,
): void {
	assertVerifiedIntegration(integration, "write_products");
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

export function buildOperationContext(
	integration: ShopifyIntegrationRecord | null,
	secretKeyring: ShopifySecretKeyring,
	params: {
		organizationId: string;
		firebaseActorUid: string;
		capability: ShopifyAdminCapability;
	},
): ShopifyAdminOperationContext {
	assertVerifiedIntegration(integration, params.capability);
	return {
		organizationId: params.organizationId,
		firebaseActorUid: params.firebaseActorUid,
		verifiedShopGid: integration.verifiedShopGid,
		verifiedShopDomain: integration.verifiedShopDomain,
		integrationVersion: integration.integrationVersion,
		grantedScopes: [...integration.grantedScopes],
		capability: params.capability,
		credentials: {
			organizationId: params.organizationId,
			storeDomain: integration.storeDomain,
			clientId: integration.clientId,
			clientSecret: secretKeyring.decrypt(integration.encryptedClientSecret, {
				organizationId: params.organizationId,
				purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			}),
			integrationVersion: integration.integrationVersion,
		},
	};
}
