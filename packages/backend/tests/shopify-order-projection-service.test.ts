import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { ShopifyOrderProjectionService } from "../src/commerce/shopify-order-projection-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";
import type {
	ShopifyOrderCustomerProfile,
	ShopifyPaidOrder,
	ShopifyPaidOrderReader,
} from "../src/shopify/types.js";

const NOW = new Date("2026-09-21T18:00:00.000Z");
const AES_KEY = Buffer.alloc(32, 7).toString("base64");

class Orders implements ShopifyPaidOrderReader {
	readonly reads: string[] = [];
	readonly listed: ShopifyPaidOrder[] = [];
	readonly values = new Map<string, ShopifyPaidOrder>();
	profile: ShopifyOrderCustomerProfile | null = null;
	profileReads = 0;
	profileFailure = false;
	readFailure: Error | undefined;

	async readPaidOrderByGid(_context: unknown, orderGid: string) {
		this.reads.push(orderGid);
		if (this.readFailure) throw this.readFailure;
		return { value: this.values.get(orderGid) ?? null };
	}

	async listPaidOrdersSince(_context: unknown, _sinceIso: string) {
		return { value: [...this.listed] };
	}

	async readOrderCustomerProfileByGid() {
		this.profileReads += 1;
		if (this.profileFailure) throw new Error("Shopify profile read failed.");
		return { value: this.profile };
	}
}

function keyring() {
	const value = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: AES_KEY }),
		"test",
	);
	if (!value) throw new Error("Expected a keyring.");
	return value;
}

async function fixture() {
	const organizations = new InMemoryOrganizationRepository();
	const organization = await organizations.createOrganization({
		name: "Seattle Music Festival",
		slug: "seattle-fest",
	});
	await organizations.updateOrganizationTimezone(
		organization.id,
		"America/Los_Angeles",
	);
	const secrets = keyring();
	await organizations.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain: "seattle-fest.myshopify.com",
		clientId: "app-client",
		encryptedClientSecret: secrets.encrypt("app-secret", {
			organizationId: organization.id,
			purpose: "shopify-client-secret",
		}),
	});
	await organizations.updateShopifyVerification({
		organizationId: organization.id,
		verificationStatus: "ok",
		verifiedAtIso: NOW.toISOString(),
		lastTestedAtIso: NOW.toISOString(),
		verifiedShopGid: "gid://shopify/Shop/10",
		verifiedShopDomain: "seattle-fest.myshopify.com",
		grantedScopes: ["read_orders"],
		capabilities: {
			read_products: "missing",
			write_products: "missing",
			write_inventory: "missing",
			read_orders: "granted",
			write_orders: "disabled",
		},
	});

	const division = await organizations.createDivision({
		organizationId: organization.id,
		displayName: "Strings",
		normalizedName: "strings",
	});

	const festival = await organizations.createFestival({
		id: "fest-2026",
		organizationId: organization.id,
		code: "SEAFEST2026",
		shortName: "SeaFest '26",
		name: "Seattle Spring Festival 2026",
		startDate: "2026-05-01",
		endDate: "2026-05-10",
	});
	await organizations.setPrimaryFestival(organization.id, festival.id);

	const subtype = await organizations.createRegistrationCatalogValue({
		organizationId: organization.id,
		kind: "class_subtype",
		displayName: "Solo Performance",
		normalizedName: "solo-performance",
	});

	const classConfig1 = await organizations.createFestivalClassConfiguration({
		organizationId: organization.id,
		festivalId: festival.id,
		displayName: "Violin Solo - Advanced",
		classSubtypeId: subtype.id,
		divisionId: division.id,
		minimumAge: 8,
		maximumAge: 18,
		price: "50.00",
		maximumPerformancePieces: 2,
		performanceMinutes: 15,
		capacity: 25,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/100",
		shopifyVariantGid: "gid://shopify/ProductVariant/200",
	});

	const classConfig2 = await organizations.createFestivalClassConfiguration({
		organizationId: organization.id,
		festivalId: festival.id,
		displayName: "Violin Solo - Intermediate",
		classSubtypeId: subtype.id,
		divisionId: division.id,
		minimumAge: 8,
		maximumAge: 18,
		price: "40.00",
		maximumPerformancePieces: 2,
		performanceMinutes: 10,
		capacity: 25,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/101",
		shopifyVariantGid: "gid://shopify/ProductVariant/201",
	});

	const customers = new InMemoryCustomerAccountRepository();
	const { customer } = await customers.createCustomerSession({
		sessionId: "parent-session",
		organizationId: organization.id,
		shopifyCustomerGid: "gid://shopify/Customer/500",
		encryptedTokens: "opaque",
		csrfToken: "csrf",
		integrationVersion: 1,
		createdAtIso: NOW.toISOString(),
		lastSeenAtIso: NOW.toISOString(),
		expiresAtIso: "2030-01-01T00:00:00.000Z",
	});

	const child1 = await customers.createChild({
		organizationId: organization.id,
		parentCustomerId: customer.id,
		displayName: "Alice Violinist",
		createdAtIso: NOW.toISOString(),
	});

	const child2 = await customers.createChild({
		organizationId: organization.id,
		parentCustomerId: customer.id,
		displayName: "Bob Violinist",
		createdAtIso: NOW.toISOString(),
	});

	const checkout = new InMemoryCheckoutRepository();
	const commerce = new InMemoryMembershipCommerceRepository(
		organizations,
		checkout,
		() => NOW,
	);
	const orders = new Orders();
	const service = new ShopifyOrderProjectionService(
		organizations,
		checkout,
		commerce,
		orders,
		secrets,
		customers,
		() => NOW,
	);

	return {
		organizations,
		organization,
		division,
		festival,
		classConfig1,
		classConfig2,
		customers,
		customer,
		child1,
		child2,
		checkout,
		commerce,
		orders,
		service,
	};
}

