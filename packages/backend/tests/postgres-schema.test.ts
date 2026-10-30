import { expect, test } from "bun:test";
import {
	buildCanonicalPostgresSchemaSql,
	postgresSchemaName,
} from "../src/repo/postgres-schema.js";

test("canonical PostgreSQL bootstrap contains no legacy migrations or row mutations", () => {
	const schema = buildCanonicalPostgresSchemaSql("fresh_orgs");
	expect(schema).not.toMatch(
		/ALTER TABLE|DROP (?:COLUMN|CONSTRAINT|INDEX)|\n\s*(?:INSERT INTO|UPDATE [A-Za-z_])/,
	);
});

test("canonical PostgreSQL schema scopes profile divisions to the profile organization", () => {
	const schema = buildCanonicalPostgresSchemaSql("fresh_orgs");

	for (const kind of ["teacher", "accompanist"]) {
		expect(schema).toContain(
			`CREATE TABLE IF NOT EXISTS fresh_orgs.${kind}_profile_divisions (\n\t\t\t${kind}_profile_id TEXT NOT NULL,\n\t\t\torganization_id TEXT NOT NULL REFERENCES fresh_orgs.organizations (id) ON DELETE CASCADE,`,
		);
		expect(schema).toContain(
			`FOREIGN KEY (${kind}_profile_id, organization_id) REFERENCES fresh_orgs.${kind}_profiles (id, organization_id) ON DELETE CASCADE`,
		);
		expect(schema).toContain(
			"FOREIGN KEY (division_id, organization_id) REFERENCES fresh_orgs.organization_divisions (id, organization_id) ON DELETE CASCADE",
		);
	}
});

test("canonical PostgreSQL schema rejects unsafe schema identifiers", () => {
	expect(() => postgresSchemaName("orgs; DROP SCHEMA orgs")).toThrow(
		"Database schema is invalid.",
	);
});

test("canonical PostgreSQL schema defines waitlist tables and indexes", () => {
	const schema = buildCanonicalPostgresSchemaSql("fresh_orgs");
	expect(schema).toContain(
		"CREATE TABLE IF NOT EXISTS fresh_orgs.festival_class_waitlist_entries",
	);
	expect(schema).toContain(
		"CREATE TABLE IF NOT EXISTS fresh_orgs.festival_class_waitlist_events",
	);
	expect(schema).toContain(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_entries_active_unique",
	);
	expect(schema).toContain(
		"CREATE INDEX IF NOT EXISTS idx_waitlist_entries_admin_roster",
	);
	expect(schema).toContain(
		"CREATE INDEX IF NOT EXISTS idx_waitlist_entries_parent_lookup",
	);
	expect(schema).toContain(
		"CREATE INDEX IF NOT EXISTS idx_waitlist_events_entry",
	);
	expect(schema).toContain(
		"CREATE INDEX IF NOT EXISTS idx_waitlist_events_class",
	);
});
