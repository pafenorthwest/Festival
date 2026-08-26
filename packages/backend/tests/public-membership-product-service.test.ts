import { describe, expect, it } from "bun:test";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";
import type {
	PublicShopifyCatalogProduct,
	ShopifyPublicCatalogClient,
} from "../src/shopify/shopify-public-catalog-client.js";

class Catalog implements ShopifyPublicCatalogClient {
	calls = 0;
	products = new Map<string, PublicShopifyCatalogProduct>();
	async readProduct(_domain: string, productGid: string) {
		this.calls += 1;
		return this.products.get(productGid) ?? null;
	}
}

async function addTenant(
	repository: InMemoryOrganizationRepository,
	slug: string,
	shopNumber: number,
) {
	const organization = await repository.createOrganization({
		name: `Organization ${shopNumber}`,
		slug,
	});
	const domain = `festival-${shopNumber}.myshopify.com`;
	await repository.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain: domain,
		clientId: `client-${shopNumber}`,
		encryptedClientSecret: "must-not-be-loaded",
	});
	await repository.updateShopifyVerification({
		organizationId: organization.id,
		verificationStatus: "ok",
		verifiedAtIso: new Date().toISOString(),
		lastTestedAtIso: new Date().toISOString(),
		verifiedShopGid: `gid://shopify/Shop/${shopNumber}`,
		verifiedShopDomain: domain,
		grantedScopes: ["read_products"],
		capabilities: {
			read_products: "granted",
			write_products: "missing",
			read_orders: "missing",
			write_orders: "disabled",
		},
	});
	const productGid = `gid://shopify/Product/${shopNumber}`;
	const variantGid = `gid://shopify/ProductVariant/${shopNumber}`;
	const offering = await repository.createMembershipProductRecord({
		organizationId: organization.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: productGid,
		shopifyVariantGid: variantGid,
		productNameSnapshot: "Stale local name",
	});
	return { organization, offering, productGid, variantGid };
}

function publicProduct(
	productGid: string,
	variantGid: string,
	availableForSale = true,
): PublicShopifyCatalogProduct {
	return {
		id: productGid,
		title: "Current Teacher Membership",
		description: "Current description",
		availableForSale,
		variant: {
			id: variantGid,
			availableForSale,
			price: { amount: "75.00", currencyCode: "USD" },
		},
	};
}

describe("public membership product service", () => {
	it("returns an empty public listing without calling Shopify when no active offering exists", async () => {
		const repository = new InMemoryOrganizationRepository();
		await repository.createOrganization({ name: "Festival", slug: "festival" });
		const catalog = new Catalog();
		const service = new PublicMembershipProductService(repository, catalog);
		expect(await service.list("festival")).toEqual({
			organization: { slug: "festival", name: "Festival" },
			membershipProducts: [],
		});
		expect(catalog.calls).toBe(0);
	});

	it("rejects unavailable, mismatched, and cross-tenant offering selections", async () => {
		const repository = new InMemoryOrganizationRepository();
		const first = await addTenant(repository, "first", 1);
		const second = await addTenant(repository, "second", 2);
		const catalog = new Catalog();
		const service = new PublicMembershipProductService(repository, catalog);

		catalog.products.set(
			first.productGid,
			publicProduct(first.productGid, first.variantGid, false),
		);
		await expect(
			service.resolvePurchasable("first", first.offering.id),
		).rejects.toThrow("unavailable");

		catalog.products.set(
			first.productGid,
			publicProduct(first.productGid, first.variantGid, true),
		);
		await expect(
			service.resolvePurchasable("first", second.offering.id),
		).rejects.toThrow("unavailable");

		catalog.products.set(
			first.productGid,
			publicProduct(first.productGid, second.variantGid, true),
		);
		await expect(service.list("first")).rejects.toThrow(
			"temporarily unavailable",
		);
	});
});
