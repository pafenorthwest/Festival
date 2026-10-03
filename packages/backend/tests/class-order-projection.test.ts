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

async function fixture(
	expiresAtIso = "2030-01-01T00:00:00.000Z",
	options: {
		now?: Date;
		price?: string;
		currencyCode?: string;
		shopifyCustomerGid?: string;
		shopifyProductGid?: string;
		shopifyVariantGid?: string;
		staffAccessConsent?: boolean;
	} = {},
) {
	const now = options.now ?? NOW;
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
		verifiedAtIso: now.toISOString(),
		lastTestedAtIso: now.toISOString(),
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

	const classConfig = await organizations.createFestivalClassConfiguration({
		organizationId: organization.id,
		festivalId: festival.id,
		displayName: "Violin Solo - Advanced",
		classSubtypeId: subtype.id,
		divisionId: division.id,
		minimumAge: 8,
		maximumAge: 18,
		price: options.price ?? "50.00",
		maximumPerformancePieces: 2,
		performanceMinutes: 15,
		capacity: 25,
		isActive: true,
		shopifyProductGid: options.shopifyProductGid ?? "gid://shopify/Product/100",
		shopifyVariantGid:
			options.shopifyVariantGid ?? "gid://shopify/ProductVariant/200",
	});

	const customers = new InMemoryCustomerAccountRepository();
	const { customer } = await customers.createCustomerSession({
		sessionId: "parent-session",
		organizationId: organization.id,
		shopifyCustomerGid:
			options.shopifyCustomerGid ?? "gid://shopify/Customer/500",
		encryptedTokens: "opaque",
		csrfToken: "csrf",
		integrationVersion: 1,
		createdAtIso: now.toISOString(),
		lastSeenAtIso: now.toISOString(),
		expiresAtIso: "2030-01-01T00:00:00.000Z",
	});

	const child = await customers.createChild({
		organizationId: organization.id,
		parentCustomerId: customer.id,
		displayName: "Alice Violinist",
		createdAtIso: now.toISOString(),
	});

	await customers.createChildAgeSnapshot({
		organizationId: organization.id,
		childId: child.id,
		age: 12,
		createdAtIso: now.toISOString(),
		validUntilIso: "2026-12-31T00:00:00.000Z",
	});

	const checkout = new InMemoryCheckoutRepository();
	const created = await checkout.createIntent({
		organizationId: organization.id,
		customerId: customer.id,
		sessionId: "parent-session",
		idempotencyKey: "class-checkout-idempotency",
		intentType: "class_entry",
		festivalClassId: classConfig.id,
		childId: child.id,
		shopifyProductGid: classConfig.shopifyProductGid,
		shopifyVariantGid: classConfig.shopifyVariantGid,
		staffAccessConsent: options.staffAccessConsent ?? false,
		amount: classConfig.price,
		currencyCode: options.currencyCode ?? "USD",
		expiresAtIso,
	});
	if (created.kind !== "created") {
		throw new Error("Expected checkout intent to be created.");
	}

	const commerce = new InMemoryMembershipCommerceRepository(
		organizations,
		checkout,
		() => now,
	);
	const orders = new Orders();
	const service = new ShopifyOrderProjectionService(
		organizations,
		checkout,
		commerce,
		orders,
		secrets,
		customers,
		() => now,
	);

	return {
		organizations,
		organization,
		division,
		festival,
		classConfig,
		customers,
		customer,
		child,
		checkout,
		intent: created.intent,
		commerce,
		orders,
		service,
	};
}

function paidClassOrder(
	correlationId: string,
	options: {
		orderGid?: string;
		orderLineGid?: string;
		productGid?: string;
		variantGid?: string;
		customerGid?: string;
		paidAmount?: string;
		paidCurrencyCode?: string;
		fullyPaid?: boolean;
		fullyPaidAtIso?: string;
	} = {},
): ShopifyPaidOrder {
	return {
		id: options.orderGid ?? "gid://shopify/Order/1000",
		customerGid: options.customerGid ?? "gid://shopify/Customer/500",
		customerEmail: "parent@example.test",
		fullyPaid: options.fullyPaid ?? true,
		fullyPaidAtIso: options.fullyPaidAtIso ?? "2026-09-21T17:30:00.000Z",
		currencyCode: options.paidCurrencyCode ?? "USD",
		customAttributes: [
			{ key: "festival_checkout_intent_id", value: correlationId },
		],
		lineItems: [
			{
				id: options.orderLineGid ?? "gid://shopify/LineItem/2000",
				productGid: options.productGid ?? "gid://shopify/Product/100",
				variantGid: options.variantGid ?? "gid://shopify/ProductVariant/200",
				quantity: 1,
				paidAmount: options.paidAmount ?? "50.00",
				paidCurrencyCode: options.paidCurrencyCode ?? "USD",
			},
		],
	};
}

