import { describe, expect, it } from "bun:test";
import type { OrganizationRecord } from "@festival/common";
import { TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS } from "@festival/common";
import {
	type ProductRecord,
	PublicMembershipProductService,
	type PublicMembershipProductServiceDeps,
} from "../src/domains/teacher-directory/index.js";
import { DomainCacheInvalidator } from "../src/lib/domain-cache-invalidator.js";
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

interface TenantSeed {
	org: OrganizationRecord;
	domain?: string;
	offering?: ProductRecord;
}

function createDeps(
	tenants: TenantSeed[],
	catalog: Catalog,
): PublicMembershipProductServiceDeps {
	return {
		catalog,
		organizations: {
			findOrganizationBySlug: async (slug) =>
				tenants.find((t) => t.org.slug === slug)?.org ?? null,
			getPublicShopifyCatalogDomain: async (organizationId) =>
				tenants.find((t) => t.org.id === organizationId)?.domain ?? null,
			getShopifyIntegration: async () => null,
		},
		products: {
			findMembershipProductRecordByClass: async (organizationId, cls) => {
				const tenant = tenants.find((t) => t.org.id === organizationId);
				if (tenant?.offering?.entitlementClass === cls) {
					return tenant.offering;
				}
				return null;
			},
		},
	};
}

function makeTenant(slug: string, shopNumber: number): TenantSeed {
	return {
		org: {
			id: `org-${shopNumber}`,
			name: `Organization ${shopNumber}`,
			slug,
			timezone: "UTC",
			defaultCurrencyCode: "USD",
			createdAtIso: "2026-01-01T00:00:00.000Z",
		},
		domain: `festival-${shopNumber}.myshopify.com`,
		offering: {
			id: `off-${shopNumber}`,
			organizationId: `org-${shopNumber}`,
			productCategory: "membership",
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: `gid://shopify/Product/${shopNumber}`,
			shopifyVariantGid: `gid://shopify/ProductVariant/${shopNumber}`,
			productNameSnapshot: "Stale local name",
			createdAtIso: "2026-01-01T00:00:00.000Z",
			updatedAtIso: "2026-01-01T00:00:00.000Z",
		},
	};
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
		const catalog = new Catalog();
		const service = new PublicMembershipProductService(
			createDeps(
				[
					{
						org: {
							id: "org-empty",
							name: "Festival",
							slug: "festival",
							timezone: "UTC",
							defaultCurrencyCode: "USD",
							createdAtIso: "2026-01-01T00:00:00.000Z",
						},
					},
				],
				catalog,
			),
		);
		expect(await service.list("festival")).toEqual({
			organization: { slug: "festival", name: "Festival" },
			membershipProducts: [],
		});
		expect(catalog.calls).toBe(0);
	});

	it("rejects unavailable, mismatched, and cross-tenant offering selections and invalidates on MembershipChanged", async () => {
		const first = makeTenant("first", 1);
		const second = makeTenant("second", 2);
		const catalog = new Catalog();
		const invalidator = new DomainCacheInvalidator();
		const service = new PublicMembershipProductService(
			createDeps([first, second], catalog),
		);
		service.bindCacheInvalidator(invalidator);

		const firstOffering = first.offering as ProductRecord;
		const secondOffering = second.offering as ProductRecord;

		catalog.products.set(
			firstOffering.shopifyProductGid,
			publicProduct(
				firstOffering.shopifyProductGid,
				firstOffering.shopifyVariantGid,
				false,
			),
		);
		await expect(
			service.resolvePurchasable("first", firstOffering.id),
		).rejects.toThrow("unavailable");

		catalog.products.set(
			firstOffering.shopifyProductGid,
			publicProduct(
				firstOffering.shopifyProductGid,
				firstOffering.shopifyVariantGid,
				true,
			),
		);
		await expect(
			service.resolvePurchasable("first", secondOffering.id),
		).rejects.toThrow("unavailable");

		await service.list("first");
		const callsAfterWarm = catalog.calls;
		await service.list("first");
		expect(catalog.calls).toBe(callsAfterWarm);

		invalidator.emit({
			type: "MembershipChanged",
			organizationId: first.org.id,
		});

		catalog.products.set(
			firstOffering.shopifyProductGid,
			publicProduct(
				firstOffering.shopifyProductGid,
				secondOffering.shopifyVariantGid,
				true,
			),
		);
		await expect(service.list("first")).rejects.toThrow(
			"temporarily unavailable",
		);
	});
});
