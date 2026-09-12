import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { MembershipStatusService } from "../src/commerce/membership-status-service.js";
import { ShopifyOrderProjectionService } from "../src/commerce/shopify-order-projection-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";
import { ShopifyAdminApiError } from "../src/shopify/errors.js";
import type {
	ShopifyOrderCustomerProfile,
	ShopifyPaidOrder,
	ShopifyPaidOrderReader,
} from "../src/shopify/types.js";

const NOW = new Date("2026-08-28T18:10:00.000Z");
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
	staffAccessConsent = false,
	productionSnapshot: {
		now?: Date;
		shopifyCustomerGid?: string;
		shopifyProductGid?: string;
		shopifyVariantGid?: string;
		amount?: string;
		currencyCode?: string;
		divisionName?: string;
	} = {},
) {
	const now = productionSnapshot.now ?? NOW;
	const organizations = new InMemoryOrganizationRepository();
	const organization = await organizations.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	await organizations.updateOrganizationTimezone(
		organization.id,
		"America/Los_Angeles",
	);
	const secrets = keyring();
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
			read_orders: "granted",
			write_orders: "disabled",
		},
	});
	const division = await organizations.createDivision({
		organizationId: organization.id,
		displayName: productionSnapshot.divisionName ?? "Piano",
		normalizedName: (productionSnapshot.divisionName ?? "Piano")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-"),
	});
	const offering = await organizations.createMembershipProductRecord({
		organizationId: organization.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid:
			productionSnapshot.shopifyProductGid ?? "gid://shopify/Product/1",
		shopifyVariantGid:
			productionSnapshot.shopifyVariantGid ?? "gid://shopify/ProductVariant/1",
		productNameSnapshot: "Teacher Membership",
	});
	const customers = new InMemoryCustomerAccountRepository();
	const { customer } = await customers.createCustomerSession({
		sessionId: "session",
		organizationId: organization.id,
		shopifyCustomerGid:
			productionSnapshot.shopifyCustomerGid ?? "gid://shopify/Customer/1",
		encryptedTokens: "opaque",
		csrfToken: "csrf",
		integrationVersion: 1,
		createdAtIso: now.toISOString(),
		lastSeenAtIso: now.toISOString(),
		expiresAtIso: "2030-01-01T00:00:00.000Z",
	});
	const checkout = new InMemoryCheckoutRepository();
	const created = await checkout.createIntent({
		organizationId: organization.id,
		customerId: customer.id,
		sessionId: "session",
		idempotencyKey: "idempotency",
		offeringId: offering.id,
		entitlementClass: "teacher_membership",
		durationDays: offering.durationDays,
		shopifyProductGid: offering.shopifyProductGid,
		shopifyVariantGid: offering.shopifyVariantGid,
		policyVersion: "v1",
		divisionId: division.id,
		divisionNameSnapshot: division.displayName,
		staffAccessConsent,
		amount: productionSnapshot.amount ?? "75.00",
		currencyCode: productionSnapshot.currencyCode ?? "USD",
		expiresAtIso,
	});
	if (created.kind !== "created") throw new Error("Expected checkout intent.");
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
		offering,
		customers,
		customer,
		checkout,
		intent: created.intent,
		commerce,
		orders,
		service,
	};
}

function paidOrder(correlationId: string): ShopifyPaidOrder {
	return {
		id: "gid://shopify/Order/1",
		customerGid: "gid://shopify/Customer/1",
		fullyPaid: true,
		fullyPaidAtIso: "2026-08-28T17:30:00.000Z",
		currencyCode: "USD",
		customAttributes: [
			{ key: "festival_checkout_intent_id", value: correlationId },
		],
		lineItems: [
			{
				id: "gid://shopify/LineItem/1",
				productGid: "gid://shopify/Product/1",
				variantGid: "gid://shopify/ProductVariant/1",
				quantity: 1,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
			},
		],
	};
}

async function delivery(
	commerce: InMemoryMembershipCommerceRepository,
	organizationId: string,
	webhookId: string,
	orderGid = "gid://shopify/Order/1",
	receivedAtIso = NOW.toISOString(),
) {
	const recorded = await commerce.recordDelivery({
		organizationId,
		shopDomain: "festival.myshopify.com",
		webhookId,
		topic: "orders/paid",
		apiVersion: "2026-07",
		shopifyOrderGid: orderGid,
		payloadSha256: "a".repeat(64),
		receivedAtIso,
	});
	if (recorded.kind !== "accepted")
		throw new Error("Expected delivery evidence.");
	return recorded.delivery;
}

