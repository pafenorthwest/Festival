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

test("canonical PostgreSQL schema rejects unsafe schema identifiers", () => {
	expect(() => postgresSchemaName("orgs; DROP SCHEMA orgs")).toThrow(
		"Database schema is invalid.",
	);
});
