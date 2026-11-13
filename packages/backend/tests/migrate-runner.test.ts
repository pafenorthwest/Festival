import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "bun";

interface ParityModule {
	normalizePgDumpForParity(sqlText: string): string;
}

interface MigrateModule {
	computeMigrationChecksum(content: string): string;
	discoverMigrations(migrationsDir?: string): Array<{
		version: string;
		filename: string;
		path: string;
		sql: string;
		checksum: string;
	}>;
	runMigrations(options?: {
		databaseUrl?: string;
		schema?: string;
		migrationsDir?: string;
	}): Promise<{ applied: string[]; skipped: string[] }>;
}

const { normalizePgDumpForParity } = (await import(
	resolve(import.meta.dir, "../../../scripts/check-schema-parity.ts")
)) as ParityModule;

const { computeMigrationChecksum, discoverMigrations, runMigrations } =
	(await import(
		resolve(import.meta.dir, "../../../scripts/migrate.ts")
	)) as MigrateModule;

if (process.env.POSTGRES_INTEGRATION_URL && !process.env.DATABASE_URL) {
	process.env.DATABASE_URL = process.env.POSTGRES_INTEGRATION_URL;
}

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
const repoMigrationsDir = fileURLToPath(
	new URL("../../../database/migrations", import.meta.url),
);
const createdSchemas: string[] = [];

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function createTestSchemaName(prefix: string): string {
	const name = `${prefix}_${randomUUID().replaceAll("-", "")}`;
	createdSchemas.push(name);
	return name;
}

afterAll(async () => {
	for (const schema of createdSchemas) {
		await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
	}
});

