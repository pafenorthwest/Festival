import {
	AppError,
	deriveShopifyCapabilities,
	normalizeEffectiveShopifyScopes,
	type SaveShopifyIntegrationResponse,
	SHOPIFY_REQUIRED_SCOPES,
	type ShopifyFailureCategory,
	type ShopifyIntegrationSettings,
	type ShopifyIntegrationSettingsResponse,
	type ShopifyWebhookReadiness,
	validateShopifySettingsInput,
} from "@festival/common";
import {
	type DomainCacheInvalidator,
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
	type ShopifySecretKeyring,
	ShopifyShopOwnershipError,
	type TenantContext,
} from "../../infra/s11-infra.js";
import type { CommerceProjectionEventBus } from "./events.js";
import type {
	CommerceOrganizationPort,
	ShopifyIntegrationPortRecord,
} from "./ports.js";
import { ShopifyIntegrationError } from "./shopify-errors.js";
import type { ShopifyConnectivityTester } from "./shopify-types.js";

export interface ShopifyWebhookSubscriptionReconciler {
	reconcileForTenant(tenant: TenantContext): Promise<ShopifyWebhookReadiness>;
}

interface PreparedShopifySecrets {
	storeDomain: string;
	clientId: string;
	clientSecret: string;
	encryptedClientSecret: string;
	encryptedStorefrontPrivateToken?: string;
}

function toPublicWebhookReadiness(
	record: ShopifyIntegrationPortRecord,
): ShopifyWebhookReadiness {
	switch (record.webhookReadinessStatus) {
		case "checking":
			return {
				status: "checking",
				message: "Paid-order webhook readiness is being checked.",
				checkedAtIso: record.webhookCheckedAtIso,
			};
		case "ready":
			return {
				status: "ready",
				message: "Paid-order webhook subscription is registered.",
				checkedAtIso: record.webhookCheckedAtIso,
			};
		case "failed":
			return {
				status: "failed",
				message:
					record.webhookError ??
					"Paid-order webhook readiness could not be confirmed.",
				checkedAtIso: record.webhookCheckedAtIso,
				failureCategory: record.webhookFailureCategory ?? "upstream",
				...(record.webhookRequestId
					? { requestId: record.webhookRequestId }
					: {}),
			};
		default:
			return {
				status: "unknown",
				message:
					"Paid-order webhook readiness has not been checked for these settings.",
			};
	}
}

