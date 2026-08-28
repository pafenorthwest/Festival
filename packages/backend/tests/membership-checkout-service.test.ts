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
		let cartCreated = 0;
		const service = new MembershipCheckoutService(
			organizations,
			new PublicMembershipProductService(organizations, catalog),
			checkout,
			{
				async createCart(input) {
					cartCreated += 1;
					expect(input.correlationId).toBeTruthy();
					return { shopifyCartId: "gid://shopify/Cart/private" };
				},
				async checkout() {
					expect(cartCreated).toBeGreaterThan(0);
					return {
						checkoutUrl: "https://festival.myshopify.com/checkouts/fresh",
					};
				},
			},
		);
		const input = {
			organizationId: organization.id,
			organizationSlug: organization.slug,
			customerId: "customer",
			sessionId: "session",
			integrationVersion: 1,
			buyerAccessToken: "server-only",
			idempotencyKey: "00000000-0000-4000-8000-000000000001",
			offeringId: offering.id,
		};
		await expect(service.start(input)).resolves.toEqual({
			checkoutUrl: "https://festival.myshopify.com/checkouts/fresh",
		});
		await expect(service.start(input)).resolves.toEqual({
			checkoutUrl: "https://festival.myshopify.com/checkouts/fresh",
		});
		expect(cartCreated).toBe(1);
	});

	it("records a terminal failure and never redirects when cart persistence fails", async () => {
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
		checkout.attachCart = (async () => {
			throw new Error("database unavailable");
		}) as typeof checkout.attachCart;
		let checkoutRequests = 0;
		const service = new MembershipCheckoutService(
			organizations,
			new PublicMembershipProductService(organizations, catalog),
			checkout,
			{
				async createCart() {
					return { shopifyCartId: "gid://shopify/Cart/private" };
				},
				async checkout() {
					checkoutRequests += 1;
					return {
						checkoutUrl: "https://festival.myshopify.com/checkouts/fresh",
					};
				},
			},
		);
		const input = {
			organizationId: organization.id,
			organizationSlug: organization.slug,
			customerId: "customer",
			sessionId: "session",
			integrationVersion: 1,
			buyerAccessToken: "server-only",
			idempotencyKey: "00000000-0000-4000-8000-000000000002",
			offeringId: offering.id,
		};
		await expect(service.start(input)).rejects.toMatchObject({
			code: "checkout_retryable_upstream",
		});
		expect(checkoutRequests).toBe(0);
		await expect(service.start(input)).rejects.toMatchObject({
			code: "checkout_terminal_failure",
		});
	});
});
