import type {
	SaveShopifyIntegrationResponse,
	ShopifyIntegrationSettings,
	ShopifyIntegrationSettingsResponse,
} from "@festival/common";
import { validateShopifySettingsInput } from "@festival/common";
import type { TenantContext } from "../auth/tenant-context.js";
import { AppError } from "../errors/app-error.js";
import type {
	OrganizationRepository,
	ShopifyIntegrationRecord,
} from "../repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "./encryption.js";
import type { ShopifyConnectivityTester } from "./types.js";

function toPublicSettings(
	record: ShopifyIntegrationRecord,
): ShopifyIntegrationSettings {
	return {
		storeDomain: record.storeDomain,
		clientId: record.clientId,
		hasClientSecret: true,
		verificationStatus: record.verificationStatus,
		verifiedAtIso: record.verifiedAtIso,
		lastTestedAtIso: record.lastTestedAtIso,
		lastError: record.lastError,
		updatedAtIso: record.updatedAtIso,
	};
}

function publicErrorMessage(_error: unknown): string {
	return "Shopify verification failed.";
}

export class ShopifyIntegrationService {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly secretKeyring: ShopifySecretKeyring,
		private readonly connectivityTester: ShopifyConnectivityTester,
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
				? (input as { clientSecret?: unknown })
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

		await this.repository.upsertShopifyIntegration({
			organizationId: tenant.organization.id,
			storeDomain: validation.storeDomain,
			clientId: validation.clientId,
			encryptedClientSecret,
		});

		const lastTestedAtIso = new Date().toISOString();
		try {
			await this.connectivityTester.testCredentials({
				storeDomain: validation.storeDomain,
				clientId: validation.clientId,
				clientSecret,
			});

			const verified = await this.repository.updateShopifyVerification({
				organizationId: tenant.organization.id,
				verificationStatus: "ok",
				verifiedAtIso: lastTestedAtIso,
				lastTestedAtIso,
			});

			return { settings: toPublicSettings(verified) };
		} catch (error) {
			const failed = await this.repository.updateShopifyVerification({
				organizationId: tenant.organization.id,
				verificationStatus: "failed",
				lastTestedAtIso,
				lastError: publicErrorMessage(error),
			});

			return { settings: toPublicSettings(failed) };
		}
	}
}
