import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRecoveryRepository } from "../src/checkout/checkout-recovery-repository.js";
import { CheckoutRecoveryService } from "../src/checkout/checkout-recovery-service.js";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { MembershipCheckoutService } from "../src/checkout/membership-checkout-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";
import type { ShopifyPublicCatalogClient } from "../src/shopify/shopify-public-catalog-client.js";

describe("membership checkout service", () => {
	it("allows independent Customer Account and Shopify versions and reuses the cart", async () => {
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const division = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
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
				write_inventory: "missing",
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
		let checkoutRequests = 0;
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
					checkoutRequests += 1;
					expect(cartCreated).toBeGreaterThan(0);
					return {
						checkoutUrl:
							checkoutRequests > 2
								? "https://festival.myshopify.com:444/checkouts/fresh"
								: "https://festival.myshopify.com/checkouts/fresh",
					};
				},
			},
		);
		const input = {
			organizationId: organization.id,
			organizationSlug: organization.slug,
			customerId: "customer",
			sessionId: "session",
			integrationVersion: 14,
			buyerAccessToken: "server-only",
			idempotencyKey: "00000000-0000-4000-8000-000000000001",
			offeringId: offering.id,
			divisionId: division.id,
			staffAccessConsent: true,
		};
		await expect(service.start(input)).resolves.toEqual({
			checkoutUrl: "https://festival.myshopify.com/checkouts/fresh",
		});
		await expect(service.start(input)).resolves.toEqual({
			checkoutUrl: "https://festival.myshopify.com/checkouts/fresh",
		});
		expect(cartCreated).toBe(1);
		await expect(
			service.start({
				...input,
				idempotencyKey: "00000000-0000-4000-8000-000000000003",
			}),
		).rejects.toMatchObject({ code: "checkout_in_progress" });
	});

	it("records a terminal failure and never redirects when cart persistence fails", async () => {
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const division = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
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
				write_inventory: "missing",
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
			integrationVersion: 14,
			buyerAccessToken: "server-only",
			idempotencyKey: "00000000-0000-4000-8000-000000000002",
			offeringId: offering.id,
			divisionId: division.id,
			staffAccessConsent: true,
		};
		await expect(service.start(input)).rejects.toMatchObject({
			code: "checkout_retryable_upstream",
		});
		expect(checkoutRequests).toBe(0);
		await expect(service.start(input)).rejects.toMatchObject({
			code: "checkout_terminal_failure",
		});
	});
	it("rejects missing consent or division even when an idempotent outcome exists", async () => {
		let reads = 0;
		const service = new MembershipCheckoutService(
			{} as never,
			{} as never,
			{
				getOutcome: async () => {
					reads++;
					return { kind: "ready" };
				},
			} as never,
			{} as never,
		);
		for (const prerequisites of [
			{ divisionId: "division", staffAccessConsent: false },
			{ divisionId: "", staffAccessConsent: true },
		]) {
			await expect(service.start(prerequisites as never)).rejects.toMatchObject(
				{ status: 400 },
			);
		}
		expect(reads).toBe(0);
	});

	it.each([
		"version",
		"domain",
		"customer-version",
		"unsafe-url",
	])("rejects resumed checkout when %s changes", async (change) => {
		let reads = 0;
		let failures = 0;
		const service = new MembershipCheckoutService(
			{
				getShopifyIntegration: async () => ({
					integrationVersion: ++reads > 1 && change === "version" ? 22 : 21,
					storeDomain:
						reads > 1 && change === "domain"
							? "other.myshopify.com"
							: "festival.myshopify.com",
				}),
			} as never,
			{} as never,
			{
				getOutcome: async () => ({
					kind: "ready",
					intent: { id: "intent" },
					cart: { integrationVersion: 14, shopifyCartId: "cart" },
				}),
				markCheckoutStarted: async () => {},
				markFailed: async () => {
					failures++;
				},
			} as never,
			{
				checkout: async () => ({
					checkoutUrl:
						change === "unsafe-url"
							? "https://festival.myshopify.com:444/checkout"
							: "https://festival.myshopify.com/checkout",
				}),
			} as never,
		);
		await expect(
			service.start({
				organizationId: "org",
				integrationVersion: change === "customer-version" ? 15 : 14,
				divisionId: "division",
				staffAccessConsent: true,
			} as never),
		).rejects.toMatchObject({ code: "checkout_retryable_upstream" });
		expect(failures).toBe(1);
	});

	it("enforces the 30-day Teacher Membership renewal window in the Organization timezone before Shopify mutation", async () => {
		let now = new Date("2027-07-14T23:30:00.000Z"); // 2027-07-14 in America/Los_Angeles (31 days before 2027-08-14)
		const organizations = new InMemoryOrganizationRepository(() => now);
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		await organizations.updateOrganizationTimezone(
			organization.id,
			"America/Los_Angeles",
		);
		const piano = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const strings = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Strings",
			normalizedName: "strings",
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
			verifiedAtIso: now.toISOString(),
			lastTestedAtIso: now.toISOString(),
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "festival.myshopify.com",
			grantedScopes: ["read_products"],
			capabilities: {
				read_products: "granted",
				write_products: "missing",
				write_inventory: "missing",
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
			productNameSnapshot: "Teacher Membership",
		});
		await organizations.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: piano.id,
			divisionNameSnapshot: piano.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "prior-intent",
			shopifyOrderGid: "gid://shopify/Order/prior",
			shopifyOrderLineGid: "gid://shopify/LineItem/prior",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			status: "active",
			verifiedIdentityEmail: "teacher1@example.com",
		});
		const catalog: ShopifyPublicCatalogClient = {
			async readProduct() {
				return {
					id: "gid://shopify/Product/1",
					title: "Teacher Membership",
					description: "",
					availableForSale: true,
					variant: {
						id: "gid://shopify/ProductVariant/1",
						availableForSale: true,
						price: { amount: "85.00", currencyCode: "USD" },
					},
				};
			},
		};
		const checkout = new InMemoryCheckoutRepository();
		let cartCreated = 0;
		let checkoutRequests = 0;
		const service = new MembershipCheckoutService(
			organizations,
			new PublicMembershipProductService(organizations, catalog),
			checkout,
			{
				async createCart() {
					cartCreated += 1;
					return { shopifyCartId: "gid://shopify/Cart/renewal" };
				},
				async checkout() {
					checkoutRequests += 1;
					return {
						checkoutUrl: "https://festival.myshopify.com/checkouts/renewal",
					};
				},
			},
			undefined,
			() => now,
		);
		const baseInput = {
			organizationId: organization.id,
			organizationSlug: organization.slug,
			customerId: "customer-1",
			sessionId: "session-1",
			integrationVersion: 14,
			buyerAccessToken: "server-only",
			offeringId: offering.id,
			divisionId: strings.id,
			staffAccessConsent: true,
		};

		await expect(
			service.start({
				...baseInput,
				idempotencyKey: "00000000-0000-4000-8000-000000000010",
			}),
		).rejects.toMatchObject({
			status: 409,
			code: "membership_active",
			message: "Teacher Membership already exists.",
		});
		expect(cartCreated).toBe(0);
		expect(checkoutRequests).toBe(0);
		expect(
			await checkout.hasProcessingIntent(
				organization.id,
				"customer-1",
				now.toISOString(),
			),
		).toBe(false);

		// Exactly 30 days remaining in America/Los_Angeles (2027-07-15) allows renewal checkout
		now = new Date("2027-07-15T15:00:00.000Z");
		await expect(
			service.start({
				...baseInput,
				idempotencyKey: "00000000-0000-4000-8000-000000000011",
			}),
		).resolves.toEqual({
			checkoutUrl: "https://festival.myshopify.com/checkouts/renewal",
		});
		expect(cartCreated).toBe(1);
		expect(checkoutRequests).toBe(1);
	});

	it("enforces the 30-day Teacher Membership renewal window in checkout recovery review and resume", async () => {
		let now = new Date("2027-07-14T23:30:00.000Z"); // 2027-07-14 in America/Los_Angeles (31 days before 2027-08-14)
		const organizations = new InMemoryOrganizationRepository(() => now);
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		await organizations.updateOrganizationTimezone(
			organization.id,
			"America/Los_Angeles",
		);
		const piano = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		await organizations.upsertShopifyIntegration({
			organizationId: organization.id,
			storeDomain: "festival.myshopify.com",
			clientId: "client",
			encryptedClientSecret: "encrypted",
		});
		const offering = await organizations.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});
		await organizations.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: piano.id,
			divisionNameSnapshot: piano.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "prior-intent",
			shopifyOrderGid: "gid://shopify/Order/prior",
			shopifyOrderLineGid: "gid://shopify/LineItem/prior",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			status: "active",
			verifiedIdentityEmail: "teacher1@example.com",
		});

		const checkoutRepo = new InMemoryCheckoutRepository();
		const recoveryRepo = new InMemoryCheckoutRecoveryRepository();
		const created = await checkoutRepo.createIntent({
			organizationId: organization.id,
			customerId: "customer-1",
			sessionId: "sess-source",
			idempotencyKey: "00000000-0000-4000-8000-000000000020",
			intentType: "membership",
			offeringId: offering.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			shopifyProductGid: offering.shopifyProductGid,
			shopifyVariantGid: offering.shopifyVariantGid,
			divisionId: piano.id,
			divisionNameSnapshot: piano.displayName,
			staffAccessConsent: true,
			amount: "85.00",
			currencyCode: "USD",
			expiresAtIso: "2028-01-01T00:00:00.000Z",
		});
		if (created.kind !== "created") throw new Error("expected intent");
		recoveryRepo.addIntent({ ...created.intent, status: "ready" });

		const recoveryService = new CheckoutRecoveryService({
			recoveryRepository: recoveryRepo,
			organizationRepository: organizations,
			checkoutRepository: checkoutRepo,
			storefront: {
				async createCart() {
					return { shopifyCartId: "gid://shopify/Cart/recovery" };
				},
				async checkout() {
					return {
						checkoutUrl: "https://festival.myshopify.com/checkouts/recovered",
					};
				},
			},
			now: () => now,
		});

		const { rawToken } = await recoveryService.createRecovery({
			organizationId: organization.id,
			organizationSlug: organization.slug,
			customerId: "customer-1",
			intentId: created.intent.id,
			actorUid: "admin-1",
			expiresAtIso: "2028-01-01T00:00:00.000Z",
		});

		await expect(
			recoveryService.getRecoveryReviewDto(
				organization.slug,
				rawToken,
				"customer-1",
			),
		).rejects.toMatchObject({
			status: 409,
			code: "membership_active",
			message: "Teacher Membership already exists.",
		});

		await expect(
			recoveryService.resumeCustomerCheckout(
				organization.slug,
				rawToken,
				"customer-1",
				{
					sessionId: "sess-resumed",
					integrationVersion: 1,
					buyerAccessToken: "buyer-token",
				},
			),
		).rejects.toMatchObject({
			status: 409,
			code: "membership_active",
			message: "Teacher Membership already exists.",
		});

		// Move into 30-day renewal window (2027-07-15 in America/Los_Angeles)
		now = new Date("2027-07-15T15:00:00.000Z");
		await expect(
			recoveryService.getRecoveryReviewDto(
				organization.slug,
				rawToken,
				"customer-1",
			),
		).resolves.toMatchObject({
			sourceIntent: { id: created.intent.id },
		});

		await expect(
			recoveryService.resumeCustomerCheckout(
				organization.slug,
				rawToken,
				"customer-1",
				{
					sessionId: "sess-resumed",
					integrationVersion: 1,
					buyerAccessToken: "buyer-token",
				},
			),
		).resolves.toEqual({
			checkoutUrl: "https://festival.myshopify.com/checkouts/recovered",
		});

		// Once a renewal grant exists for the window, a second recovery review and resume must be blocked
		const renewedGrant = await organizations.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: piano.id,
			divisionNameSnapshot: piano.displayName,
			paidAmount: "85.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "scheduled-renewal-intent",
			shopifyOrderGid: "gid://shopify/Order/scheduled-renewal",
			shopifyOrderLineGid: "gid://shopify/LineItem/scheduled-renewal",
			startsOn: "2027-07-15",
			endsOn: "2028-07-14",
			status: "active",
			verifiedIdentityEmail: "teacher1@example.com",
		});
		expect(renewedGrant.endsOn).toBe("2028-08-13");

		const { rawToken: secondToken } = await recoveryService.createRecovery({
			organizationId: organization.id,
			organizationSlug: organization.slug,
			customerId: "customer-1",
			intentId: created.intent.id,
			actorUid: "admin-1",
			expiresAtIso: "2028-01-01T00:00:00.000Z",
		});

		await expect(
			recoveryService.getRecoveryReviewDto(
				organization.slug,
				secondToken,
				"customer-1",
			),
		).rejects.toMatchObject({
			status: 409,
			code: "membership_active",
			message: "Teacher Membership already exists.",
		});

		await expect(
			recoveryService.resumeCustomerCheckout(
				organization.slug,
				secondToken,
				"customer-1",
				{
					sessionId: "sess-resumed-2",
					integrationVersion: 1,
					buyerAccessToken: "buyer-token",
				},
			),
		).rejects.toMatchObject({
			status: 409,
			code: "membership_active",
			message: "Teacher Membership already exists.",
		});
	});
});
