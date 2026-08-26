import type { ShopifyIntegrationDiagnosticsResponse } from "@festival/common";
import type { TenantContext } from "../auth/tenant-context.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { ShopifyPublicStorefrontDiagnosticClient } from "./shopify-public-catalog-client.js";

const PASSED_MESSAGE = "Public Storefront access is available.";
const LOCKED_MESSAGE =
	"Shopify's Online Store channel is locked. Public membership browsing is unavailable until the storefront is publicly accessible.";

export class ShopifyIntegrationDiagnosticService {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly client: ShopifyPublicStorefrontDiagnosticClient,
	) {}

	async runForTenant(
		tenant: TenantContext,
	): Promise<ShopifyIntegrationDiagnosticsResponse> {
		const domain = await this.repository.getPublicShopifyCatalogDomain(
			tenant.organization.id,
		);
		if (!domain) {
			throw new AppError("Shopify integration has not been verified.", 409);
		}

		try {
			const result = await this.client.diagnosePublicStorefrontAccess(domain);
			return {
				checks: [
					{
						id: "public_storefront_access",
						status: result === "passed" ? "passed" : "failed",
						message: result === "passed" ? PASSED_MESSAGE : LOCKED_MESSAGE,
					},
				],
			};
		} catch {
			throw new AppError(
				"Shopify diagnostics are temporarily unavailable.",
				503,
			);
		}
	}
}