function toPublicSettings(
	record: ShopifyIntegrationPortRecord,
): ShopifyIntegrationSettings {
	return {
		storeDomain: record.storeDomain,
		clientId: record.clientId,
		hasClientSecret: true,
		hasStorefrontPrivateToken: Boolean(record.encryptedStorefrontPrivateToken),
		verificationStatus: record.verificationStatus,
		verifiedShopGid: record.verifiedShopGid,
		verifiedShopDomain: record.verifiedShopDomain,
		verifiedScopes: SHOPIFY_REQUIRED_SCOPES.filter((scope) =>
			normalizeEffectiveShopifyScopes(record.grantedScopes).includes(scope),
		),
		capabilities: { ...record.capabilities },
		integrationVersion: record.integrationVersion,
		verifiedAtIso: record.verifiedAtIso,
		lastTestedAtIso: record.lastTestedAtIso,
		lastError: record.lastError,
		lastFailureCategory: record.lastFailureCategory,
		ordersPaidWebhook: toPublicWebhookReadiness(record),
		updatedAtIso: record.updatedAtIso,
	};
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
	private cacheInvalidator?: DomainCacheInvalidator;
	private eventBus?: CommerceProjectionEventBus;

	constructor(
		private readonly repository: Pick<
			CommerceOrganizationPort,
			| "getShopifyIntegration"
			| "upsertShopifyIntegration"
			| "updateShopifyVerification"
		>,
		private readonly secretKeyring: ShopifySecretKeyring,
		private readonly connectivityTester: ShopifyConnectivityTester,
		private readonly webhookSubscriptions?: ShopifyWebhookSubscriptionReconciler,
	) {}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.cacheInvalidator = invalidator;
	}

	bindEventBus(eventBus: CommerceProjectionEventBus): void {
		this.eventBus = eventBus;
	}

	async getSettingsForTenant(
		tenant: TenantContext,
	): Promise<ShopifyIntegrationSettingsResponse> {
		const record = await this.repository.getShopifyIntegration(
			tenant.organization.id,
		);
		return { settings: record ? toPublicSettings(record) : null };
	}

	async saveAndTestForTenant(
		tenant: TenantContext,
		input: unknown,
	): Promise<SaveShopifyIntegrationResponse> {
		const existing = await this.repository.getShopifyIntegration(
			tenant.organization.id,
		);
		const prepared = this.prepareSecrets(
			tenant.organization.id,
			input,
			existing,
		);
		const saved = await this.upsertIntegration(tenant, prepared, existing);
		this.emitSecretRotated(tenant, saved.integrationVersion);

		const verification = await this.verifyIntegration(
			tenant,
			prepared,
			saved.integrationVersion,
		);
		if (!verification.ok) {
			return {
				settings: toPublicSettings(verification.record),
				ordersPaidWebhook: toPublicWebhookReadiness(verification.record),
			};
		}
		const ordersPaidWebhook = this.webhookSubscriptions
			? await this.webhookSubscriptions.reconcileForTenant(tenant)
			: toPublicWebhookReadiness(verification.record);
		const current =
			(await this.repository.getShopifyIntegration(tenant.organization.id)) ??
			verification.record;
		return {
			settings: toPublicSettings(current),
			ordersPaidWebhook,
		};
	}

	private emitSecretRotated(
		tenant: TenantContext,
		integrationVersion: number,
	): void {
		this.cacheInvalidator?.emit({
			type: "ShopifySecretRotated",
			organizationId: tenant.organization.id,
			slug: tenant.organization.slug,
			integrationVersion,
		});
		void this.eventBus?.emit({
			type: "ShopifySecretRotated",
			organizationId: tenant.organization.id,
			slug: tenant.organization.slug,
			integrationVersion,
		});
	}

	private prepareSecrets(
		organizationId: string,
		input: unknown,
		existing: ShopifyIntegrationPortRecord | null,
	): PreparedShopifySecrets {
		const candidate =
			input && typeof input === "object"
				? (input as {
						clientSecret?: unknown;
						storefrontPrivateToken?: unknown;
					})
				: {};
		const secretProvided =
			typeof candidate.clientSecret === "string" &&
			Boolean(candidate.clientSecret.trim());
		const validation = validateShopifySettingsInput(input, {
			requireClientSecret: !existing && !secretProvided,
		});
		if (!validation.valid) {
			throw new AppError(validation.errors.join(" "), 400);
		}
		const clientSecret = this.resolveClientSecret(
			organizationId,
			secretProvided ? validation.clientSecret : undefined,
			existing,
		);
		const encryptedClientSecret = secretProvided
			? this.secretKeyring.encrypt(clientSecret, {
					organizationId,
					purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
				})
			: existing?.encryptedClientSecret;
		if (!encryptedClientSecret) {
			throw new AppError("Shopify client secret is required.", 400);
		}
		const tokenProvided =
			typeof candidate.storefrontPrivateToken === "string" &&
			Boolean(candidate.storefrontPrivateToken.trim());
		const encryptedStorefrontPrivateToken = tokenProvided
			? this.secretKeyring.encrypt(validation.storefrontPrivateToken ?? "", {
					organizationId,
					purpose: SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
				})
			: existing?.encryptedStorefrontPrivateToken;
		return {
			storeDomain: validation.storeDomain,
			clientId: validation.clientId,
			clientSecret,
			encryptedClientSecret,
			encryptedStorefrontPrivateToken,
		};
	}

	private resolveClientSecret(
		organizationId: string,
		providedSecret: string | undefined,
		existing: ShopifyIntegrationPortRecord | null,
	): string {
		const secret =
			providedSecret ??
			(existing
				? this.secretKeyring.decrypt(existing.encryptedClientSecret, {
						organizationId,
						purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
					})
				: undefined);
		if (!secret) {
			throw new AppError("Shopify client secret is required.", 400);
		}
		return secret;
	}

	private async upsertIntegration(
		tenant: TenantContext,
		prepared: PreparedShopifySecrets,
		existing: ShopifyIntegrationPortRecord | null,
	): Promise<ShopifyIntegrationPortRecord> {
		try {
			const saved = await this.repository.upsertShopifyIntegration({
				organizationId: tenant.organization.id,
				storeDomain: prepared.storeDomain,
				clientId: prepared.clientId,
				encryptedClientSecret: prepared.encryptedClientSecret,
				encryptedStorefrontPrivateToken:
					prepared.encryptedStorefrontPrivateToken,
			});
			if (existing) {
				this.connectivityTester.invalidateIntegration?.(
					tenant.organization.id,
					existing.integrationVersion,
				);
			}
			return saved;
		} catch (error) {
			if (error instanceof ShopifyShopOwnershipError) {
				throw new AppError(error.message, 409);
			}
			throw error;
		}
	}

	private async verifyIntegration(
		tenant: TenantContext,
		prepared: PreparedShopifySecrets,
		integrationVersion: number,
	): Promise<{ ok: boolean; record: ShopifyIntegrationPortRecord }> {
		const lastTestedAtIso = new Date().toISOString();
		try {
			const result = await this.connectivityTester.testCredentials({
				organizationId: tenant.organization.id,
				storeDomain: prepared.storeDomain,
				clientId: prepared.clientId,
				clientSecret: prepared.clientSecret,
				integrationVersion,
			});
			const verified = await this.repository.updateShopifyVerification({
				organizationId: tenant.organization.id,
				verificationStatus: "ok",
				verifiedAtIso: lastTestedAtIso,
				lastTestedAtIso,
				verifiedShopGid: result.shopGid,
				verifiedShopDomain: result.shopDomain,
				grantedScopes: result.grantedScopes,
				capabilities: deriveShopifyCapabilities(result.grantedScopes),
			});
			this.emitSecretRotated(tenant, verified.integrationVersion);
			return { ok: true, record: verified };
		} catch (error) {
			const failed = await this.repository.updateShopifyVerification({
				organizationId: tenant.organization.id,
				verificationStatus: "failed",
				lastTestedAtIso,
				lastError: "Shopify verification failed.",
				lastFailureCategory: failureCategory(error),
			});
			this.emitSecretRotated(tenant, failed.integrationVersion);
			return { ok: false, record: failed };
		}
	}
}
