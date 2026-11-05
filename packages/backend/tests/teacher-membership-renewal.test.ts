import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { MembershipStatusService } from "../src/commerce/membership-status-service.js";
import { ShopifyOrderProjectionService } from "../src/commerce/shopify-order-projection-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";
import type {
	ShopifyPaidOrder,
	ShopifyPaidOrderReader,
} from "../src/shopify/types.js";

const AES_KEY = Buffer.alloc(32, 7).toString("base64");

class FakeOrders implements ShopifyPaidOrderReader {
	readonly values = new Map<string, ShopifyPaidOrder>();
	async readPaidOrderByGid(_context: unknown, orderGid: string) {
		return { value: this.values.get(orderGid) ?? null };
	}
	async listPaidOrdersSince() {
		return { value: [...this.values.values()] };
	}
	async readOrderCustomerProfileByGid() {
		return { value: null };
	}
}

async function setupRenewalFixture(initialNowIso = "2027-07-15T18:00:00.000Z") {
	let now = new Date(initialNowIso);
	const organizations = new InMemoryOrganizationRepository(() => now);
	const organization = await organizations.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	await organizations.updateOrganizationTimezone(
		organization.id,
		"America/Los_Angeles",
	);
	const secrets = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: AES_KEY }),
		"test",
	);
	if (!secrets) throw new Error("Expected keyring.");
	await organizations.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain: "festival.myshopify.com",
		clientId: "app-client",
		encryptedClientSecret: secrets.encrypt("app-secret", {
			organizationId: organization.id,
			purpose: "shopify-client-secret",
		}),
	});
	await organizations.updateShopifyVerification({
		organizationId: organization.id,
		verificationStatus: "ok",
		verifiedAtIso: now.toISOString(),
		lastTestedAtIso: now.toISOString(),
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: "festival.myshopify.com",
		grantedScopes: ["read_orders"],
		capabilities: {
			read_products: "missing",
			write_products: "missing",
			write_inventory: "missing",
			read_orders: "granted",
			write_orders: "disabled",
		},
	});
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
	const offering = await organizations.createMembershipProductRecord({
		organizationId: organization.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		productNameSnapshot: "Teacher Membership",
	});
	const customers = new InMemoryCustomerAccountRepository();
	const { customer } = await customers.createCustomerSession({
		sessionId: "session-1",
		organizationId: organization.id,
		shopifyCustomerGid: "gid://shopify/Customer/1",
		encryptedTokens: "opaque",
		csrfToken: "csrf",
		integrationVersion: 1,
		createdAtIso: now.toISOString(),
		lastSeenAtIso: now.toISOString(),
		expiresAtIso: "2030-01-01T00:00:00.000Z",
	});
	const priorGrant = await organizations.createEntitlementGrantSnapshot({
		organizationId: organization.id,
		customerId: customer.id,
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
		verifiedIdentityEmail: "customer@example.test",
	});
	const checkout = new InMemoryCheckoutRepository();
	const commerce = new InMemoryMembershipCommerceRepository(
		organizations,
		checkout,
		() => now,
	);
	const orders = new FakeOrders();
	const service = new ShopifyOrderProjectionService(
		organizations,
		checkout,
		commerce,
		orders,
		secrets,
		customers,
		() => now,
	);
	const statusService = new MembershipStatusService(
		organizations,
		commerce,
		() => now,
	);
	return {
		organizations,
		organization,
		piano,
		strings,
		offering,
		customer,
		priorGrant,
		checkout,
		commerce,
		orders,
		service,
		statusService,
		setNow(iso: string) {
			now = new Date(iso);
		},
	};
}

