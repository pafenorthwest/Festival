import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { initializePostgresSchema } from "../src/repo/postgres-schema.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

integrationTest(
	"initializes an empty PostgreSQL schema twice with its final catalog",
	async () => {
		const schema = `contract_${randomUUID().replaceAll("-", "")}`;
		try {
			await initializePostgresSchema(schema);
			await initializePostgresSchema(schema);

			const tables = (await sql.unsafe(
				"SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
				[schema],
			)) as Array<{ tablename: string }>;
			expect(tables.map((row) => row.tablename)).toEqual(
				expect.arrayContaining([
					"organizations",
					"festivals",
					"festival_children",
					"festival_child_age_snapshots",
					"products",
					"checkout_intents",
					"membership_entitlements",
					"membership_entitlement_divisions",
					"membership_entitlement_cohorts",
					"membership_identity_emails",
				]),
			);
			const festivalColumns = (await sql.unsafe(
				"SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'festivals'",
				[schema],
			)) as Array<{ column_name: string }>;
			expect(festivalColumns.map((row) => row.column_name)).toEqual(
				expect.arrayContaining(["short_name", "is_primary"]),
			);
			const trigger = (await sql.unsafe(
				"SELECT 1 FROM pg_trigger WHERE tgrelid = ($1 || '.shopify_integrations')::regclass AND tgname = 'enforce_shopify_shop_ownership'",
				[schema],
			)) as Array<Record<string, unknown>>;
			expect(trigger).toHaveLength(1);

			await sql.unsafe(
				`INSERT INTO ${schema}.organizations (id, name, slug) VALUES ('org', 'Organization', 'org');
			 INSERT INTO ${schema}.organization_divisions (id, organization_id, display_name, normalized_name, display_order) VALUES ('division', 'org', 'Division', 'division', 0);
			 INSERT INTO ${schema}.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date) VALUES ('festival', 'org', 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02');
			 INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES ('customer', 'org', 'gid://shopify/Customer/1', NOW(), NOW());
			 INSERT INTO ${schema}.festival_children (id, organization_id, parent_customer_id, display_name, created_at) VALUES ('child', 'org', 'customer', 'Child', NOW());
			 INSERT INTO ${schema}.festival_child_age_snapshots (id, child_id, organization_id, age, created_at, valid_until) VALUES ('snapshot', 'child', 'org', 10, NOW(), NOW() + INTERVAL '90 days');`,
			);
		} finally {
			await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		}
	},
);

integrationTest(
	"requires and atomically binds verified identity email for Teacher entitlements",
	async () => {
		const schema = `identity_${randomUUID().replaceAll("-", "")}`;
		try {
			await initializePostgresSchema(schema);
			await sql.unsafe(
				`INSERT INTO ${schema}.organizations (id, name, slug) VALUES ('org', 'Organization', 'org');
				 INSERT INTO ${schema}.organization_divisions (id, organization_id, display_name, normalized_name, display_order) VALUES ('division', 'org', 'Division', 'division', 0);
				 INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES ('customer-1', 'org', 'gid://shopify/Customer/1', NOW(), NOW()), ('customer-2', 'org', 'gid://shopify/Customer/2', NOW(), NOW());
				 INSERT INTO ${schema}.products (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot) VALUES ('teacher', 'org', 'membership', 'teacher_membership', 365, 'gid://shopify/Product/1', 'gid://shopify/ProductVariant/1', 'Teacher Membership');`,
			);
			const repository = new PostgresOrganizationRepository(schema);
			const input = {
				organizationId: "org",
				entitlementClass: "teacher_membership" as const,
				offeringId: "teacher",
				durationDays: 365,
				divisionId: "division",
				divisionNameSnapshot: "Division",
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				startsOn: "2026-01-01",
				endsOn: "2027-01-01",
				status: "active" as const,
				verifiedIdentityEmail: "Shopper@Example.com",
			};
			await repository.createEntitlementGrantSnapshot({
				...input,
				customerId: "customer-1",
				checkoutIntentId: "checkout-1",
				shopifyOrderGid: "gid://shopify/Order/1",
				shopifyOrderLineGid: "gid://shopify/LineItem/1",
			});
			await expect(
				repository.createEntitlementGrantSnapshot({
					...input,
					customerId: "customer-2",
					verifiedIdentityEmail: "shopper@example.com",
					checkoutIntentId: "checkout-2",
					shopifyOrderGid: "gid://shopify/Order/2",
					shopifyOrderLineGid: "gid://shopify/LineItem/2",
				}),
			).rejects.toThrow("identity email belongs to another customer");
			await expect(
				repository.createEntitlementGrantSnapshot({
					...input,
					customerId: "customer-2",
					checkoutIntentId: "checkout-3",
					shopifyOrderGid: "gid://shopify/Order/3",
					shopifyOrderLineGid: "gid://shopify/LineItem/3",
					verifiedIdentityEmail: " ",
				}),
			).rejects.toThrow("Verified Shopify identity email is required");
		} finally {
			await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		}
	},
);
