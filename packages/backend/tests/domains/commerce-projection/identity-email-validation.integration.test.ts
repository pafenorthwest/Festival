import { describe, expect, it, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { InMemoryCheckoutRepository } from "../../../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../../../src/commerce/membership-commerce-repository.js";
import { InMemoryCustomerAccountRepository } from "../../../src/customer/in-memory-customer-account-repository.js";
import {
	buildMembershipGrantInput,
	PostgresOrderProjectionRepository,
	ShopifyOrderProjectionService,
	type ShopifyPaidOrder,
} from "../../../src/domains/commerce-projection/index.js";
import { InMemoryOrganizationRepository } from "../../../src/repo/in-memory-organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../../../src/shopify/encryption.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "../../postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("commerce_email");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
const NOW = new Date("2026-09-01T18:00:00.000Z");
const TEST_KEY = Buffer.alloc(32, 9).toString("base64");

function makeKeyring(): ShopifySecretKeyring {
	const kr = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ k1: TEST_KEY }),
		"k1",
	);
	if (!kr) throw new Error("Expected keyring.");
	return kr;
}

async function createProjectionHarness() {
	const organizations = new InMemoryOrganizationRepository(() => NOW);
	const org = await organizations.createOrganization({
		name: "Email Org",
		slug: "email-org",
	});
	const division = await organizations.createDivision({
		organizationId: org.id,
		displayName: "Piano",
		normalizedName: "piano",
	});
	const keyring = makeKeyring();
	await organizations.upsertShopifyIntegration({
		organizationId: org.id,
		storeDomain: "email-org.myshopify.com",
		clientId: "cid",
		encryptedClientSecret: keyring.encrypt("secret", {
			organizationId: org.id,
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
		}),
	});
	await organizations.updateShopifyVerification({
		organizationId: org.id,
		verificationStatus: "ok",
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: "email-org.myshopify.com",
		grantedScopes: ["read_orders"],
		capabilities: {
			read_products: "missing",
			write_products: "missing",
			write_inventory: "missing",
			read_orders: "granted",
			write_orders: "disabled",
		},
		verifiedAtIso: NOW.toISOString(),
		lastTestedAtIso: NOW.toISOString(),
	});
	const offering = await organizations.createMembershipProductRecord({
		organizationId: org.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/tm-email",
		shopifyVariantGid: "gid://shopify/ProductVariant/tm-email",
		productNameSnapshot: "Teacher Membership",
	});
	const customers = new InMemoryCustomerAccountRepository();
	const { customer } = await customers.createCustomerSession({
		sessionId: "sess-email",
		organizationId: org.id,
		shopifyCustomerGid: "gid://shopify/Customer/99",
		encryptedTokens: "opaque",
		csrfToken: "csrf",
		integrationVersion: 1,
		createdAtIso: NOW.toISOString(),
		lastSeenAtIso: NOW.toISOString(),
		expiresAtIso: "2030-01-01T00:00:00.000Z",
	});
	const checkout = new InMemoryCheckoutRepository();
	const commerce = new InMemoryMembershipCommerceRepository(
		organizations,
		checkout,
		() => NOW,
	);
	const ordersByGid = new Map<string, ShopifyPaidOrder>();
	const service = new ShopifyOrderProjectionService(
		organizations,
		checkout,
		commerce,
		{
			readPaidOrderByGid: async (_ctx, gid) => ({
				value: ordersByGid.get(gid) ?? null,
			}),
			listPaidOrdersSince: async () => ({ value: [] }),
			readOrderCustomerProfileByGid: async () => ({ value: null }),
		},
		keyring,
		customers,
		() => NOW,
	);
	return {
		organizations,
		org,
		division,
		offering,
		customer,
		checkout,
		commerce,
		ordersByGid,
		service,
	};
}

function buildSamplePaidOrder(
	orderSuffix: string,
	correlationId: string,
	customerEmail: string | undefined,
): ShopifyPaidOrder {
	return {
		id: `gid://shopify/Order/${orderSuffix}`,
		customerGid: "gid://shopify/Customer/99",
		customerEmail,
		fullyPaid: true,
		fullyPaidAtIso: "2026-09-01T17:30:00.000Z",
		currencyCode: "USD",
		customAttributes: [
			{ key: "festival_checkout_intent_id", value: correlationId },
		],
		lineItems: [
			{
				id: `gid://shopify/LineItem/${orderSuffix}`,
				productGid: "gid://shopify/Product/tm-email",
				variantGid: "gid://shopify/ProductVariant/tm-email",
				quantity: 1,
				paidAmount: "50.00",
				paidCurrencyCode: "USD",
				customAttributes: [],
			},
		],
	};
}

