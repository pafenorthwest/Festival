import { PublicMembershipProductService as DomainPublicMembershipProductService } from "../domains/teacher-directory/index.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { ShopifySecretKeyring } from "./encryption.js";
import type { ShopifyPublicCatalogClient } from "./shopify-public-catalog-client.js";

/**
 * Legacy compatibility facade preserving the Shopify-era constructor signature
 * while delegating to domains/teacher-directory.
 */
export class PublicMembershipProductService extends DomainPublicMembershipProductService {
	constructor(
		repository: OrganizationRepository,
		catalog: ShopifyPublicCatalogClient,
		secretKeyring?: ShopifySecretKeyring,
	) {
		super({
			products: repository,
			organizations: repository,
			catalog,
			secretKeyring,
		});
	}
}
