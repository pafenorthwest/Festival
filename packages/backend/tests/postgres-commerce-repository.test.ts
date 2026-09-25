import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { PostgresCheckoutRepository } from "../src/checkout/postgres-checkout-repository.js";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import { initializePostgresSchema } from "../src/repo/postgres-schema.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

integrationTest(
	"links registration_metadata.class_entitlement_id when finalizeDecision creates a class entitlement",
	async () => {
		const schema = `commerce_${randomUUID().replaceAll("-", "")}`;
		try {
			await initializePostgresSchema(schema);

			// Seed required fixtures
			const orgId = randomUUID();
			const festivalId = randomUUID();
			const festivalClassId = randomUUID();
			const customerId = randomUUID();
			const childId = randomUUID();
			const checkoutIntentId = randomUUID();
			const webhookId = randomUUID();
			const membershipId = randomUUID();
			const divisionId = randomUUID();
			const subtypeId = randomUUID();

			const insertOrganization = sql`INSERT INTO ${sql(`${schema}.organizations`)} (id, name, slug) VALUES (${orgId}, 'Test Org', 'test-org')`;
			await insertOrganization;
			const insertDivision = sql`INSERT INTO ${sql(`${schema}.organization_divisions`)} (id, organization_id, display_name, normalized_name, display_order) VALUES (${divisionId}, ${orgId}, 'Piano', 'piano', 0)`;
			await insertDivision;
			const insertFestival = sql`INSERT INTO ${sql(`${schema}.festivals`)} (id, organization_id, code, short_name, is_primary, name, start_date, end_date) VALUES (${festivalId}, ${orgId}, 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02')`;
			await insertFestival;
			const insertCustomer = sql`INSERT INTO ${sql(`${schema}.festival_customers`)} (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES (${customerId}, ${orgId}, 'gid://shopify/Customer/1', NOW(), NOW())`;
			await insertCustomer;
			const insertChild = sql`INSERT INTO ${sql(`${schema}.festival_children`)} (id, organization_id, parent_customer_id, display_name, created_at) VALUES (${childId}, ${orgId}, ${customerId}, 'Child One', NOW())`;
			await insertChild;
			const insertClassSubtype = sql`INSERT INTO ${sql(`${schema}.registration_catalog_values`)} (id, organization_id, kind, display_name, normalized_name, display_order) VALUES (${subtypeId}, ${orgId}, 'class_subtype', 'Classical', 'classical', 0)`;
			await insertClassSubtype;
			const insertFestivalClassConfiguration = sql`INSERT INTO ${sql(`${schema}.festival_class_configurations`)} (id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, shopify_product_gid, shopify_variant_gid) VALUES (${festivalClassId}, ${orgId}, ${festivalId}, 'Class A', ${subtypeId}, ${divisionId}, 5, 18, '50.00', 2, 10, 20, 'gid://shopify/Product/class', 'gid://shopify/ProductVariant/class')`;
			await insertFestivalClassConfiguration;

			// Seed a membership_entitlements row so registration_metadata FK is satisfied
			const insertTeacherMembershipProduct = sql`INSERT INTO ${sql(`${schema}.products`)} (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot) VALUES ('product-teacher', ${orgId}, 'membership', 'teacher_membership', 365, 'gid://shopify/Product/teacher', 'gid://shopify/ProductVariant/teacher', 'Teacher Membership')`;
			await insertTeacherMembershipProduct;
			const insertMembershipEntitlement = sql`INSERT INTO ${sql(`${schema}.membership_entitlements`)} (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on) VALUES (${membershipId}, ${orgId}, ${customerId}, 'teacher_membership', 'teacher_checkout', 'product-teacher', '2026-01-01', '2027-01-01')`;
			await insertMembershipEntitlement;

			// Insert a checkout_intent of type class_entry
			await sql.unsafe(
				`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) VALUES ($1, $2, $3, $4, 'sess-1', 'idem-1', 'class_entry', $5, $6, 'gid://shopify/Product/class', 'gid://shopify/ProductVariant/class', '50.00', 'USD', 'checkout_started', NOW() + INTERVAL '1 hour')`,
				[
					checkoutIntentId,
					randomUUID(),
					orgId,
					customerId,
					festivalClassId,
					childId,
				],
			);

			const checkoutRepo = new PostgresCheckoutRepository(schema);
			const commerceRepo = new PostgresMembershipCommerceRepository(schema);

			// Insert registration_metadata via CheckoutRepository
			const metadataId = randomUUID();
			const metadata = await checkoutRepo.insertRegistrationMetadata({
				id: metadataId,
				organizationId: orgId,
				festivalId: festivalId,
				checkoutIntentId: checkoutIntentId,
				teacherMembershipId: membershipId,
				accompanistMembershipId: null,
				repertoireJson: [
					{
						title: "Sonata in C",
						composer: "Mozart",
						durationSeconds: 240,
					},
				],
			});

			expect(metadata.id).toBe(metadataId);
			expect(metadata.classEntitlementId).toBeNull();

			// Record a webhook delivery
			const deliveryResult = await commerceRepo.recordDelivery({
				organizationId: orgId,
				shopDomain: "example.myshopify.com",
				webhookId: webhookId,
				topic: "orders/paid",
				apiVersion: "2026-07",
				shopifyOrderGid: "gid://shopify/Order/1",
				payloadSha256: "a".repeat(64),
				receivedAtIso: new Date().toISOString(),
			});
			if (deliveryResult.kind !== "accepted")
				throw new Error("Expected accepted delivery");
			const claimed = await commerceRepo.claimDelivery(
				deliveryResult.delivery.id,
			);
			if (!claimed) throw new Error("Expected claimed delivery");

			// finalizeDecision with an approved class_entry
			const entitlementId = randomUUID();
			const result = await commerceRepo.finalizeDecision({
				deliveryId: claimed.id,
				decision: {
					organizationId: orgId,
					customerId: customerId,
					checkoutIntentId: checkoutIntentId,
					shopifyOrderGid: "gid://shopify/Order/1",
					shopifyOrderLineGid: "gid://shopify/LineItem/1",
					status: "approved",
				},
				classEntitlement: {
					id: entitlementId,
					organizationId: orgId,
					festivalId: festivalId,
					festivalClassId: festivalClassId,
					parentCustomerId: customerId,
					childId: childId,
					checkoutIntentId: checkoutIntentId,
					shopifyOrderGid: "gid://shopify/Order/1",
					shopifyOrderLineGid: "gid://shopify/LineItem/1",
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "confirmed",
				},
			});

			expect(result.existing).toBe(false);
			expect(result.classEntitlement?.id).toBe(entitlementId);

			// Assert that registration_metadata.class_entitlement_id is now populated
			const rows = (await sql.unsafe(
				`SELECT class_entitlement_id FROM ${schema}.registration_metadata WHERE id = $1`,
				[metadataId],
			)) as Array<{ class_entitlement_id: string | null }>;
			expect(rows).toHaveLength(1);
			expect(rows[0]?.class_entitlement_id).toBe(entitlementId);
		} finally {
			await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		}
	},
);