describe("Teacher Membership paid renewal order projection (#135)", () => {
	it("creates a new immutable grant from verified fullyPaidAt and marks the prior grant superseded without stacking", async () => {
		const f = await setupRenewalFixture("2027-07-20T18:00:00.000Z");
		const created = await f.checkout.createIntent({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: "session-1",
			idempotencyKey: "renewal-intent-1",
			offeringId: f.offering.id,
			entitlementClass: "teacher_membership",
			durationDays: f.offering.durationDays,
			shopifyProductGid: f.offering.shopifyProductGid,
			shopifyVariantGid: f.offering.shopifyVariantGid,
			policyVersion: "v1",
			divisionId: f.strings.id,
			divisionNameSnapshot: f.strings.displayName,
			staffAccessConsent: false,
			amount: "85.00",
			currencyCode: "USD",
			expiresAtIso: "2027-07-20T18:30:00.000Z",
		});
		if (created.kind !== "created") throw new Error("Expected intent.");

		// Reconciled a day later, but paid on 2027-07-20 in America/Los_Angeles
		f.setNow("2027-07-21T15:00:00.000Z");
		f.orders.values.set("gid://shopify/Order/renewal-1", {
			id: "gid://shopify/Order/renewal-1",
			customerGid: "gid://shopify/Customer/1",
			customerEmail: "customer@example.test",
			fullyPaid: true,
			fullyPaidAtIso: "2027-07-20T18:10:00.000Z",
			currencyCode: "USD",
			customAttributes: [
				{
					key: "festival_checkout_intent_id",
					value: created.intent.correlationId,
				},
			],
			lineItems: [
				{
					id: "gid://shopify/LineItem/renewal-1",
					productGid: f.offering.shopifyProductGid,
					variantGid: f.offering.shopifyVariantGid,
					quantity: 1,
					paidAmount: "85.00",
					paidCurrencyCode: "USD",
					customAttributes: [],
				},
			],
		});
		const recorded = await f.commerce.recordDelivery({
			organizationId: f.organization.id,
			shopDomain: "festival.myshopify.com",
			webhookId: "webhook-renewal-1",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/renewal-1",
			payloadSha256: "a".repeat(64),
			receivedAtIso: "2027-07-21T15:00:00.000Z",
		});
		if (recorded.kind !== "accepted") throw new Error("Expected delivery.");

		expect(await f.service.processDelivery(recorded.delivery.id)).toBe(
			"processed",
		);
		const grants = await f.organizations.listEntitlementGrantSnapshots(
			f.organization.id,
			f.customer.id,
		);
		expect(grants).toHaveLength(2);
		expect(grants[0]).toMatchObject({
			id: f.priorGrant.id,
			divisionId: f.piano.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "75.00",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			supersededOn: "2027-07-20",
			supersededAt: "2027-07-21T15:00:00.000Z",
			supersededByGrantId: grants[1]?.id,
			status: "superseded",
		});
		expect(grants[1]).toMatchObject({
			divisionId: f.strings.id,
			divisionNameSnapshot: "Strings",
			paidAmount: "85.00",
			startsOn: "2027-07-20",
			endsOn: "2028-08-13",
			status: "active",
		});
		expect(
			await f.organizations.findActiveTeacherEntitlementGrant({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				divisionId: f.piano.id,
			}),
		).toBeNull();
		expect(
			await f.organizations.findActiveTeacherEntitlementGrant({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				divisionId: f.strings.id,
			}),
		).toMatchObject({ id: grants[1]?.id, status: "active" });

		const status = await f.statusService.listForCustomer(
			f.organization.id,
			f.customer.id,
		);
		expect(status.memberships).toEqual([
			{
				status: "superseded",
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				divisionName: "Piano",
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				durationDays: 365,
				startsOn: "2026-08-14",
				endsOn: "2027-08-14",
				supersededOn: "2027-07-20",
			},
			{
				status: "active",
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				divisionName: "Strings",
				paidAmount: "85.00",
				paidCurrencyCode: "USD",
				durationDays: 365,
				startsOn: "2027-07-20",
				endsOn: "2028-08-13",
				supersededOn: null,
			},
		]);
	});

	it("rejects a paid order when more than 30 calendar days remain on the current grant at paid time", async () => {
		const f = await setupRenewalFixture("2027-07-14T18:00:00.000Z"); // 31 days before 2027-08-14
		const created = await f.checkout.createIntent({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: "session-1",
			idempotencyKey: "early-renewal-intent",
			offeringId: f.offering.id,
			entitlementClass: "teacher_membership",
			durationDays: f.offering.durationDays,
			shopifyProductGid: f.offering.shopifyProductGid,
			shopifyVariantGid: f.offering.shopifyVariantGid,
			policyVersion: "v1",
			divisionId: f.strings.id,
			divisionNameSnapshot: f.strings.displayName,
			staffAccessConsent: false,
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2027-07-14T18:30:00.000Z",
		});
		if (created.kind !== "created") throw new Error("Expected intent.");

		f.orders.values.set("gid://shopify/Order/early-1", {
			id: "gid://shopify/Order/early-1",
			customerGid: "gid://shopify/Customer/1",
			customerEmail: "customer@example.test",
			fullyPaid: true,
			fullyPaidAtIso: "2027-07-14T18:05:00.000Z",
			currencyCode: "USD",
			customAttributes: [
				{
					key: "festival_checkout_intent_id",
					value: created.intent.correlationId,
				},
			],
			lineItems: [
				{
					id: "gid://shopify/LineItem/early-1",
					productGid: f.offering.shopifyProductGid,
					variantGid: f.offering.shopifyVariantGid,
					quantity: 1,
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					customAttributes: [],
				},
			],
		});
		const recorded = await f.commerce.recordDelivery({
			organizationId: f.organization.id,
			shopDomain: "festival.myshopify.com",
			webhookId: "webhook-early-1",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/early-1",
			payloadSha256: "b".repeat(64),
			receivedAtIso: "2027-07-14T18:05:05.000Z",
		});
		if (recorded.kind !== "accepted") throw new Error("Expected delivery.");

		expect(await f.service.processDelivery(recorded.delivery.id)).toBe(
			"processed",
		);
		const grants = await f.organizations.listEntitlementGrantSnapshots(
			f.organization.id,
			f.customer.id,
		);
		expect(grants).toHaveLength(1);
		expect(grants[0]?.status).toBe("active");
		expect(
			await f.commerce.listCustomerDecisions(f.organization.id, f.customer.id),
		).toMatchObject([{ status: "rejected", reasonCode: "duplicate_purchase" }]);
	});
});