async function delivery(
	commerce: InMemoryMembershipCommerceRepository,
	organizationId: string,
	webhookId: string,
	orderGid = "gid://shopify/Order/1000",
) {
	const recorded = await commerce.recordDelivery({
		organizationId,
		shopDomain: "seattle-fest.myshopify.com",
		webhookId,
		topic: "orders/paid",
		apiVersion: "2026-07",
		shopifyOrderGid: orderGid,
		payloadSha256: "b".repeat(64),
		receivedAtIso: NOW.toISOString(),
	});
	if (recorded.kind !== "accepted") {
		throw new Error("Expected delivery to be accepted.");
	}
	return recorded.delivery;
}

describe("ShopifyOrderProjectionService - Multi-line Class Orders", () => {
	it("projects multi-line class order creating 2 ClassEntitlements linked to checkoutIntentLineIds", async () => {
		const f = await fixture();

		const multiIntent = await f.checkout.createIntent({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: "parent-session",
			idempotencyKey: "multi-class-intent",
			intentType: "class_entry",
			festivalClassId: f.classConfig1.id,
			childId: f.child1.id,
			shopifyProductGid: f.classConfig1.shopifyProductGid,
			shopifyVariantGid: f.classConfig1.shopifyVariantGid,
			amount: "90.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
			lines: [
				{
					lineType: "class_registration",
					lineIndex: 0,
					festivalClassId: f.classConfig1.id,
					childId: f.child1.id,
					shopifyProductGid: f.classConfig1.shopifyProductGid,
					shopifyVariantGid: f.classConfig1.shopifyVariantGid,
					amount: "50.00",
					currencyCode: "USD",
				},
				{
					lineType: "class_registration",
					lineIndex: 1,
					festivalClassId: f.classConfig2.id,
					childId: f.child2.id,
					shopifyProductGid: f.classConfig2.shopifyProductGid,
					shopifyVariantGid: f.classConfig2.shopifyVariantGid,
					amount: "40.00",
					currencyCode: "USD",
				},
			],
		});
		if (multiIntent.kind !== "created") {
			throw new Error("Expected multi-line intent to be created");
		}

		const multiOrder: ShopifyPaidOrder = {
			id: "gid://shopify/Order/2000",
			customerGid: "gid://shopify/Customer/500",
			customerEmail: "parent@example.test",
			fullyPaid: true,
			fullyPaidAtIso: "2026-09-21T17:30:00.000Z",
			currencyCode: "USD",
			customAttributes: [
				{
					key: "festival_checkout_intent_id",
					value: multiIntent.intent.correlationId,
				},
			],
			lineItems: [
				{
					id: "gid://shopify/LineItem/2001",
					productGid: f.classConfig1.shopifyProductGid,
					variantGid: f.classConfig1.shopifyVariantGid,
					quantity: 1,
					paidAmount: "50.00",
					paidCurrencyCode: "USD",
				},
				{
					id: "gid://shopify/LineItem/2002",
					productGid: f.classConfig2.shopifyProductGid,
					variantGid: f.classConfig2.shopifyVariantGid,
					quantity: 1,
					paidAmount: "40.00",
					paidCurrencyCode: "USD",
				},
			],
		};
		f.orders.values.set(multiOrder.id, multiOrder);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-multi-line-success",
			multiOrder.id,
		);
		const originalFinalize = f.commerce.finalizeDecision.bind(f.commerce);
		const finalizations: Parameters<typeof f.commerce.finalizeDecision>[0][] =
			[];
		f.commerce.finalizeDecision = async (input) => {
			finalizations.push(input);
			return originalFinalize(input);
		};

		expect(await f.service.processDelivery(received.id)).toBe("processed");
		expect(finalizations).toHaveLength(1);
		expect(finalizations[0]?.classEntitlements).toHaveLength(2);

		const entitlements = await f.commerce.listClassEntitlements({
			organizationId: f.organization.id,
		});
		expect(entitlements).toHaveLength(2);

		const line0Id = multiIntent.intent.lines?.[0]?.id;
		const line1Id = multiIntent.intent.lines?.[1]?.id;
		expect(line0Id).toBeDefined();
		expect(line1Id).toBeDefined();

		expect(entitlements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					organizationId: f.organization.id,
					festivalId: f.festival.id,
					festivalClassId: f.classConfig1.id,
					childId: f.child1.id,
					shopifyOrderGid: multiOrder.id,
					shopifyOrderLineGid: "gid://shopify/LineItem/2001",
					checkoutIntentLineId: line0Id,
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "confirmed",
				}),
				expect.objectContaining({
					organizationId: f.organization.id,
					festivalId: f.festival.id,
					festivalClassId: f.classConfig2.id,
					childId: f.child2.id,
					shopifyOrderGid: multiOrder.id,
					shopifyOrderLineGid: "gid://shopify/LineItem/2002",
					checkoutIntentLineId: line1Id,
					paidAmountCents: 4000,
					paidCurrencyCode: "USD",
					status: "confirmed",
				}),
			]),
		);
	});

	it("rejects multi-line order on line count mismatch", async () => {
		const f = await fixture();

		const multiIntent = await f.checkout.createIntent({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: "parent-session",
			idempotencyKey: "multi-class-line-mismatch",
			intentType: "class_entry",
			festivalClassId: f.classConfig1.id,
			childId: f.child1.id,
			shopifyProductGid: f.classConfig1.shopifyProductGid,
			shopifyVariantGid: f.classConfig1.shopifyVariantGid,
			amount: "90.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
			lines: [
				{
					lineType: "class_registration",
					lineIndex: 0,
					festivalClassId: f.classConfig1.id,
					childId: f.child1.id,
					shopifyProductGid: f.classConfig1.shopifyProductGid,
					shopifyVariantGid: f.classConfig1.shopifyVariantGid,
					amount: "50.00",
					currencyCode: "USD",
				},
				{
					lineType: "class_registration",
					lineIndex: 1,
					festivalClassId: f.classConfig2.id,
					childId: f.child2.id,
					shopifyProductGid: f.classConfig2.shopifyProductGid,
					shopifyVariantGid: f.classConfig2.shopifyVariantGid,
					amount: "40.00",
					currencyCode: "USD",
				},
			],
		});
		if (multiIntent.kind !== "created") {
			throw new Error("Expected multi-line intent to be created");
		}

		// Order with missing line
		const orderWithMissingLine: ShopifyPaidOrder = {
			id: "gid://shopify/Order/2003",
			customerGid: "gid://shopify/Customer/500",
			customerEmail: "parent@example.test",
			fullyPaid: true,
			fullyPaidAtIso: "2026-09-21T17:30:00.000Z",
			currencyCode: "USD",
			customAttributes: [
				{
					key: "festival_checkout_intent_id",
					value: multiIntent.intent.correlationId,
				},
			],
			lineItems: [
				{
					id: "gid://shopify/LineItem/2004",
					productGid: f.classConfig1.shopifyProductGid,
					variantGid: f.classConfig1.shopifyVariantGid,
					quantity: 1,
					paidAmount: "50.00",
					paidCurrencyCode: "USD",
				},
			],
		};
		f.orders.values.set(orderWithMissingLine.id, orderWithMissingLine);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-multi-line-mismatch",
			orderWithMissingLine.id,
		);

		expect(await f.service.processDelivery(received.id)).toBe("processed");

		const entitlements = await f.commerce.listClassEntitlements({
			organizationId: f.organization.id,
		});
		expect(entitlements).toHaveLength(0);

		const decisions = await f.commerce.listCustomerDecisions(
			f.organization.id,
			f.customer.id,
		);
		expect(decisions).toMatchObject([
			{ status: "rejected", reasonCode: "offering_mismatch" },
		]);
	});
});
