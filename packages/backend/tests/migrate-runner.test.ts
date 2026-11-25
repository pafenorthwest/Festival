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
	DEFAULT_MIGRATION_STATEMENT_TIMEOUT: string;
	computeMigrationChecksum(content: string): string;
	discoverMigrations(migrationsDir?: string): Array<{
		version: string;
		filename: string;
		path: string;
		sql: string;
		checksum: string;
	}>;
	resolveMigrationStatementTimeout(
		raw?: string,
		env?: Record<string, string | undefined>,
	): string;
	runMigrations(options?: {
		databaseUrl?: string;
		schema?: string;
		migrationsDir?: string;
		statementTimeout?: string;
	}): Promise<{ applied: string[]; skipped: string[] }>;
}

const { normalizePgDumpForParity } = (await import(
	resolve(import.meta.dir, "../../../scripts/check-schema-parity.ts")
)) as ParityModule;

const {
	DEFAULT_MIGRATION_STATEMENT_TIMEOUT,
	computeMigrationChecksum,
	discoverMigrations,
	resolveMigrationStatementTimeout,
	runMigrations,
} = (await import(
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

function withStatementTimeoutUrl(baseUrl: string, timeout: string): string {
	const parsed = new URL(baseUrl);
	parsed.searchParams.set("options", `-c statement_timeout=${timeout}`);
	return parsed.toString();
}

async function probeActiveMigrationTimeout(
	statementTimeout?: string,
): Promise<string> {
	const baseUrl = process.env.POSTGRES_INTEGRATION_URL;
	if (!baseUrl) {
		throw new Error("POSTGRES_INTEGRATION_URL is required");
	}
	const databaseUrl = withStatementTimeoutUrl(baseUrl, "15s");
	const schema = createTestSchemaName("it_mig_timeout");
	const dir = createTempDir("mig-timeout-");
	try {
		await sql.unsafe(`CREATE SCHEMA ${schema}`);
		writeFileSync(
			join(dir, "20260101000000_timeout_probe.sql"),
			"CREATE TABLE orgs.timeout_probe AS SELECT current_setting('statement_timeout') AS active_timeout;\n",
			"utf8",
		);
		await runMigrations({
			databaseUrl,
			schema,
			migrationsDir: dir,
			statementTimeout,
		});
		const rows = await sql.unsafe(
			`SELECT active_timeout FROM ${schema}.timeout_probe`,
		);
		return String(rows[0]?.active_timeout ?? "");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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

	test("resolveMigrationStatementTimeout defaults to 5min when unset or whitespace", () => {
		expect(DEFAULT_MIGRATION_STATEMENT_TIMEOUT).toBe("5min");
		expect(resolveMigrationStatementTimeout(undefined, {})).toBe("5min");
		expect(resolveMigrationStatementTimeout("   ", {})).toBe("5min");
		expect(
			resolveMigrationStatementTimeout(undefined, {
				MIGRATION_STATEMENT_TIMEOUT: " \t ",
			}),
		).toBe("5min");
	});

	test("resolveMigrationStatementTimeout reads env and lets raw option override", () => {
		const env = { MIGRATION_STATEMENT_TIMEOUT: "10min" };
		expect(resolveMigrationStatementTimeout(undefined, env)).toBe("10min");
		expect(resolveMigrationStatementTimeout("3min", env)).toBe("3min");
	});

	test("resolveMigrationStatementTimeout accepts valid literals and trims whitespace", () => {
		for (const valid of ["0", "500ms", "30s", "5min", "2h"]) {
			expect(resolveMigrationStatementTimeout(valid, {})).toBe(valid);
		}
		expect(resolveMigrationStatementTimeout("  30s  ", {})).toBe("30s");
	});

	test("resolveMigrationStatementTimeout rejects malformed or SQL-unsafe values", () => {
		const invalidValues = ["15s; DROP TABLE x", "-5s", "15", "5m", "abc", "0s"];
		for (const invalid of invalidValues) {
			expect(() => resolveMigrationStatementTimeout(invalid, {})).toThrow(
				/Invalid migration statement_timeout/i,
			);
		}
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
				const sql1 = "CREATE TABLE orgs.items (id TEXT PRIMARY KEY);\n";
				const sql2 = "ALTER TABLE orgs.items ADD COLUMN note TEXT;\n";
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
					"CREATE TABLE orgs.items (id TEXT PRIMARY KEY);\n",
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
					"CREATE TABLE orgs.items (id TEXT PRIMARY KEY);\n",
					"utf8",
				);
				await runMigrations({ schema, migrationsDir: dir });

				writeFileSync(
					join(dir, "20260101000000_items.sql"),
					"CREATE TABLE orgs.items (id TEXT PRIMARY KEY, tampered INT);\n",
					"utf8",
				);
				writeFileSync(
					join(dir, "20260102000000_later.sql"),
					"CREATE TABLE orgs.later_table (id INT);\n",
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
					"CREATE TABLE orgs.items (id TEXT PRIMARY KEY);\n",
					"utf8",
				);
				writeFileSync(
					join(dir, "20260102000000_note.sql"),
					"ALTER TABLE orgs.items ADD COLUMN note TEXT;\n",
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

	integrationTest(
		"overrides tight 15s connection statement_timeout with 5min default and custom timeout",
		async () => {
			expect(await probeActiveMigrationTimeout()).toBe("5min");
			expect(await probeActiveMigrationTimeout("7min")).toBe("7min");
		},
	);
});
