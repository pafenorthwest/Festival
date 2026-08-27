import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { MembershipCheckoutService } from "../src/checkout/membership-checkout-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";
import type { ShopifyPublicCatalogClient } from "../src/shopify/shopify-public-catalog-client.js";

describe("membership checkout service", () => {
	it("revalidates one local offering and records its intent before requesting checkout", async () => {
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		await organizations.upsertShopifyIntegration({
			organizationId: organization.id,
			storeDomain: "festival.myshopify.com",
			clientId: "client",
			encryptedClientSecret: "encrypted",
		});
		await organizations.updateShopifyVerification({
			organizationId: organization.id,
			verificationStatus: "ok",
			verifiedAtIso: new Date().toISOString(),
			lastTestedAtIso: new Date().toISOString(),
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "festival.myshopify.com",
			grantedScopes: ["read_products"],
			capabilities: {
				read_products: "granted",
				write_products: "missing",
				read_orders: "missing",
				write_orders: "disabled",
			},
		});
		const offering = await organizations.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher",
		});
		const catalog: ShopifyPublicCatalogClient = {
			async readProduct() {
				return {
					id: "gid://shopify/Product/1",
					title: "Teacher",
					description: "",
					availableForSale: true,
					variant: {
						id: "gid://shopify/ProductVariant/1",
						availableForSale: true,
						price: { amount: "75.00", currencyCode: "USD" },
					},
				};
			},
		};
		const checkout = new InMemoryCheckoutRepository();
		let cartCreated = false;
		const service = new MembershipCheckoutService(
			organizations,
			new PublicMembershipProductService(organizations, catalog),
			checkout,
			{
				async createCart(input) {
					cartCreated = true;
					expect(input.correlationId).toBeTruthy();
					return { shopifyCartId: "gid://shopify/Cart/private" };
				},
				async checkout() {
					expect(cartCreated).toBeTrue();
					return {
						checkoutUrl: "https://festival.myshopify.com/checkouts/fresh",
					};
				},
			},
		);
		await expect(
			service.start({
				organizationId: organization.id,
				organizationSlug: organization.slug,
				customerId: "customer",
				sessionId: "session",
				integrationVersion: 1,
				buyerAccessToken: "server-only",
				offeringId: offering.id,
			}),
		).resolves.toEqual({
			checkoutUrl: "https://festival.myshopify.com/checkouts/fresh",
		});
	});
});
