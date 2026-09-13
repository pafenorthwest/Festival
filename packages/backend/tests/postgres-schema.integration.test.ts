import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
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
					"entitlement_grants",
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
