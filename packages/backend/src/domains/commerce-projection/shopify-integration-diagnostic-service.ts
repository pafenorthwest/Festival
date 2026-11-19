import {
	AppError,
	type ShopifyIntegrationDiagnosticsResponse,
} from "@festival/common";
import {
	SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
	type ShopifySecretKeyring,
	type TenantContext,
} from "../../infra/s11-infra.js";
import type { CommerceOrganizationPort } from "./ports.js";
import type { ShopifyWebhookSubscriptionReconciler } from "./shopify-integration-service.js";
import type { ShopifyPublicStorefrontDiagnosticClient } from "./shopify-public-catalog-client.js";

const PASSED_MESSAGE = "Public Storefront access is available.";
const LOCKED_MESSAGE =
	"Shopify's Online Store channel is locked. Public membership browsing is unavailable until the storefront is publicly accessible.";
const PRIVATE_TOKEN_PASSED_MESSAGE =
	"Private Storefront token access is available.";

type DiagnosticCheckResult =
	ShopifyIntegrationDiagnosticsResponse["checks"][number];

export class ShopifyIntegrationDiagnosticService {
	constructor(
		private readonly repository: Pick<
			CommerceOrganizationPort,
			"getPublicShopifyCatalogDomain" | "getShopifyIntegration"
		>,
		private readonly client: ShopifyPublicStorefrontDiagnosticClient,
		private readonly secretKeyring?: ShopifySecretKeyring,
		private readonly webhookSubscriptions?: ShopifyWebhookSubscriptionReconciler,
	) {}

	async runForTenant(
		tenant: TenantContext,
	): Promise<ShopifyIntegrationDiagnosticsResponse> {
		const domain = await this.repository.getPublicShopifyCatalogDomain?.(
			tenant.organization.id,
		);
		if (!domain) {
			throw new AppError("Shopify integration has not been verified.", 409);
		}
		const [webhook, storefront, privateToken] = await Promise.all([
			this.webhookSubscriptions
				? this.runWebhookCheck(tenant)
				: Promise.resolve(undefined),
			this.runPublicStorefrontCheck(domain),
			this.runPrivateTokenCheck(tenant.organization.id, domain),
		]);
		return {
			checks: [...(webhook ? [webhook] : []), storefront, privateToken],
		};
	}

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

	private async runWebhookCheck(
		tenant: TenantContext,
	): Promise<DiagnosticCheckResult> {
		try {
			const result =
				await this.webhookSubscriptions?.reconcileForTenant(tenant);
			if (!result) throw new Error("Webhook diagnostic is unavailable.");
			return {
				id: "orders_paid_webhook",
				status: result.status === "ready" ? "passed" : "failed",
				message: result.message,
				...(result.failureCategory
					? { failureCategory: result.failureCategory }
					: {}),
				...(result.requestId ? { requestId: result.requestId } : {}),
			};
		} catch {
			return {
				id: "orders_paid_webhook",
				status: "failed",
				message: "Paid-order webhook diagnostics are temporarily unavailable.",
				failureCategory: "upstream",
			};
		}
	}

	private async runPublicStorefrontCheck(
		domain: string,
	): Promise<DiagnosticCheckResult> {
		try {
			const result = await this.client.diagnosePublicStorefrontAccess(domain);
			return {
				id: "public_storefront_access",
				status: result === "passed" ? "passed" : "failed",
				message: result === "passed" ? PASSED_MESSAGE : LOCKED_MESSAGE,
			};
		} catch {
			return {
				id: "public_storefront_access",
				status: "failed",
				message: "Public Storefront diagnostics are temporarily unavailable.",
			};
		}
	}

	private async runPrivateTokenCheck(
		organizationId: string,
		domain: string,
	): Promise<DiagnosticCheckResult> {
		try {
			const token = await this.storefrontToken(organizationId);
			if (!token) {
				return {
					id: "private_storefront_token",
					status: "failed",
					message: "No private Storefront token is configured.",
				};
			}
			const result = await this.client.diagnosePublicStorefrontAccess(
				domain,
				token,
			);
			return {
				id: "private_storefront_token",
				status: result === "passed" ? "passed" : "failed",
				message:
					result === "passed" ? PRIVATE_TOKEN_PASSED_MESSAGE : LOCKED_MESSAGE,
			};
		} catch {
			return {
				id: "private_storefront_token",
				status: "failed",
				message:
					"Private Storefront token diagnostics are temporarily unavailable.",
			};
		}
	}
}