describe("migrate runner unit tests", () => {
	test("discoverMigrations sorts YYYYMMDDHHMMSS_*.sql and ignores README.md", () => {
		const dir = createTempDir("migrate-discover-");
		try {
			writeFileSync(join(dir, "README.md"), "# Migrations\n", "utf8");
			writeFileSync(
				join(dir, "20260102000000_second.sql"),
				"CREATE TABLE second (id INT);\n",
				"utf8",
			);
			writeFileSync(
				join(dir, "20260101000000_first.sql"),
				"CREATE TABLE first (id INT);\n",
				"utf8",
			);
			writeFileSync(join(dir, "notes.txt"), "ignore me\n", "utf8");

			const discovered = discoverMigrations(dir);
			expect(discovered.map((m) => m.filename)).toEqual([
				"20260101000000_first.sql",
				"20260102000000_second.sql",
			]);
			expect(discovered.map((m) => m.version)).toEqual([
				"20260101000000",
				"20260102000000",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("discoverMigrations rejects psql \\copy and \\set meta-commands", () => {
		const copyDir = createTempDir("migrate-copy-");
		const setDir = createTempDir("migrate-set-");
		try {
			writeFileSync(
				join(copyDir, "20260101000000_seed.sql"),
				"\\copy items FROM 'items.csv' CSV;\n",
				"utf8",
			);
			expect(() => discoverMigrations(copyDir)).toThrow(/seed|\\copy|psql/i);

			writeFileSync(
				join(setDir, "20260101000000_set.sql"),
				"\\set ON_ERROR_STOP on\nCREATE TABLE items (id INT);\n",
				"utf8",
			);
			expect(() => discoverMigrations(setDir)).toThrow(/seed|\\set|psql/i);
		} finally {
			rmSync(copyDir, { recursive: true, force: true });
			rmSync(setDir, { recursive: true, force: true });
		}
	});

	test("database/migrations contains no \\copy seed files", () => {
		const migrations = discoverMigrations(repoMigrationsDir);
		expect(migrations.length).toBeGreaterThan(0);
		expect(
			migrations.some(
				(m) => m.filename === "20261109000000_load_pafe_concertos.sql",
			),
		).toBe(false);
	});

	test("computeMigrationChecksum normalizes CRLF to LF", () => {
		const lfSql = "CREATE TABLE items (\n  id TEXT PRIMARY KEY\n);\n";
		const crlfSql = "CREATE TABLE items (\r\n  id TEXT PRIMARY KEY\r\n);\r\n";

		const lfDigest = computeMigrationChecksum(lfSql);
		const crlfDigest = computeMigrationChecksum(crlfSql);

		expect(lfDigest).toBe(crlfDigest);
		expect(lfDigest).toMatch(/^[a-f0-9]{64}$/);
	});

	test("normalizePgDumpForParity strips dump noise and detects structural diffs", () => {
		const baseBody = [
			"CREATE TABLE orgs.organizations (",
			"    id text NOT NULL,",
			"    name text NOT NULL",
			");",
		].join("\n");

		const dumpA = [
			"-- PostgreSQL database dump",
			"\\restrict abc123",
			"SET statement_timeout = 0;",
			"SET lock_timeout = 0;",
			"CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;",
			baseBody,
			"\\unrestrict abc123",
		].join("\n");

		const dumpB = [
			"-- Dumped from database version 17.2",
			"\\restrict xyz789",
			"SET client_encoding = 'UTF8';",
			baseBody,
			"\\unrestrict xyz789",
		].join("\n");

		const dumpDiff = [
			"-- PostgreSQL database dump",
			"CREATE TABLE orgs.organizations (",
			"    id text NOT NULL,",
			"    name text NOT NULL,",
			"    slug text NOT NULL",
			");",
		].join("\n");

		expect(normalizePgDumpForParity(dumpA)).toBe(
			normalizePgDumpForParity(dumpB),
		);
		expect(normalizePgDumpForParity(dumpA)).not.toBe(
			normalizePgDumpForParity(dumpDiff),
		);
	});
});

describe("migrate runner postgres integration tests", () => {
	integrationTest(
		"fresh run applies migrations and records SHA-256 checksums",
		async () => {
			const schema = createTestSchemaName("it_mig_fresh");
			const dir = createTempDir("mig-fresh-");
			try {
				await sql.unsafe(`CREATE SCHEMA ${schema}`);
				const sql1 = "CREATE TABLE items (id TEXT PRIMARY KEY);\n";
				const sql2 = "ALTER TABLE items ADD COLUMN note TEXT;\n";
				writeFileSync(join(dir, "20260101000000_items.sql"), sql1, "utf8");
				writeFileSync(join(dir, "20260102000000_note.sql"), sql2, "utf8");

				await runMigrations({ schema, migrationsDir: dir });

				const rows = await sql.unsafe(
					`SELECT version, checksum FROM ${schema}.schema_migrations ORDER BY version`,
				);
				expect(rows).toEqual([
					{
						version: "20260101000000",
						checksum: computeMigrationChecksum(sql1),
					},
					{
						version: "20260102000000",
						checksum: computeMigrationChecksum(sql2),
					},
				]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	integrationTest(
		"idempotent re-run skips already-applied migrations",
		async () => {
			const schema = createTestSchemaName("it_mig_idem");
			const dir = createTempDir("mig-idem-");
			try {
				await sql.unsafe(`CREATE SCHEMA ${schema}`);
				writeFileSync(
					join(dir, "20260101000000_items.sql"),
					"CREATE TABLE items (id TEXT PRIMARY KEY);\n",
					"utf8",
				);

				await runMigrations({ schema, migrationsDir: dir });
				const firstRun = await sql.unsafe(
					`SELECT version, checksum, applied_at FROM ${schema}.schema_migrations`,
				);

				await runMigrations({ schema, migrationsDir: dir });
				const secondRun = await sql.unsafe(
					`SELECT version, checksum, applied_at FROM ${schema}.schema_migrations`,
				);

				expect(secondRun).toEqual(firstRun);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	integrationTest(
		"rejects checksum mismatch and aborts without applying later migrations",
		async () => {
			const schema = createTestSchemaName("it_mig_chk");
			const dir = createTempDir("mig-chk-");
			try {
				await sql.unsafe(`CREATE SCHEMA ${schema}`);
				writeFileSync(
					join(dir, "20260101000000_items.sql"),
					"CREATE TABLE items (id TEXT PRIMARY KEY);\n",
					"utf8",
				);
				await runMigrations({ schema, migrationsDir: dir });

				writeFileSync(
					join(dir, "20260101000000_items.sql"),
					"CREATE TABLE items (id TEXT PRIMARY KEY, tampered INT);\n",
					"utf8",
				);
				writeFileSync(
					join(dir, "20260102000000_later.sql"),
					"CREATE TABLE later_table (id INT);\n",
					"utf8",
				);

				await expect(
					runMigrations({ schema, migrationsDir: dir }),
				).rejects.toThrow(/checksum/i);

				const reg = await sql.unsafe("SELECT to_regclass($1) AS later_table", [
					`${schema}.later_table`,
				]);
				expect(reg[0]?.later_table).toBeNull();
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	integrationTest(
		"serializes concurrent runMigrations calls via advisory lock",
		async () => {
			const schema = createTestSchemaName("it_mig_lock");
			const dir = createTempDir("mig-lock-");
			try {
				await sql.unsafe(`CREATE SCHEMA ${schema}`);
				writeFileSync(
					join(dir, "20260101000000_items.sql"),
					"CREATE TABLE items (id TEXT PRIMARY KEY);\n",
					"utf8",
				);
				writeFileSync(
					join(dir, "20260102000000_note.sql"),
					"ALTER TABLE items ADD COLUMN note TEXT;\n",
					"utf8",
				);

				await Promise.all([
					runMigrations({ schema, migrationsDir: dir }),
					runMigrations({ schema, migrationsDir: dir }),
				]);

				const rows = await sql.unsafe(
					`SELECT version FROM ${schema}.schema_migrations ORDER BY version`,
				);
				expect(rows).toEqual([
					{ version: "20260101000000" },
					{ version: "20260102000000" },
				]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});
