import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import {
	buildCanonicalPostgresSchemaSql,
	initializePostgresSchema,
} from "../src/repo/postgres-schema.js";

if (process.env.POSTGRES_INTEGRATION_URL && !process.env.DATABASE_URL) {
	process.env.DATABASE_URL = process.env.POSTGRES_INTEGRATION_URL;
}

const schema = `it_initializer_${randomUUID().replaceAll("-", "")}`;
const missingSchema = `it_missing_${randomUUID().replaceAll("-", "")}`;
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
let schemaCreated = false;

afterAll(async () => {
	if (!process.env.POSTGRES_INTEGRATION_URL) return;
	await sql.unsafe(`DROP SCHEMA IF EXISTS ${missingSchema} CASCADE`);
	if (!schemaCreated) return;
	await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
});

integrationTest(
	"rejects missing schema or missing schema_migrations with zero DDL executed",
	async () => {
		await expect(initializePostgresSchema(missingSchema)).rejects.toThrow();

		const missingRows = await sql`
			SELECT schema_name
			FROM information_schema.schemata
			WHERE schema_name = ${missingSchema}
		`;
		expect(missingRows).toHaveLength(0);

		await sql.unsafe(`CREATE SCHEMA ${schema}`);
		schemaCreated = true;
		await sql.unsafe(
			`CREATE TABLE ${schema}.organizations (id TEXT PRIMARY KEY)`,
		);

		await expect(initializePostgresSchema(schema)).rejects.toThrow();

		const tables = await sql`
			SELECT tablename
			FROM pg_tables
			WHERE schemaname = ${schema}
			ORDER BY tablename
		`;
		expect(tables).toEqual([{ tablename: "organizations" }]);
	},
);

integrationTest(
	"succeeds on canonically provisioned schema without modifying pg_indexes or executing DDL",
	async () => {
		const restoredSchema = `it_restored_${randomUUID().replaceAll("-", "")}`;
		const referenceIndexes = () => sql`
			SELECT tablename, indexname, indexdef
			FROM pg_indexes
			WHERE schemaname = ${restoredSchema}
			ORDER BY tablename, indexname
		`;
		const schemaTables = () => sql`
			SELECT tablename
			FROM pg_tables
			WHERE schemaname = ${restoredSchema}
			ORDER BY tablename
		`;

		await sql.unsafe(`CREATE SCHEMA ${restoredSchema}`);
		try {
			await sql.unsafe(buildCanonicalPostgresSchemaSql(restoredSchema));
			const originalIndexes = await referenceIndexes();
			const originalTables = await schemaTables();

			await initializePostgresSchema(restoredSchema);

			expect(await referenceIndexes()).toEqual(originalIndexes);
			expect(await schemaTables()).toEqual(originalTables);
		} finally {
			await sql.unsafe(`DROP SCHEMA ${restoredSchema} CASCADE`);
		}
	},
);