describe("Commerce projection & manual approval identity email validation (#466 Item 5)", () => {
	it("projects valid short email a@b.com and routes malformed customerEmail to needs_review/upstream_invalid without crashing", async () => {
		const h = await createProjectionHarness();

		const shortEmailIntentRes = await h.checkout.createIntent({
			organizationId: h.org.id,
			customerId: h.customer.id,
			sessionId: "sess-email",
			idempotencyKey: "idem-short-email",
			offeringId: h.offering.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			shopifyProductGid: h.offering.shopifyProductGid,
			shopifyVariantGid: h.offering.shopifyVariantGid,
			divisionId: h.division.id,
			divisionNameSnapshot: h.division.displayName,
			staffAccessConsent: false,
			amount: "50.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});
		if (shortEmailIntentRes.kind !== "created") {
			throw new Error("Expected intent");
		}

		// Direct helper checks: valid short emails pass, malformed non-emails throw
		const validShortOrder = buildSamplePaidOrder(
			"short-1",
			shortEmailIntentRes.intent.correlationId,
			"  A@B.COM ",
		);
		const grantInput = buildMembershipGrantInput({
			organizationId: h.org.id,
			intent: shortEmailIntentRes.intent,
			order: validShortOrder,
			timezone: "UTC",
			existingGrants: [],
		});
		expect(grantInput.verifiedIdentityEmail).toBe("a@b.com");

		for (const badEmail of ["12345678", "not-an-email"]) {
			expect(() =>
				buildMembershipGrantInput({
					organizationId: h.org.id,
					intent: shortEmailIntentRes.intent,
					order: buildSamplePaidOrder(
						"bad-helper",
						shortEmailIntentRes.intent.correlationId,
						badEmail,
					),
					timezone: "UTC",
					existingGrants: [],
				}),
			).toThrow("Verified Shopify identity email is required.");
		}

		// Webhook projection with valid short email "a@b.com" creates active grant
		h.ordersByGid.set(validShortOrder.id, validShortOrder);
		const shortDelivery = await h.commerce.recordDelivery({
			organizationId: h.org.id,
			shopDomain: "email-org.myshopify.com",
			webhookId: "wh-short-ok",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: validShortOrder.id,
			payloadSha256: "a".repeat(64),
			receivedAtIso: NOW.toISOString(),
		});
		if (shortDelivery.kind !== "accepted") throw new Error("Expected delivery");
		expect(await h.service.processDelivery(shortDelivery.delivery.id)).toBe(
			"processed",
		);
		const grants = await h.organizations.listEntitlementGrantSnapshots(
			h.org.id,
			h.customer.id,
		);
		expect(grants).toHaveLength(1);
		expect(grants[0].status).toBe("active");

		// Malformed webhook emails ("12345678", "not-an-email", undefined) route to needs_review / upstream_invalid instead of crashing
		const h2 = await createProjectionHarness();
		for (const [idx, malformed] of [
			"12345678",
			"not-an-email",
			undefined,
		].entries()) {
			const badIntentRes = await h2.checkout.createIntent({
				organizationId: h2.org.id,
				customerId: h2.customer.id,
				sessionId: "sess-email",
				idempotencyKey: `idem-malformed-${idx}`,
				offeringId: h2.offering.id,
				entitlementClass: "teacher_membership",
				durationDays: 365,
				shopifyProductGid: h2.offering.shopifyProductGid,
				shopifyVariantGid: h2.offering.shopifyVariantGid,
				divisionId: h2.division.id,
				divisionNameSnapshot: h2.division.displayName,
				staffAccessConsent: false,
				amount: "50.00",
				currencyCode: "USD",
				expiresAtIso: "2030-01-01T00:00:00.000Z",
			});
			if (badIntentRes.kind !== "created") throw new Error("Expected intent");
			const badOrder = buildSamplePaidOrder(
				`malformed-${idx}`,
				badIntentRes.intent.correlationId,
				malformed,
			);
			h2.ordersByGid.set(badOrder.id, badOrder);
			const badDelivery = await h2.commerce.recordDelivery({
				organizationId: h2.org.id,
				shopDomain: "email-org.myshopify.com",
				webhookId: `wh-malformed-${idx}`,
				topic: "orders/paid",
				apiVersion: "2026-07",
				shopifyOrderGid: badOrder.id,
				payloadSha256: `${idx}`.repeat(64).slice(0, 64),
				receivedAtIso: NOW.toISOString(),
			});
			if (badDelivery.kind !== "accepted") throw new Error("Expected delivery");
			expect(await h2.service.processDelivery(badDelivery.delivery.id)).toBe(
				"processed",
			);

			await expect(
				h2.service.prepareManualApproval(h2.org.id, badOrder.id),
			).rejects.toMatchObject({
				status: 422,
				message: "Order cannot be manually approved: upstream_invalid.",
			});
		}

		const decisions = await h2.commerce.listCustomerDecisions(
			h2.org.id,
			h2.customer.id,
		);
		expect(decisions).toHaveLength(3);
		for (const d of decisions) {
			expect(d.status).toBe("needs_review");
			expect(d.reasonCode).toBe("upstream_invalid");
		}
	});

	integrationTest(
		"enforces normalizeVerifiedShopifyIdentityEmail in Postgres insertManualApprovalGrantTx",
		async () => {
			const schema = await currentSchema();
			try {
				const orgId = randomUUID();
				const adminUserId = randomUUID();
				const customerId = randomUUID();
				const divisionId = randomUUID();
				const offeringId = `prod-${randomUUID()}`;
				const intentId = randomUUID();

				await sql.unsafe(
					`INSERT INTO ${schema}.organizations (id, name, slug) VALUES ($1, $2, $3)`,
					[orgId, "Manual Email Org", `manual-email-${orgId}`],
				);
				await sql.unsafe(
					`INSERT INTO ${schema}.organization_divisions (id, organization_id, display_name, normalized_name, display_order)
					 VALUES ($1, $2, 'Piano', 'piano', 0)`,
					[divisionId, orgId],
				);
				await sql.unsafe(
					`INSERT INTO ${schema}.users (id, firebase_uid, email, display_name)
					 VALUES ($1, $2, $3, 'Admin')`,
					[
						adminUserId,
						`fb-${adminUserId}`,
						`admin-${adminUserId}@example.com`,
					],
				);
				await sql.unsafe(
					`INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at)
					 VALUES ($1, $2, $3, NOW(), NOW())`,
					[customerId, orgId, `gid://shopify/Customer/${customerId}`],
				);
				await sql.unsafe(
					`INSERT INTO ${schema}.products (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot)
					 VALUES ($1, $2, 'membership', 'teacher_membership', 365, 'gid://shopify/Product/m1', 'gid://shopify/Variant/m1', 'Teacher Membership')`,
					[offeringId, orgId],
				);
				await sql.unsafe(
					`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at)
					 VALUES ($1, $2, $3, $4, $5, $6, 'membership', 'gid://shopify/Product/m1', 'gid://shopify/Variant/m1', '50.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour')`,
					[
						intentId,
						randomUUID(),
						orgId,
						customerId,
						randomUUID(),
						randomUUID(),
					],
				);

				const orderRepo = new PostgresOrderProjectionRepository(schema);
				const pending = await orderRepo.recordPendingDecision({
					organizationId: orgId,
					shopifyOrderGid: "gid://shopify/Order/manual-email-1",
					updatedAtIso: "2026-09-01T18:00:00.000Z",
				});

				const baseGrant = {
					organizationId: orgId,
					customerId,
					offeringId,
					entitlementClass: "teacher_membership" as const,
					durationDays: 365,
					divisionId,
					divisionNameSnapshot: "Piano",
					paidAmount: "50.00",
					paidCurrencyCode: "USD",
					checkoutIntentId: intentId,
					shopifyOrderGid: "gid://shopify/Order/manual-email-1",
					shopifyOrderLineGid: "gid://shopify/LineItem/manual-email-1",
					startsOn: "2026-09-01",
					endsOn: "2027-09-01",
					status: "active" as const,
				};

				// Malformed emails ("12345678", "not-an-email", "") must be rejected
				for (const invalidEmail of ["12345678", "not-an-email", ""]) {
					await expect(
						orderRepo.resolveDecisionManually({
							organizationId: orgId,
							decisionId: pending.id,
							finalStatus: "approved",
							actorUserId: adminUserId,
							note: "Attempt with invalid email",
							resolvedAtIso: "2026-09-01T18:05:00.000Z",
							customerId,
							checkoutIntentId: intentId,
							shopifyOrderLineGid: baseGrant.shopifyOrderLineGid,
							grant: {
								...baseGrant,
								verifiedIdentityEmail: invalidEmail,
							},
						}),
					).rejects.toThrow("Verified Shopify identity email is required.");
				}

				const emailRowsBefore = (await sql.unsafe(
					`SELECT normalized_email FROM ${schema}.membership_identity_emails WHERE organization_id = $1`,
					[orgId],
				)) as Array<{ normalized_email: string }>;
				expect(emailRowsBefore).toHaveLength(0);

				// Valid short email "  A@B.COM " normalizes to "a@b.com" and persists cleanly
				const approved = await orderRepo.resolveDecisionManually({
					organizationId: orgId,
					decisionId: pending.id,
					finalStatus: "approved",
					actorUserId: adminUserId,
					note: "Approved with valid short email",
					resolvedAtIso: "2026-09-01T18:06:00.000Z",
					customerId,
					checkoutIntentId: intentId,
					shopifyOrderLineGid: baseGrant.shopifyOrderLineGid,
					grant: {
						...baseGrant,
						verifiedIdentityEmail: "  A@B.COM ",
					},
				});
				expect(approved.decision.status).toBe("approved");
				expect(approved.grant).toBeDefined();

				const emailRowsAfter = (await sql.unsafe(
					`SELECT normalized_email FROM ${schema}.membership_identity_emails WHERE organization_id = $1`,
					[orgId],
				)) as Array<{ normalized_email: string }>;
				expect(emailRowsAfter).toEqual([{ normalized_email: "a@b.com" }]);
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
