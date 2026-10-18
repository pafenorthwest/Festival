import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import {
	type ClassEntitlementFilter,
	PostgresClassEntitlementRepository,
} from "../src/commerce/class-entitlement-repository.js";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import { initializePostgresSchema } from "../src/repo/postgres-schema.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

for (const Repository of [
	PostgresClassEntitlementRepository,
	PostgresMembershipCommerceRepository,
]) {
	integrationTest(
		`${Repository.name} executes targeted entitlement filters against PostgreSQL`,
		async () => {
			const schema = `targeted_${randomUUID().replaceAll("-", "")}`;
			try {
				await initializePostgresSchema(schema);
				for (const org of ["org", "other-org"]) {
					await sql.unsafe(
						`INSERT INTO ${schema}.organizations (id, name, slug) VALUES ($1, $1, $1)`,
						[org],
					);
					await sql.unsafe(
						`INSERT INTO ${schema}.organization_divisions (id, organization_id, display_name, normalized_name, display_order) VALUES ($1 || '-division', $1, 'Piano', 'piano', 0)`,
						[org],
					);
					await sql.unsafe(
						`INSERT INTO ${schema}.registration_catalog_values (id, organization_id, kind, display_name, normalized_name, display_order) VALUES ($1 || '-subtype', $1, 'class_subtype', 'Classical', 'classical', 0)`,
						[org],
					);
					for (const festival of ["festival", "other-festival"]) {
						await sql.unsafe(
							`INSERT INTO ${schema}.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date) VALUES ($1 || '-' || $2, $1, $2, $2, $2 = 'festival', $2, '2027-01-01', '2027-01-02')`,
							[org, festival],
						);
					}
					for (const parent of ["parent", "other-parent"]) {
						await sql.unsafe(
							`INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES ($1 || '-' || $2, $1, 'gid://shopify/Customer/' || $1 || '-' || $2, NOW(), NOW())`,
							[org, parent],
						);
					}
					for (const child of ["a", "b", "c"]) {
						await sql.unsafe(
							`INSERT INTO ${schema}.festival_children (id, organization_id, parent_customer_id, display_name, created_at) VALUES ($1 || '-child-' || $2, $1, $1 || CASE WHEN $2 = 'c' THEN '-other-parent' ELSE '-parent' END, $2, NOW())`,
							[org, child],
						);
					}
					for (const classId of ["a", "b", "c"]) {
						await sql.unsafe(
							`INSERT INTO ${schema}.festival_class_configurations (id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, shopify_product_gid, shopify_variant_gid) VALUES ($1 || '-class-' || $2, $1, $1 || CASE WHEN $2 = 'c' THEN '-other-festival' ELSE '-festival' END, $2, $1 || '-subtype', $1 || '-division', 5, 18, '50.00', 2, 10, 20, 'gid://shopify/Product/' || $1 || $2, 'gid://shopify/ProductVariant/' || $1 || $2)`,
							[org, classId],
						);
					}
					await sql.unsafe(
						`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) VALUES ($1 || '-intent', $1 || '-correlation', $1, $1 || '-parent', 'session', 'key', 'class_entry', 'product', 'variant', '50.00', 'USD', 'approved', NOW() + INTERVAL '1 hour')`,
						[org],
					);
					for (const [classId, child, status] of [
						["a", "a", "confirmed"],
						["a", "b", "confirmed"],
						["b", "a", "waitlisted"],
						["b", "b", "confirmed"],
						["a", "c", "confirmed"],
						["c", "a", "confirmed"],
					]) {
						await sql.unsafe(
							`INSERT INTO ${schema}.class_entitlements (id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status) VALUES ($1 || '-' || $2 || $3, $1, $1 || CASE WHEN $2 = 'c' THEN '-other-festival' ELSE '-festival' END, $1 || '-class-' || $2, $1 || CASE WHEN $3 = 'c' THEN '-other-parent' ELSE '-parent' END, $1 || '-child-' || $3, $1 || '-intent', 'order', $1 || '-line-' || $2 || $3, 5000, 'USD', $4)`,
							[org, classId, child, status],
						);
					}
				}

				const repository = new Repository(schema);
				const ids = async (filter: ClassEntitlementFilter) =>
					(await repository.listClassEntitlements(filter))
						.map((row) => row.id)
						.sort();
				const scope = { organizationId: "org" };
				expect(await ids(scope)).toHaveLength(6);
				expect(
					await ids({ ...scope, festivalClassIds: ["org-class-a"] }),
				).toEqual(["org-aa", "org-ab", "org-ac"]);
				expect(
					await ids({
						...scope,
						festivalClassIds: ["org-class-a", "org-class-b"],
					}),
				).toEqual(["org-aa", "org-ab", "org-ac", "org-ba", "org-bb"]);
				expect(await ids({ ...scope, festivalClassIds: [] })).toEqual([]);
				expect(await ids({ ...scope, childIds: ["org-child-a"] })).toEqual([
					"org-aa",
					"org-ba",
					"org-ca",
				]);
				expect(
					await ids({ ...scope, childIds: ["org-child-a", "org-child-b"] }),
				).toEqual(["org-aa", "org-ab", "org-ba", "org-bb", "org-ca"]);
				expect(await ids({ ...scope, childIds: [] })).toEqual([]);
				expect(
					await ids({
						...scope,
						festivalClassIds: ["org-class-a", "org-class-b"],
						childIds: ["org-child-b"],
					}),
				).toEqual(["org-ab", "org-bb"]);
				expect(
					await ids({
						...scope,
						festivalClassIds: [
							"org-class-a",
							"org-class-b",
							"org-class-c",
							"other-org-class-a",
						],
						childIds: [
							"org-child-a",
							"org-child-b",
							"org-child-c",
							"other-org-child-a",
						],
						festivalId: "org-festival",
						parentCustomerId: "org-parent",
						status: "confirmed",
					}),
				).toEqual(["org-aa", "org-ab", "org-bb"]);
				expect(
					await ids({
						...scope,
						festivalClassIds: ["org-class-a"],
						festivalClassId: "org-class-b",
					}),
				).toEqual([]);
				expect(
					await ids({
						...scope,
						childIds: ["org-child-a"],
						childId: "org-child-b",
					}),
				).toEqual([]);
			} finally {
				await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
			}
		},
	);
}
