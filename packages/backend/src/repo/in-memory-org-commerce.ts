import { randomUUID } from "node:crypto";
import type { OrganizationRecord } from "@festival/common";
import {
	assertValidEntitlementDurationDays,
	EMPTY_SHOPIFY_CAPABILITIES,
	isEntitlementClass,
} from "@festival/common";
import type { InMemoryOrgState } from "./in-memory-org-state.js";
import {
	type CreateMembershipProductRecordInput,
	type ProductRecord,
	type ShopifyIntegrationRecord,
	ShopifyShopOwnershipError,
	type UpdateShopifyVerificationInput,
	type UpdateShopifyWebhookReadinessInput,
	type UpsertShopifyIntegrationInput,
} from "./organization-repository.js";

export function inMemFindOrgByShopDomain(
	state: InMemoryOrgState,
	shopDomain: string,
): OrganizationRecord | null {
	const normalized = shopDomain.toLowerCase();
	const integration = [...state.shopifyIntegrations.values()].find(
		(value) =>
			value.verificationStatus === "ok" &&
			(value.storeDomain === normalized ||
				value.verifiedShopDomain === normalized),
	);
	return integration
		? (state.organizations.get(integration.organizationId) ?? null)
		: null;
}

export function inMemUpsertShopifyIntegration(
	state: InMemoryOrgState,
	input: UpsertShopifyIntegrationInput,
): ShopifyIntegrationRecord {
	const existing = state.shopifyIntegrations.get(input.organizationId);
	if (
		[...state.shopifyIntegrations.values()].some(
			(i) =>
				i.organizationId !== input.organizationId &&
				(i.storeDomain === input.storeDomain ||
					i.verifiedShopDomain === input.storeDomain),
		)
	) {
		throw new ShopifyShopOwnershipError();
	}
	const now = new Date().toISOString();
	const record: ShopifyIntegrationRecord = {
		organizationId: input.organizationId,
		storeDomain: input.storeDomain,
		clientId: input.clientId,
		encryptedClientSecret: input.encryptedClientSecret,
		encryptedStorefrontPrivateToken: input.encryptedStorefrontPrivateToken,
		verificationStatus: "unknown",
		grantedScopes: [],
		capabilities: { ...EMPTY_SHOPIFY_CAPABILITIES },
		integrationVersion: (existing?.integrationVersion ?? 0) + 1,
		webhookReadinessStatus: "unknown",
		createdAtIso: existing?.createdAtIso ?? now,
		updatedAtIso: now,
	};
	state.shopifyIntegrations.set(input.organizationId, record);
	return record;
}

export function inMemUpdateShopifyWebhookReadiness(
	state: InMemoryOrgState,
	input: UpdateShopifyWebhookReadinessInput,
): ShopifyIntegrationRecord {
	const existing = state.shopifyIntegrations.get(input.organizationId);
	if (!existing) throw new Error("Shopify integration not found.");
	const record: ShopifyIntegrationRecord = {
		...existing,
		webhookReadinessStatus: input.status,
		webhookCheckedAtIso: input.checkedAtIso,
		webhookError: input.status === "failed" ? input.message : undefined,
		webhookFailureCategory:
			input.status === "failed" ? input.failureCategory : undefined,
		webhookRequestId: input.status === "failed" ? input.requestId : undefined,
		updatedAtIso: new Date().toISOString(),
	};
	state.shopifyIntegrations.set(input.organizationId, record);
	return record;
}

