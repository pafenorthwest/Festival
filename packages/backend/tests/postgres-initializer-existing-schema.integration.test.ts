import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { initializePostgresSchema } from "../src/repo/postgres-schema.js";

const schema = `it_initializer_${randomUUID().replaceAll("-", "")}`;
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
let schemaCreated = false;

afterAll(async () => {
	if (!schemaCreated) return;
	await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
});

integrationTest(
	"initializes current tables over baseline parents without composite unique keys",
	async () => {
		await sql.unsafe(`CREATE SCHEMA ${schema}`);
		schemaCreated = true;
		await sql.unsafe(`
			CREATE TABLE ${schema}.organizations (id TEXT PRIMARY KEY);
			CREATE TABLE ${schema}.registration_catalog_values (
				id TEXT PRIMARY KEY,
				organization_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				display_name TEXT NOT NULL,
				normalized_name TEXT NOT NULL,
				is_active BOOLEAN NOT NULL DEFAULT TRUE,
				display_order INTEGER NOT NULL,
				required_subtype_id TEXT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
			CREATE TABLE ${schema}.checkout_intents (
				id TEXT PRIMARY KEY,
				correlation_id TEXT NOT NULL,
				organization_id TEXT NOT NULL,
				customer_id TEXT NOT NULL,
				session_id TEXT NOT NULL,
				idempotency_key TEXT NOT NULL,
				intent_type TEXT NOT NULL DEFAULT 'membership',
				offering_id TEXT,
				entitlement_class TEXT,
				duration_days INTEGER,
				festival_class_id TEXT,
				child_id TEXT,
				shopify_product_gid TEXT NOT NULL,
				shopify_variant_gid TEXT NOT NULL,
				policy_version TEXT,
				division_id TEXT,
				division_name_snapshot TEXT,
				staff_access_consent BOOLEAN NOT NULL DEFAULT FALSE,
				amount TEXT NOT NULL,
				currency_code TEXT NOT NULL,
				line_identity_protocol TEXT,
				cart_reference TEXT,
				status TEXT NOT NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		await initializePostgresSchema(schema);

		const rows = await sql.unsafe(
			`SELECT to_regclass($1) AS subtypes, to_regclass($2) AS recovery_requests`,
			[
				`${schema}.festival_class_subtypes`,
				`${schema}.checkout_recovery_requests`,
			],
		);
		expect(rows[0]).toEqual({
			subtypes: `${schema}.festival_class_subtypes`,
			recovery_requests: `${schema}.checkout_recovery_requests`,
		});
	},
);