async function delivery(
	commerce: InMemoryMembershipCommerceRepository,
	organizationId: string,
	webhookId: string,
	orderGid = "gid://shopify/Order/1000",
	receivedAtIso = NOW.toISOString(),
) {
	const recorded = await commerce.recordDelivery({
		organizationId,
		shopDomain: "seattle-fest.myshopify.com",
		webhookId,
		topic: "orders/paid",
		apiVersion: "2026-07",
		shopifyOrderGid: orderGid,
		payloadSha256: "b".repeat(64),
		receivedAtIso,
	});
	if (recorded.kind !== "accepted") {
		throw new Error("Expected delivery to be accepted.");
	}
	return recorded.delivery;
}

describe("Class Order Projection and Entitlements", () => {
	it("successfully projects a Shopify orders/paid webhook creating a confirmed ClassEntitlement", async () => {
		const f = await fixture();
		const order = paidClassOrder(f.intent.correlationId);
		f.orders.values.set(order.id, order);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-001",
		);

		const result = await f.service.processDelivery(received.id);
		expect(result).toBe("processed");

		// Verify intent is marked as approved
		const intent = await f.checkout.findIntentByCorrelation(
			f.organization.id,
			f.intent.correlationId,
		);
		expect(intent?.status).toBe("approved");

		// Verify ClassEntitlement created
		const entitlements = await f.commerce.listClassEntitlements({
			organizationId: f.organization.id,
		});
		expect(entitlements).toHaveLength(1);
		expect(entitlements[0]).toMatchObject({
			organizationId: f.organization.id,
			festivalId: f.festival.id,
			festivalClassId: f.classConfig.id,
			parentCustomerId: f.customer.id,
			childId: f.child.id,
			checkoutIntentId: f.intent.id,
			shopifyOrderGid: order.id,
			shopifyOrderLineGid: "gid://shopify/LineItem/2000",
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		// Verify finder methods on commerce repo
		const byLine = await f.commerce.findClassEntitlementByOrderLine(
			f.organization.id,
			"gid://shopify/LineItem/2000",
		);
		expect(byLine).not.toBeNull();
		expect(byLine?.id).toBe(entitlements[0].id);

		const byIntent = await f.commerce.findClassEntitlementByIntentId(
			f.organization.id,
			f.intent.id,
		);
		expect(byIntent).not.toBeNull();
		expect(byIntent?.id).toBe(entitlements[0].id);

		const byId = await f.commerce.getClassEntitlement(
			f.organization.id,
			entitlements[0].id,
		);
		expect(byId).not.toBeNull();
		expect(byId?.id).toBe(entitlements[0].id);

		// Verify status update
		const updated = await f.commerce.updateClassEntitlementStatus(
			f.organization.id,
			entitlements[0].id,
			"waitlisted",
		);
		expect(updated?.status).toBe("waitlisted");

		const finalCheck = await f.commerce.getClassEntitlement(
			f.organization.id,
			entitlements[0].id,
		);
		expect(finalCheck?.status).toBe("waitlisted");
	});

	it("idempotently processes duplicate webhook deliveries without duplicate entitlements", async () => {
		const f = await fixture();
		const order = paidClassOrder(f.intent.correlationId);
		f.orders.values.set(order.id, order);

		const first = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-dup-1",
		);
		expect(await f.service.processDelivery(first.id)).toBe("processed");

		const entitlementsAfterFirst = await f.commerce.listClassEntitlements({
			organizationId: f.organization.id,
		});
		expect(entitlementsAfterFirst).toHaveLength(1);

		// Replay / second delivery
		const replay = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-dup-2",
		);
		const replayResult = await f.service.processDelivery(replay.id);
		expect(replayResult).toBe("skipped");

		const entitlementsAfterReplay = await f.commerce.listClassEntitlements({
			organizationId: f.organization.id,
		});
		expect(entitlementsAfterReplay).toHaveLength(1);
	});

	it("serializes concurrent webhook deliveries for the same class order", async () => {
		const f = await fixture();
		const order = paidClassOrder(f.intent.correlationId);
		f.orders.values.set(order.id, order);

		const [left, right] = await Promise.all([
			delivery(f.commerce, f.organization.id, "webhook-class-con-1"),
			delivery(f.commerce, f.organization.id, "webhook-class-con-2"),
		]);

		const [resLeft, resRight] = await Promise.all([
			f.service.processDelivery(left.id),
			f.service.processDelivery(right.id),
		]);

		expect([resLeft, resRight]).toEqual(["processed", "processed"]);

		const entitlements = await f.commerce.listClassEntitlements({
			organizationId: f.organization.id,
		});
		expect(entitlements).toHaveLength(1);
		expect(
			await f.commerce.listCustomerDecisions(f.organization.id, f.customer.id),
		).toHaveLength(1);
	});

	it("rejects order on mismatched product or variant GID", async () => {
		const f = await fixture();
		const mismatched = paidClassOrder(f.intent.correlationId, {
			productGid: "gid://shopify/Product/wrong-product",
			variantGid: "gid://shopify/ProductVariant/wrong-variant",
		});
		f.orders.values.set(mismatched.id, mismatched);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-mismatch-product",
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

	it("rejects order on mismatched paid price", async () => {
		const f = await fixture();
		const mismatched = paidClassOrder(f.intent.correlationId, {
			paidAmount: "10.00", // Intent amount is "50.00"
		});
		f.orders.values.set(mismatched.id, mismatched);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-mismatch-price",
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
			{ status: "rejected", reasonCode: "payment_mismatch" },
		]);
	});

	it("rejects order on mismatched currency code", async () => {
		const f = await fixture();
		const mismatched = paidClassOrder(f.intent.correlationId, {
			paidCurrencyCode: "CAD", // Intent currency is "USD"
		});
		f.orders.values.set(mismatched.id, mismatched);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-mismatch-currency",
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
			{ status: "rejected", reasonCode: "payment_mismatch" },
		]);
	});

	it("rejects unpaid orders (fullyPaid: false)", async () => {
		const f = await fixture();
		const unpaid = paidClassOrder(f.intent.correlationId, {
			fullyPaid: false,
		});
		f.orders.values.set(unpaid.id, unpaid);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-unpaid",
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
			{ status: "rejected", reasonCode: "order_not_paid" },
		]);
	});

	it("marks incomplete payment as needs_review when fullyPaidAtIso is missing", async () => {
		const f = await fixture();
		const incomplete = paidClassOrder(f.intent.correlationId);
		// @ts-expect-error test undefined fullyPaidAtIso
		incomplete.fullyPaidAtIso = undefined;
		f.orders.values.set(incomplete.id, incomplete);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-incomplete",
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
			{ status: "needs_review", reasonCode: "payment_incomplete" },
		]);
	});

	it("marks decision as needs_review when checkout intent has expired", async () => {
		const f = await fixture("2026-09-21T16:00:00.000Z"); // expired before payment at 17:30
		const order = paidClassOrder(f.intent.correlationId, {
			fullyPaidAtIso: "2026-09-21T17:30:00.000Z",
		});
		f.orders.values.set(order.id, order);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-expired",
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
			{ status: "needs_review", reasonCode: "intent_expired" },
		]);
	});

	it("rejects order when customer GID does not match parent customer", async () => {
		const f = await fixture();
		const wrongCustomer = paidClassOrder(f.intent.correlationId, {
			customerGid: "gid://shopify/Customer/different-customer",
		});
		f.orders.values.set(wrongCustomer.id, wrongCustomer);

		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-class-wrong-customer",
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
			{ status: "rejected", reasonCode: "customer_mismatch" },
		]);
	});

	it("projects multi-line class order creating 2 ClassEntitlements linked to checkoutIntentLineIds", async () => {
		const f = await fixture();
		const classConfig2 = await f.organizations.createFestivalClassConfiguration(
			{
				organizationId: f.organization.id,
				festivalId: f.festival.id,
				displayName: "Violin Solo - Intermediate",
				classSubtypeId: f.classConfig.classSubtypeId,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 18,
				price: "40.00",
				maximumPerformancePieces: 2,
				performanceMinutes: 10,
				capacity: 25,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/101",
				shopifyVariantGid: "gid://shopify/ProductVariant/201",
			},
		);
		const child2 = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: f.customer.id,
			displayName: "Bob Violinist",
			createdAtIso: NOW.toISOString(),
		});

		const { customer: multiCustomer } = await f.customers.createCustomerSession(
			{
				sessionId: "multi-session",
				organizationId: f.organization.id,
				shopifyCustomerGid: "gid://shopify/Customer/501",
				encryptedTokens: "opaque",
				csrfToken: "csrf",
				integrationVersion: 1,
				createdAtIso: NOW.toISOString(),
				lastSeenAtIso: NOW.toISOString(),
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			},
		);

		const multiIntent = await f.checkout.createIntent({
			organizationId: f.organization.id,
			customerId: multiCustomer.id,
			sessionId: "multi-session",
			idempotencyKey: "multi-class-intent",
			intentType: "class_entry",
			festivalClassId: f.classConfig.id,
			childId: f.child.id,
			shopifyProductGid: f.classConfig.shopifyProductGid,
			shopifyVariantGid: f.classConfig.shopifyVariantGid,
			amount: "90.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
			lines: [
				{
					lineType: "class_registration",
					lineIndex: 0,
					festivalClassId: f.classConfig.id,
					childId: f.child.id,
					shopifyProductGid: f.classConfig.shopifyProductGid,
					shopifyVariantGid: f.classConfig.shopifyVariantGid,
					amount: "50.00",
					currencyCode: "USD",
				},
				{
					lineType: "class_registration",
					lineIndex: 1,
					festivalClassId: classConfig2.id,
					childId: child2.id,
					shopifyProductGid: classConfig2.shopifyProductGid,
					shopifyVariantGid: classConfig2.shopifyVariantGid,
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
			customerGid: "gid://shopify/Customer/501",
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
					productGid: f.classConfig.shopifyProductGid,
					variantGid: f.classConfig.shopifyVariantGid,
					quantity: 1,
					paidAmount: "50.00",
					paidCurrencyCode: "USD",
				},
				{
					id: "gid://shopify/LineItem/2002",
					productGid: classConfig2.shopifyProductGid,
					variantGid: classConfig2.shopifyVariantGid,
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

		expect(await f.service.processDelivery(received.id)).toBe("processed");

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
					festivalClassId: f.classConfig.id,
					childId: f.child.id,
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
					festivalClassId: classConfig2.id,
					childId: child2.id,
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

		const { customer: multiCustomer } = await f.customers.createCustomerSession(
			{
				sessionId: "multi-session-2",
				organizationId: f.organization.id,
				shopifyCustomerGid: "gid://shopify/Customer/502",
				encryptedTokens: "opaque",
				csrfToken: "csrf",
				integrationVersion: 1,
				createdAtIso: NOW.toISOString(),
				lastSeenAtIso: NOW.toISOString(),
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			},
		);

		const multiIntent = await f.checkout.createIntent({
			organizationId: f.organization.id,
			customerId: multiCustomer.id,
			sessionId: "multi-session-2",
			idempotencyKey: "multi-class-line-mismatch",
			intentType: "class_entry",
			festivalClassId: f.classConfig.id,
			childId: f.child.id,
			shopifyProductGid: f.classConfig.shopifyProductGid,
			shopifyVariantGid: f.classConfig.shopifyVariantGid,
			amount: "90.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
			lines: [
				{
					lineType: "class_registration",
					lineIndex: 0,
					festivalClassId: f.classConfig.id,
					childId: f.child.id,
					shopifyProductGid: f.classConfig.shopifyProductGid,
					shopifyVariantGid: f.classConfig.shopifyVariantGid,
					amount: "50.00",
					currencyCode: "USD",
				},
				{
					lineType: "class_registration",
					lineIndex: 1,
					festivalClassId: f.classConfig.id,
					childId: f.child.id,
					shopifyProductGid: f.classConfig.shopifyProductGid,
					shopifyVariantGid: f.classConfig.shopifyVariantGid,
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
			customerGid: "gid://shopify/Customer/502",
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
					productGid: f.classConfig.shopifyProductGid,
					variantGid: f.classConfig.shopifyVariantGid,
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
			multiCustomer.id,
		);
		expect(decisions).toMatchObject([
			{ status: "rejected", reasonCode: "offering_mismatch" },
		]);
	});
});