export function inMemUpdateShopifyVerification(
	state: InMemoryOrgState,
	input: UpdateShopifyVerificationInput,
): ShopifyIntegrationRecord {
	const existing = state.shopifyIntegrations.get(input.organizationId);
	if (!existing) throw new Error("Shopify integration not found.");
	if (
		input.verificationStatus === "ok" &&
		[...state.shopifyIntegrations.values()].some(
			(i) =>
				i.organizationId !== input.organizationId &&
				(i.storeDomain === input.verifiedShopDomain ||
					i.verifiedShopDomain === input.verifiedShopDomain ||
					i.verifiedShopGid === input.verifiedShopGid),
		)
	) {
		throw new ShopifyShopOwnershipError();
	}
	const record: ShopifyIntegrationRecord = {
		...existing,
		verificationStatus: input.verificationStatus,
		verifiedShopGid:
			input.verificationStatus === "ok" ? input.verifiedShopGid : undefined,
		verifiedShopDomain:
			input.verificationStatus === "ok" ? input.verifiedShopDomain : undefined,
		grantedScopes:
			input.verificationStatus === "ok" ? [...input.grantedScopes] : [],
		capabilities:
			input.verificationStatus === "ok"
				? { ...input.capabilities }
				: { ...EMPTY_SHOPIFY_CAPABILITIES },
		verifiedAtIso: input.verifiedAtIso,
		lastTestedAtIso: input.lastTestedAtIso,
		lastError: input.lastError,
		lastFailureCategory: input.lastFailureCategory,
		updatedAtIso: new Date().toISOString(),
	};
	state.shopifyIntegrations.set(input.organizationId, record);
	return record;
}

export function inMemCreateMembershipProductRecord(
	state: InMemoryOrgState,
	input: CreateMembershipProductRecordInput,
): ProductRecord {
	if (!state.organizations.has(input.organizationId)) {
		throw new Error("Organization not found.");
	}
	if (!isEntitlementClass(input.entitlementClass)) {
		throw new Error("Entitlement class is invalid.");
	}
	if (
		[...state.products.values()].some(
			(p) =>
				p.organizationId === input.organizationId &&
				p.productCategory === "membership" &&
				p.entitlementClass === input.entitlementClass &&
				p.isActive &&
				input.isActive,
		)
	) {
		throw new Error("Membership product already exists for this organization.");
	}
	if (
		[...state.products.values()].some(
			(p) => p.shopifyProductGid === input.shopifyProductGid,
		)
	) {
		throw new Error("Shopify product is already associated.");
	}
	if (
		[...state.products.values()].some(
			(p) => p.shopifyVariantGid === input.shopifyVariantGid,
		)
	) {
		throw new Error("Shopify variant is already associated.");
	}
	const now = new Date().toISOString();
	assertValidEntitlementDurationDays(input.durationDays);
	const record: ProductRecord = {
		id: randomUUID(),
		organizationId: input.organizationId,
		productCategory: "membership",
		entitlementClass: input.entitlementClass,
		durationDays: input.durationDays,
		isActive: input.isActive,
		shopifyProductGid: input.shopifyProductGid,
		shopifyVariantGid: input.shopifyVariantGid,
		productNameSnapshot: input.productNameSnapshot,
		createdAtIso: now,
		updatedAtIso: now,
	};
	state.products.set(record.id, record);
	return record;
}

export function inMemUpdateMembershipProductRecord(
	state: InMemoryOrgState,
	input: {
		organizationId: string;
		productId: string;
		productNameSnapshot?: string;
		durationDays?: number;
		isActive?: boolean;
	},
): ProductRecord | null {
	const current = state.products.get(input.productId);
	if (!current || current.organizationId !== input.organizationId) return null;
	if (input.durationDays !== undefined) {
		assertValidEntitlementDurationDays(input.durationDays);
	}
	if (
		input.isActive === true &&
		[...state.products.values()].some(
			(p) =>
				p.id !== current.id &&
				p.organizationId === input.organizationId &&
				p.entitlementClass === current.entitlementClass &&
				p.isActive,
		)
	) {
		throw new Error("Membership product already exists for this organization.");
	}
	const updated: ProductRecord = {
		...current,
		productNameSnapshot:
			input.productNameSnapshot ?? current.productNameSnapshot,
		durationDays: input.durationDays ?? current.durationDays,
		isActive: input.isActive ?? current.isActive,
		updatedAtIso: new Date().toISOString(),
	};
	state.products.set(updated.id, updated);
	return { ...updated };
}
