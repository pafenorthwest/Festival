import { expect, test } from "bun:test";
import { sql } from "bun";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";

import { withApplicationRollback } from "./postgres-application-fixture.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

integrationTest(
	"requires and atomically binds verified identity email for Teacher entitlements",
	async () => {
		await withApplicationRollback(async (fixture) => {
			const schema = fixture.schema;
			await sql.unsafe(
				`INSERT INTO ${schema}.organizations (id, name, slug) VALUES ('${fixture.id("org")}', '${fixture.id("Organization")}', '${fixture.id("org")}');
				 INSERT INTO ${schema}.organization_divisions (id, organization_id, display_name, normalized_name, display_order) VALUES ('${fixture.id("division")}', '${fixture.id("org")}', 'Division', '${fixture.id("division")}', 0);
				 INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES ('${fixture.id("customer-1")}', '${fixture.id("org")}', 'gid://shopify/Customer/${fixture.id("Customer-1")}', NOW(), NOW()), ('${fixture.id("customer-2")}', '${fixture.id("org")}', 'gid://shopify/Customer/${fixture.id("Customer-2")}', NOW(), NOW());
				 INSERT INTO ${schema}.products (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot) VALUES ('${fixture.id("teacher")}', '${fixture.id("org")}', 'membership', 'teacher_membership', 365, 'gid://shopify/Product/${fixture.id("Product-1")}', 'gid://shopify/ProductVariant/${fixture.id("ProductVariant-1")}', 'Teacher Membership');`,
			);
			const repository = fixture.repository(
				new PostgresOrganizationRepository(schema),
			);
			const input = {
				organizationId: fixture.id("org"),
				entitlementClass: "teacher_membership" as const,
				offeringId: fixture.id("teacher"),
				durationDays: 365,
				divisionId: fixture.id("division"),
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
				customerId: fixture.id("customer-1"),
				checkoutIntentId: fixture.id("checkout-1"),
				shopifyOrderGid: `gid://shopify/Order/${fixture.id("Order-1")}`,
				shopifyOrderLineGid: `gid://shopify/LineItem/${fixture.id("LineItem-1")}`,
			});
			await expect(
				repository.createEntitlementGrantSnapshot({
					...input,
					customerId: fixture.id("customer-2"),
					verifiedIdentityEmail: "shopper@example.com",
					checkoutIntentId: fixture.id("checkout-2"),
					shopifyOrderGid: `gid://shopify/Order/${fixture.id("Order-2")}`,
					shopifyOrderLineGid: `gid://shopify/LineItem/${fixture.id("LineItem-2")}`,
				}),
			).rejects.toThrow("identity email belongs to another customer");
			await expect(
				repository.createEntitlementGrantSnapshot({
					...input,
					customerId: fixture.id("customer-2"),
					checkoutIntentId: fixture.id("checkout-3"),
					shopifyOrderGid: `gid://shopify/Order/${fixture.id("Order-3")}`,
					shopifyOrderLineGid: `gid://shopify/LineItem/${fixture.id("LineItem-3")}`,
					verifiedIdentityEmail: " ",
				}),
			).rejects.toThrow("Verified Shopify identity email is required");
		});
	},
);
