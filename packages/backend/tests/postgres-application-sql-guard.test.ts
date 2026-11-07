import { expect, test } from "bun:test";
import { assertApplicationFixtureSql } from "./postgres-application-sql-guard.js";

test("application rollback guard rejects commented and later transaction control or DDL", () => {
	for (const query of [
		"COMMIT",
		"/* note */ COMMIT",
		"-- note\nCREATE TABLE orgs.x(id text)",
		"SELECT 1; -- note\rCOMMIT",
		"SELECT 1; -- note\r\nCOMMIT",
		"SELECT 1 AS foo$tag$; COMMIT; SELECT 1 AS bar$tag$",
		"SELECT 1; /* note */ ALTER TABLE orgs.x ADD COLUMN y text",
		"SELECT 1; END",
		"SELECT 1; START TRANSACTION",
		"TRUNCATE orgs.x",
		"SELECT '; COMMIT'",
	])
		expect(() => assertApplicationFixtureSql(query)).toThrow();
});

test("application rollback guard accepts current repository SELECT/DML statements unchanged", () => {
	for (const query of [
		"SELECT id FROM orgs.x WHERE id=$1",
		"INSERT INTO orgs.x VALUES ($1); UPDATE orgs.x SET x=$2;",
		"DELETE FROM orgs.x WHERE id=$1",
		"WITH selected AS (SELECT 1) SELECT * FROM selected",
	])
		expect(() => assertApplicationFixtureSql(query)).not.toThrow();
});
