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
		"class_entitlements",
		"membership_entitlements",
		"membership_entitlement_divisions",
		"membership_entitlement_revocations",
		"membership_entitlement_cohorts",
		"membership_identity_emails",
		"teacher_membership_entitlement_details",
		"accompanist_membership_entitlement_details",
		"shopify_webhook_deliveries",
		"app_user",
		"volunteers",
		"volunteer_roles",
		"volunteer_shifts",
		"volunteer_assignments",
	]) {
		expect(schema).toContain(`fresh_orgs.${table}`);
	}
	expect(schema).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
	expect(schema).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
	expect(schema).toContain("EXCLUDE USING gist");
	expect(schema).not.toContain("entitlement_grants");
	expect(schema).not.toContain("accompanist_membership_grants");
	expect(schema).toContain("enforce_shopify_shop_ownership");
	expect(schema).not.toMatch(
		/ALTER TABLE|DROP (?:COLUMN|CONSTRAINT|INDEX)|\n\s*(?:INSERT INTO|UPDATE [A-Za-z_])/,
	);
});

test("canonical PostgreSQL schema enforces one active volunteer assignment per shift", () => {
	const schema = buildCanonicalPostgresSchemaSql("fresh_orgs");

	expect(schema).toContain(
		"volunteer_assignments_active_shift_key ON fresh_orgs.volunteer_assignments (shift_id) WHERE status = 'active'",
	);
});

test("canonical PostgreSQL schema requires a volunteer role display name and scopes volunteer work to a festival", () => {
	const schema = buildCanonicalPostgresSchemaSql("fresh_orgs");

	expect(schema).toContain("slug TEXT NOT NULL, display_name TEXT NOT NULL");
	expect(schema).toContain(
		"festival_id TEXT NOT NULL REFERENCES fresh_orgs.festivals (id) ON DELETE CASCADE",
	);
	expect(schema).toContain(
		"FOREIGN KEY (role_id, festival_id, organization_id) REFERENCES fresh_orgs.volunteer_roles (id, festival_id, organization_id) ON DELETE CASCADE",
	);
	expect(schema).toContain(
		"FOREIGN KEY (volunteer_id, festival_id, organization_id) REFERENCES fresh_orgs.volunteers (id, festival_id, organization_id) ON DELETE CASCADE",
	);
});

test("canonical PostgreSQL schema rejects unsafe schema identifiers", () => {
	expect(() => postgresSchemaName("orgs; DROP SCHEMA orgs")).toThrow(
		"Database schema is invalid.",
	);
});
