import type {
	SaveShopifyIntegrationResponse,
	ShopifyFailureCategory,
	ShopifyIntegrationSettings,
	ShopifyIntegrationSettingsResponse,
} from "@festival/common";
import {
	deriveShopifyCapabilities,
	validateShopifySettingsInput,
} from "@festival/common";
import type { TenantContext } from "../auth/tenant-context.js";
import { AppError } from "../errors/app-error.js";
import type {
	OrganizationRepository,
	ShopifyIntegrationRecord,
} from "../repo/organization-repository.js";
import { ShopifyShopOwnershipError } from "../repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
	type ShopifySecretKeyring,
} from "./encryption.js";
import { ShopifyIntegrationError } from "./errors.js";
import type { ShopifyConnectivityTester } from "./types.js";

export interface ShopifyWebhookSubscriptionReconciler {
	reconcileForTenant(tenant: TenantContext): Promise<void>;
}

function toPublicSettings(
	record: ShopifyIntegrationRecord,
): ShopifyIntegrationSettings {
	return {
		storeDomain: record.storeDomain,
		clientId: record.clientId,
		hasClientSecret: true,
		hasStorefrontPrivateToken: Boolean(record.encryptedStorefrontPrivateToken),
		verificationStatus: record.verificationStatus,
		verifiedShopGid: record.verifiedShopGid,
		verifiedShopDomain: record.verifiedShopDomain,
		capabilities: { ...record.capabilities },
		integrationVersion: record.integrationVersion,
		verifiedAtIso: record.verifiedAtIso,
		lastTestedAtIso: record.lastTestedAtIso,
		lastError: record.lastError,
		lastFailureCategory: record.lastFailureCategory,
		updatedAtIso: record.updatedAtIso,
	};
}

function publicErrorMessage(_error: unknown): string {
	return "Shopify verification failed.";
}

function failureCategory(error: unknown): ShopifyFailureCategory {
	if (error instanceof ShopifyShopOwnershipError) {
		return "shop_ownership_conflict";
	}
	if (error instanceof ShopifyIntegrationError) {
		return error.failureCategory;
	}
	return "transport";
}

export class ShopifyIntegrationService {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly secretKeyring: ShopifySecretKeyring,
		private readonly connectivityTester: ShopifyConnectivityTester,
		private readonly webhookSubscriptions?: ShopifyWebhookSubscriptionReconciler,
	) {}

	async getSettingsForTenant(
		tenant: TenantContext,
	): Promise<ShopifyIntegrationSettingsResponse> {
		const record = await this.repository.getShopifyIntegration(
			tenant.organization.id,
		);

		return {
			settings: record ? toPublicSettings(record) : null,
		};
	}

	async saveAndTestForTenant(
		tenant: TenantContext,
		input: unknown,
	): Promise<SaveShopifyIntegrationResponse> {
		const existing = await this.repository.getShopifyIntegration(
			tenant.organization.id,
		);
		const candidate =
			input && typeof input === "object"
				? (input as {
						clientSecret?: unknown;
						storefrontPrivateToken?: unknown;
					})
				: {};
		const secretWasProvided =
			typeof candidate.clientSecret === "string" &&
			Boolean(candidate.clientSecret.trim());
		const validation = validateShopifySettingsInput(input, {
			requireClientSecret: !existing && !secretWasProvided,
		});
		if (!validation.valid) {
			throw new AppError(validation.errors.join(" "), 400);
		}

		const clientSecret = secretWasProvided
			? validation.clientSecret
			: existing
				? this.secretKeyring.decrypt(existing.encryptedClientSecret, {
						organizationId: tenant.organization.id,
						purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
					})
				: undefined;
		const storefrontTokenWasProvided =
			typeof candidate.storefrontPrivateToken === "string" &&
			Boolean(candidate.storefrontPrivateToken.trim());
		const storefrontPrivateToken = storefrontTokenWasProvided
			? validation.storefrontPrivateToken
			: existing?.encryptedStorefrontPrivateToken
				? this.secretKeyring.decrypt(existing.encryptedStorefrontPrivateToken, {
						organizationId: tenant.organization.id,
						purpose: SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
					})
				: undefined;
		if (!clientSecret) {
			throw new AppError("Shopify client secret is required.", 400);
		}

		const encryptedClientSecret = secretWasProvided
			? this.secretKeyring.encrypt(clientSecret, {
					organizationId: tenant.organization.id,
					purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
				})
			: existing?.encryptedClientSecret;
		if (!encryptedClientSecret) {
			throw new AppError("Shopify client secret is required.", 400);
		}
		const encryptedStorefrontPrivateToken = storefrontTokenWasProvided
			? this.secretKeyring.encrypt(storefrontPrivateToken ?? "", {
					organizationId: tenant.organization.id,
					purpose: SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
				})
			: existing?.encryptedStorefrontPrivateToken;

		let saved: ShopifyIntegrationRecord;
		try {
			saved = await this.repository.upsertShopifyIntegration({
				organizationId: tenant.organization.id,
				storeDomain: validation.storeDomain,
				clientId: validation.clientId,
				encryptedClientSecret,
				encryptedStorefrontPrivateToken,
			});
		} catch (error) {
			if (error instanceof ShopifyShopOwnershipError) {
				throw new AppError(error.message, 409);
			}
			throw error;
		}
		if (existing) {
			this.connectivityTester.invalidateIntegration?.(
				tenant.organization.id,
				existing.integrationVersion,
			);
		}

		const lastTestedAtIso = new Date().toISOString();
		try {
			const result = await this.connectivityTester.testCredentials({
				organizationId: tenant.organization.id,
				storeDomain: validation.storeDomain,
				clientId: validation.clientId,
				clientSecret,
				integrationVersion: saved.integrationVersion,
			});
			const capabilities = deriveShopifyCapabilities(result.grantedScopes);

			const verified = await this.repository.updateShopifyVerification({
				organizationId: tenant.organization.id,
				verificationStatus: "ok",
				verifiedAtIso: lastTestedAtIso,
				lastTestedAtIso,
				verifiedShopGid: result.shopGid,
				verifiedShopDomain: result.shopDomain,
				grantedScopes: result.grantedScopes,
				capabilities,
			});
			if (this.webhookSubscriptions) {
				await this.webhookSubscriptions.reconcileForTenant(tenant);
			}

			return { settings: toPublicSettings(verified) };
		} catch (error) {
			const failed = await this.repository.updateShopifyVerification({
				organizationId: tenant.organization.id,
				verificationStatus: "failed",
				lastTestedAtIso,
				lastError: publicErrorMessage(error),
				lastFailureCategory: failureCategory(error),
			});

			return { settings: toPublicSettings(failed) };
		}
	}
}