describe("Shopify order projection", () => {
	it("records bounded Shopify read diagnostics and safely retries the delivery", async () => {
		const f = await fixture();
		f.orders.readFailure = new ShopifyAdminApiError(
			"Shopify denied the read.",
			{
				requestId: "request-123",
			},
		);
		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-0000000000",
		);

		expect(await f.service.processDelivery(received.id)).toBe("failed");
		const failed = await f.commerce.recordDelivery({
			organizationId: f.organization.id,
			shopDomain: "festival.myshopify.com",
			webhookId: "webhook-0000000000",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/1",
			payloadSha256: "a".repeat(64),
			receivedAtIso: NOW.toISOString(),
		});
		if (failed.kind !== "duplicate")
			throw new Error("Expected failed delivery.");
		expect(failed.delivery).toMatchObject({
			status: "failed",
			failureCategory: "upstream",
			failureStage: "order_read",
			failureCode: "shopify_upstream",
			shopifyRequestId: "request-123",
			failedAtIso: NOW.toISOString(),
		});

		f.orders.readFailure = undefined;
		f.orders.values.set(
			"gid://shopify/Order/1",
			paidOrder(f.intent.correlationId),
		);
		expect(await f.service.processDelivery(received.id)).toBe("processed");
	});

	it("issues exactly one immutable grant from an Admin-read, correlated paid order", async () => {
		const f = await fixture();
		await f.organizations.updateDivision({
			organizationId: f.organization.id,
			divisionId: f.division.id,
			displayName: "Piano & Strings",
			normalizedName: "piano-strings",
		});
		f.orders.values.set("gid://shopify/Order/1", {
			...paidOrder(f.intent.correlationId),
			fullyPaidAtIso: "2026-08-28T18:00:00.001Z",
		});
		const first = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-0000000001",
		);

		expect(await f.service.processDelivery(first.id)).toBe("processed");
		const grants = await f.organizations.listEntitlementGrantSnapshots(
			f.organization.id,
			f.customer.id,
		);
		expect(grants).toHaveLength(1);
		expect(f.orders.profileReads).toBe(0);
		expect(grants[0]).toMatchObject({
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			divisionId: f.division.id,
			divisionNameSnapshot: "Piano",
			startsOn: "2026-08-28",
			endsOn: "2027-08-28",
		});
		expect(
			await f.checkout.findIntentByCorrelation(
				f.organization.id,
				f.intent.correlationId,
			),
		).toMatchObject({ status: "approved" });

		const replay = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-0000000002",
		);
		expect(await f.service.processDelivery(replay.id)).toBe("skipped");
		expect(
			await f.organizations.listEntitlementGrantSnapshots(
				f.organization.id,
				f.customer.id,
			),
		).toHaveLength(1);

		const status = await new MembershipStatusService(
			f.organizations,
			f.commerce,
			() => NOW,
		).listForCustomer(f.organization.id, f.customer.id);
		expect(status).toEqual({
			memberships: [
				{
					status: "active",
					entitlementClass: "teacher_membership",
					displayName: "Teacher Membership",
					divisionName: "Piano",
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					durationDays: 365,
					startsOn: "2026-08-28",
					endsOn: "2027-08-28",
				},
			],
		});
		expect(
			await new MembershipStatusService(
				f.organizations,
				f.commerce,
				() => new Date("2027-08-29T08:00:00.000Z"),
			).listForCustomer(f.organization.id, f.customer.id),
		).toMatchObject({ memberships: [{ status: "expired" }] });
	});

	it("projects contact fields only after explicit staff-access consent", async () => {
		const f = await fixture("2030-01-01T00:00:00.000Z", true);
		f.orders.values.set(
			"gid://shopify/Order/1",
			paidOrder(f.intent.correlationId),
		);
		f.orders.profile = {
			name: "Shopify Customer",
			email: "customer@example.com",
			phone: "+1 555 555 0100",
			mailingAddress: {
				line1: "123 Main Street",
				city: "Portland",
				region: "OR",
				postalCode: "97201",
				countryCode: "US",
			},
		};
		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-0000000005",
		);

		expect(await f.service.processDelivery(received.id)).toBe("processed");
		expect(f.orders.profileReads).toBe(1);
		expect(
			await f.customers.getConsentedCustomer(
				f.organization.id,
				f.customer.id,
				"festival-customer-profile-v1",
			),
		).toMatchObject({
			name: { value: "Shopify Customer", source: "shopify" },
			email: { value: "customer@example.com", source: "shopify" },
		});
	});

	it("retries a failed consent-profile projection after issuing a grant", async () => {
		const f = await fixture("2030-01-01T00:00:00.000Z", true);
		f.orders.values.set(
			"gid://shopify/Order/1",
			paidOrder(f.intent.correlationId),
		);
		f.orders.profileFailure = true;
		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-0000000008",
		);

		expect(await f.service.processDelivery(received.id)).toBe("failed");
		expect(
			await f.organizations.listEntitlementGrantSnapshots(
				f.organization.id,
				f.customer.id,
			),
		).toHaveLength(1);
		f.orders.profileFailure = false;
		expect(await f.service.processDelivery(received.id)).toBe("processed");
		expect(
			await f.organizations.listEntitlementGrantSnapshots(
				f.organization.id,
				f.customer.id,
			),
		).toHaveLength(1);
		expect(f.orders.profileReads).toBe(2);
	});

	it("does not grant a fully paid order with mismatched paid money", async () => {
		const f = await fixture();
		const mismatched = paidOrder(f.intent.correlationId);
		mismatched.lineItems[0] = {
			...mismatched.lineItems[0],
			paidAmount: "0.00",
		};
		f.orders.values.set(mismatched.id, mismatched);
		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-0000000009",
		);

		expect(await f.service.processDelivery(received.id)).toBe("processed");
		expect(
			await f.organizations.listEntitlementGrantSnapshots(
				f.organization.id,
				f.customer.id,
			),
		).toHaveLength(0);
		expect(
			await f.commerce.listCustomerDecisions(f.organization.id, f.customer.id),
		).toMatchObject([{ status: "rejected", reasonCode: "payment_mismatch" }]);
	});

	it("serializes concurrent webhook deliveries for one paid order", async () => {
		const f = await fixture();
		f.orders.values.set(
			"gid://shopify/Order/1",
			paidOrder(f.intent.correlationId),
		);
		const [left, right] = await Promise.all([
			delivery(f.commerce, f.organization.id, "webhook-0000000006"),
			delivery(f.commerce, f.organization.id, "webhook-0000000007"),
		]);
		expect(
			await Promise.all([
				f.service.processDelivery(left.id),
				f.service.processDelivery(right.id),
			]),
		).toEqual(["processed", "processed"]);
		expect(
			await f.organizations.listEntitlementGrantSnapshots(
				f.organization.id,
				f.customer.id,
			),
		).toHaveLength(1);
		expect(
			await f.commerce.listCustomerDecisions(f.organization.id, f.customer.id),
		).toHaveLength(1);
	});

	it("terminally reviews a paid order whose checkout intent expired", async () => {
		const f = await fixture("2026-08-28T18:00:00.000Z");
		f.orders.values.set("gid://shopify/Order/1", {
			...paidOrder(f.intent.correlationId),
			fullyPaidAtIso: "2026-08-28T18:00:00.001Z",
		});
		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-0000000003",
		);

		expect(await f.service.processDelivery(received.id)).toBe("processed");
		expect(
			await f.organizations.listEntitlementGrantSnapshots(
				f.organization.id,
				f.customer.id,
			),
		).toHaveLength(0);
		expect(
			await f.commerce.listCustomerDecisions(f.organization.id, f.customer.id),
		).toMatchObject([{ status: "needs_review", reasonCode: "intent_expired" }]);
		expect(
			await f.checkout.hasProcessingIntent(
				f.organization.id,
				f.customer.id,
				NOW.toISOString(),
			),
		).toBeFalse();
	});

	it("approves a payment before a PostgreSQL-formatted checkout expiry", async () => {
		const f = await fixture("2026-09-12 15:00:21.026-07");
		f.orders.values.set("gid://shopify/Order/1", {
			...paidOrder(f.intent.correlationId),
			fullyPaidAtIso: "2026-09-12T21:30:37.000Z",
		});
		const received = await delivery(
			f.commerce,
			f.organization.id,
			"webhook-0000000010",
		);

		expect(await f.service.processDelivery(received.id)).toBe("processed");
		expect(
			await f.organizations.listEntitlementGrantSnapshots(
				f.organization.id,
				f.customer.id,
			),
		).toHaveLength(1);
		expect(
			await f.commerce.listCustomerDecisions(f.organization.id, f.customer.id),
		).toMatchObject([{ status: "approved" }]);
	});

	// Regression harness for https://github.com/pafenorthwest/Festival/issues/126.
	// Snapshot source: the 2026-09-10 production delivery that was accepted, then
	// failed because Shopify denied the Admin GraphQL ReadPaidOrder operation.
	it("approves the captured paid-before-expiry order when reconciliation runs after intent expiry", async () => {
		const paidAtIso = "2026-09-11T06:04:01.203Z";
		const expiresAtIso = "2026-09-11T06:33:32.656Z";
		const reconciledAt = new Date("2026-09-11T07:00:00.000Z");
		const orderGid = "gid://shopify/Order/6795053859005";
		const f = await fixture(expiresAtIso, true, {
			now: reconciledAt,
			shopifyCustomerGid: "gid://shopify/Customer/9381966446781",
			shopifyProductGid: "gid://shopify/Product/8448886866109",
			shopifyVariantGid: "gid://shopify/ProductVariant/47990099968189",
			amount: "25.0",
			currencyCode: "USD",
			divisionName: "Cello/Bass",
		});
		f.orders.values.set(orderGid, {
			id: orderGid,
			customerGid: "gid://shopify/Customer/9381966446781",
			fullyPaid: true,
			fullyPaidAtIso: paidAtIso,
			currencyCode: "USD",
			customAttributes: [
				{ key: "festival_checkout_intent_id", value: f.intent.correlationId },
			],
			lineItems: [
				{
					id: "gid://shopify/LineItem/1",
					productGid: "gid://shopify/Product/8448886866109",
					variantGid: "gid://shopify/ProductVariant/47990099968189",
					quantity: 1,
					paidAmount: "25.00",
					paidCurrencyCode: "USD",
				},
			],
		});
		const received = await delivery(
			f.commerce,
			f.organization.id,
			"b39456f0-8484-5fd7-9701-4b58c31c91ba",
			orderGid,
			paidAtIso,
		);

		expect(await f.service.processDelivery(received.id)).toBe("processed");
		expect(
			await f.organizations.listEntitlementGrantSnapshots(
				f.organization.id,
				f.customer.id,
			),
		).toHaveLength(1);
		expect(
			await f.commerce.listCustomerDecisions(f.organization.id, f.customer.id),
		).toMatchObject([{ status: "approved" }]);
	});

	it("rejects a cart-manipulated order line and reconciles missed paid orders", async () => {
		const invalid = await fixture();
		const manipulated = paidOrder(invalid.intent.correlationId);
		manipulated.lineItems[0] = {
			...manipulated.lineItems[0],
			quantity: 2,
		};
		invalid.orders.values.set(manipulated.id, manipulated);
		const received = await delivery(
			invalid.commerce,
			invalid.organization.id,
			"webhook-0000000004",
		);
		expect(await invalid.service.processDelivery(received.id)).toBe(
			"processed",
		);
		expect(
			await invalid.commerce.listCustomerDecisions(
				invalid.organization.id,
				invalid.customer.id,
			),
		).toMatchObject([{ status: "rejected", reasonCode: "offering_mismatch" }]);

		const reconciled = await fixture();
		const order = paidOrder(reconciled.intent.correlationId);
		reconciled.orders.values.set(order.id, order);
		reconciled.orders.listed.push(order);
		expect(
			await reconciled.service.reconcile(reconciled.organization.id),
		).toEqual({
			discoveredCount: 1,
			processedCount: 1,
		});
		expect(reconciled.commerce.reconciliationRuns).toMatchObject([
			{ status: "completed", discoveredCount: 1, processedCount: 1 },
		]);
		expect(
			await reconciled.organizations.listEntitlementGrantSnapshots(
				reconciled.organization.id,
				reconciled.customer.id,
			),
		).toHaveLength(1);
	});
});
