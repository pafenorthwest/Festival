import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../../../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../../../src/commerce/membership-commerce-repository.js";
import { InMemoryCustomerAccountRepository } from "../../../src/customer/in-memory-customer-account-repository.js";
import {
	type CommerceProjectionDomainEvent,
	CommerceProjectionEventBus,
	ReconciliationService,
	ShopifyOrderProjectionService,
	type ShopifyPaidOrder,
} from "../../../src/domains/commerce-projection/index.js";
import { InMemoryOrganizationRepository } from "../../../src/repo/in-memory-organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../../../src/shopify/encryption.js";

const TEST_KEY = Buffer.alloc(32, 5).toString("base64");

function makeKeyring() {
	const kr = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ k1: TEST_KEY }),
		"k1",
	);
	if (!kr) throw new Error("Expected keyring.");
	return kr;
}

describe("commerce-projection order projection and reconciliation services", () => {
	it("emits OrderProjected on newly projected deliveries and delegates reconciliation runs", async () => {
		const orgs = new InMemoryOrganizationRepository();
		const org = await orgs.createOrganization({
			name: "Proj Org",
			slug: "proj-org",
		});
		const div = await orgs.createDivision({
			organizationId: org.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const kr = makeKeyring();
		await orgs.upsertShopifyIntegration({
			organizationId: org.id,
			storeDomain: "proj.myshopify.com",
			clientId: "cid",
			encryptedClientSecret: kr.encrypt("secret", {
				organizationId: org.id,
				purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			}),
		});
		await orgs.updateShopifyVerification({
			organizationId: org.id,
			verificationStatus: "ok",
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "proj.myshopify.com",
			grantedScopes: ["read_orders"],
			capabilities: {
				read_products: "missing",
				write_products: "missing",
				write_inventory: "missing",
				read_orders: "granted",
				write_orders: "disabled",
			},
			verifiedAtIso: "2026-09-01T00:00:00.000Z",
			lastTestedAtIso: "2026-09-01T00:00:00.000Z",
		});

		const checkout = new InMemoryCheckoutRepository();
		const customers = new InMemoryCustomerAccountRepository();
		const commerce = new InMemoryMembershipCommerceRepository(orgs, checkout);
		const { customer } = await customers.createCustomerSession({
			sessionId: "sess-1",
			organizationId: org.id,
			shopifyCustomerGid: "gid://shopify/Customer/77",
			encryptedTokens: "opaque",
			csrfToken: "csrf",
			integrationVersion: 1,
			createdAtIso: "2026-09-01T00:00:00.000Z",
			lastSeenAtIso: "2026-09-01T00:00:00.000Z",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});

		const product = await orgs.createMembershipProductRecord({
			organizationId: org.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/tm-1",
			shopifyVariantGid: "gid://shopify/ProductVariant/tm-1",
			productNameSnapshot: "Teacher Membership",
		});
		const intentResult = await checkout.createIntent({
			organizationId: org.id,
			customerId: customer.id,
			sessionId: "sess-1",
			idempotencyKey: "idem-1",
			offeringId: product.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			shopifyProductGid: product.shopifyProductGid,
			shopifyVariantGid: product.shopifyVariantGid,
			divisionId: div.id,
			divisionNameSnapshot: "Piano",
			staffAccessConsent: false,
			amount: "50.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-02T00:00:00.000Z",
		});
		if (intentResult.kind !== "created") {
			throw new Error(`Expected created intent, got ${intentResult.kind}`);
		}

		const paidOrder: ShopifyPaidOrder = {
			id: "gid://shopify/Order/888",
			fullyPaid: true,
			fullyPaidAtIso: "2026-09-01T12:00:00.000Z",
			currencyCode: "USD",
			customerGid: "gid://shopify/Customer/77",
			customerEmail: "teacher@example.com",
			customAttributes: [
				{
					key: "festival_checkout_intent_id",
					value: intentResult.intent.correlationId,
				},
			],
			lineItems: [
				{
					id: "gid://shopify/LineItem/888-1",
					productGid: product.shopifyProductGid,
					variantGid: product.shopifyVariantGid,
					quantity: 1,
					paidAmount: "50.00",
					paidCurrencyCode: "USD",
					customAttributes: [],
				},
			],
		};

		const projectionService = new ShopifyOrderProjectionService(
			orgs,
			checkout,
			commerce,
			{
				readPaidOrderByGid: async (_ctx, orderGid) => ({
					value: orderGid === paidOrder.id ? paidOrder : null,
					requestId: "req-ord-1",
				}),
				listPaidOrdersSince: async () => ({
					value: [paidOrder],
					requestId: "req-list-1",
				}),
				readOrderCustomerProfileByGid: async () => ({ value: null }),
			},
			kr,
			customers,
			() => new Date("2026-09-01T12:01:00.000Z"),
		);

		const bus = new CommerceProjectionEventBus();
		const emitted: CommerceProjectionDomainEvent[] = [];
		bus.subscribe((e) => {
			emitted.push(e);
		});
		projectionService.bindEventBus(bus);

		const rec = new ReconciliationService(commerce, projectionService);
		const summary = await rec.reconcile(org.id);
		expect(summary).toEqual({ discoveredCount: 1, processedCount: 1 });
		expect(emitted).toEqual([
			{
				type: "OrderProjected",
				organizationId: org.id,
				shopifyOrderGid: paidOrder.id,
				customerId: customer.id,
			},
		]);

		// Re-running reconciliation on already processed order does not double-emit OrderProjected
		const secondRun = await rec.reconcile(org.id);
		expect(secondRun).toEqual({ discoveredCount: 0, processedCount: 0 });
		expect(emitted).toHaveLength(1);
		expect(await rec.listReconciliationRuns(org.id, 10)).toHaveLength(2);
	});

	it("throws clear AppError from ReconciliationService when projection target is omitted", () => {
		const orgs = new InMemoryOrganizationRepository();
		const commerce = new InMemoryMembershipCommerceRepository(orgs);
		const rec = new ReconciliationService(commerce);
		expect(() => rec.reconcile("org-1")).toThrow(
			"Shopify order projection service is unavailable.",
		);
	});
});
