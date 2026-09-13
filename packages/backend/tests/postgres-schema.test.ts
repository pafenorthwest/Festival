import { expect, test } from "bun:test";
import {
	buildCanonicalPostgresSchemaSql,
	postgresSchemaName,
} from "../src/repo/postgres-schema.js";

test("canonical PostgreSQL schema defines the final empty-database shape only", () => {
	const schema = buildCanonicalPostgresSchemaSql("fresh_orgs");

	for (const table of [
		"organizations",
		"festivals",
		"festival_children",
		"festival_child_age_snapshots",
		"checkout_intents",
		"entitlement_grants",
		"shopify_webhook_deliveries",
		"app_user",
	]) {
		expect(schema).toContain(`fresh_orgs.${table}`);
	}
	expect(schema).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
	expect(schema).toContain("enforce_shopify_shop_ownership");
	expect(schema).not.toMatch(
		/ALTER TABLE|DROP (?:COLUMN|CONSTRAINT|INDEX)|\n\s*(?:INSERT INTO|UPDATE [A-Za-z_])/,
	);
});

test("canonical PostgreSQL schema rejects unsafe schema identifiers", () => {
	expect(() => postgresSchemaName("orgs; DROP SCHEMA orgs")).toThrow(
		"Database schema is invalid.",
	);
});
