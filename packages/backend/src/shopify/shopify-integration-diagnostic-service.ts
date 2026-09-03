import type { ShopifyIntegrationDiagnosticsResponse } from "@festival/common";
import type { TenantContext } from "../auth/tenant-context.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
	type ShopifySecretKeyring,
} from "./encryption.js";
import type { ShopifyWebhookSubscriptionReconciler } from "./shopify-integration-service.js";
import type { ShopifyPublicStorefrontDiagnosticClient } from "./shopify-public-catalog-client.js";

const PASSED_MESSAGE = "Public Storefront access is available.";
const LOCKED_MESSAGE =
	"Shopify's Online Store channel is locked. Public membership browsing is unavailable until the storefront is publicly accessible.";

export class ShopifyIntegrationDiagnosticService {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly client: ShopifyPublicStorefrontDiagnosticClient,
		private readonly secretKeyring?: ShopifySecretKeyring,
		private readonly webhookSubscriptions?: ShopifyWebhookSubscriptionReconciler,
	) {}

	private async storefrontToken(
		organizationId: string,
	): Promise<string | undefined> {
		if (!this.secretKeyring) return undefined;
		const integration =
			await this.repository.getShopifyIntegration(organizationId);
		if (!integration?.encryptedStorefrontPrivateToken) return undefined;
		return this.secretKeyring.decrypt(
			integration.encryptedStorefrontPrivateToken,
			{
				organizationId,
				purpose: SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
			},
		);
	}

	async runForTenant(
		tenant: TenantContext,
	): Promise<ShopifyIntegrationDiagnosticsResponse> {
		const domain = await this.repository.getPublicShopifyCatalogDomain(
			tenant.organization.id,
		);
		if (!domain) {
			throw new AppError("Shopify integration has not been verified.", 409);
		}

		const webhookCheck = this.webhookSubscriptions
			? (async () => {
					try {
						const result =
							await this.webhookSubscriptions?.reconcileForTenant(tenant);
						if (!result) throw new Error("Webhook diagnostic is unavailable.");
						return {
							id: "orders_paid_webhook" as const,
							status:
								result.status === "ready"
									? ("passed" as const)
									: ("failed" as const),
							message: result.message,
							...(result.failureCategory
								? { failureCategory: result.failureCategory }
								: {}),
							...(result.requestId ? { requestId: result.requestId } : {}),
						};
					} catch {
						return {
							id: "orders_paid_webhook" as const,
							status: "failed" as const,
							message:
								"Paid-order webhook diagnostics are temporarily unavailable.",
							failureCategory: "upstream" as const,
						};
					}
				})()
			: undefined;
		const storefrontCheck = (async () => {
			try {
				const result = await this.client.diagnosePublicStorefrontAccess(
					domain,
					await this.storefrontToken(tenant.organization.id),
				);
				return {
					id: "public_storefront_access" as const,
					status:
						result === "passed" ? ("passed" as const) : ("failed" as const),
					message: result === "passed" ? PASSED_MESSAGE : LOCKED_MESSAGE,
				};
			} catch {
				return {
					id: "public_storefront_access" as const,
					status: "failed" as const,
					message: "Public Storefront diagnostics are temporarily unavailable.",
				};
			}
		})();
		const [webhook, storefront] = await Promise.all([
			webhookCheck,
			storefrontCheck,
		]);
		return { checks: [...(webhook ? [webhook] : []), storefront] };
	}
}
