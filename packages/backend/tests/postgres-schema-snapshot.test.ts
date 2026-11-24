import { expect, test } from "bun:test";
import { buildCanonicalPostgresSchemaSql } from "../src/repo/postgres-schema.js";

const schemaDump = Bun.file(
	new URL("../../../database/postgres17-schema.sql", import.meta.url),
);

test("keeps the schema dump portable and free of application rows", async () => {
	const snapshot = await schemaDump.text();
	expect(snapshot).toContain("-- PostgreSQL database dump complete");
	expect(snapshot).not.toMatch(
		/\\(?:un)?restrict |OWNER TO |^COPY .* FROM stdin;|^INSERT INTO /m,
	);
});

test("includes the same tables as the runtime schema", async () => {
	const tableNames = (sql: string) =>
		Array.from(
			sql.matchAll(/^\s*CREATE TABLE (?:IF NOT EXISTS )?(orgs\.\w+)\s*\(/gm),
			([, name]) => name,
		).sort();

	expect(tableNames(await schemaDump.text())).toEqual(
		tableNames(buildCanonicalPostgresSchemaSql("orgs")),
	);
});

test("includes the exact same index names as the runtime schema", async () => {
	const indexNames = (sql: string) =>
		Array.from(
			sql.matchAll(
				/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\b/gm,
			),
			([, name]) => name,
		).sort();

	expect(indexNames(buildCanonicalPostgresSchemaSql("orgs"))).toEqual(
		indexNames(await schemaDump.text()),
	);
});
