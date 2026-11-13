import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SQL } from "bun";

export type MigrationFile = {
	version: string;
	filename: string;
	path: string;
	sql: string;
	checksum: string;
};

export type MigrationRunOptions = {
	databaseUrl?: string;
	schema?: string;
	migrationsDir?: string;
};

export type MigrationRunResult = {
	applied: string[];
	skipped: string[];
};

const DEFAULT_MIGRATIONS_DIR = resolve(import.meta.dir, "../database/migrations");
const MIGRATION_FILENAME_PATTERN = /^\d{14}_[a-z0-9_]+\.sql$/;
const PSQL_META_COMMAND_PATTERN = /^\s*\\(copy|set|i|ir|echo|connect)\b/im;
const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function requireEnvValue(
	env: Record<string, string | undefined>,
	key: string,
): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`Missing required database environment variable: ${key}`);
	}
	return value;
}

function resolveSslMode(value: string | undefined): string {
	const normalized = value?.trim().toLowerCase();
	if (!normalized || normalized === "false" || normalized === "0") {
		return "disable";
	}
	return "require";
}

export function resolveDatabaseUrl(
	env: Record<string, string | undefined> = process.env,
): string {
	const directUrl =
		env.DATABASE_URL?.trim() || env.POSTGRES_INTEGRATION_URL?.trim();
	if (directUrl) {
		return directUrl;
	}

	const user = encodeURIComponent(requireEnvValue(env, "DB_USER"));
	const password = encodeURIComponent(requireEnvValue(env, "DB_PASSWORD"));
	const host = requireEnvValue(env, "DB_HOST");
	const port = requireEnvValue(env, "DB_PORT");
	const database = encodeURIComponent(requireEnvValue(env, "DATABASE"));
	const sslmode = resolveSslMode(env.DB_SSL);

	return `postgres://${user}:${password}@${host}:${port}/${database}?sslmode=${sslmode}`;
}

export function computeMigrationChecksum(content: string): string {
	const normalized = content.replaceAll("\r\n", "\n");
	return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function discoverMigrations(
	migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): MigrationFile[] {
	const resolvedDir = resolve(migrationsDir);
	const entries = readdirSync(resolvedDir, { withFileTypes: true });
	const sqlFilenames = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => entry.name)
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

	return sqlFilenames.map((filename) => {
		if (!MIGRATION_FILENAME_PATTERN.test(filename)) {
			throw new Error(
				`Invalid migration filename "${filename}". Expected YYYYMMDDHHMMSS_description.sql.`,
			);
		}
		const filePath = join(resolvedDir, filename);
		const sql = readFileSync(filePath, "utf8");
		if (PSQL_META_COMMAND_PATTERN.test(sql)) {
			throw new Error(
				`Migration "${filename}" contains psql meta-commands; move seed/psql scripts out of database/migrations and into database/seeds or database/bootstrap.`,
			);
		}
		return {
			version: filename.slice(0, 14),
			filename,
			path: filePath,
			sql,
			checksum: computeMigrationChecksum(sql),
		};
	});
}

export function stripOuterTransaction(sqlText: string): string {
	return sqlText
		.replace(/^\uFEFF?\s*BEGIN\s*;\s*/i, "")
		.replace(/\s*COMMIT\s*;\s*$/i, "")
		.trim();
}

function validateSchemaName(schema: string): string {
	if (!SCHEMA_NAME_PATTERN.test(schema)) {
		throw new Error(`Invalid database schema name: "${schema}".`);
	}
	return schema;
}

function rewriteSchemaReferences(sqlText: string, safeSchema: string): string {
	if (safeSchema === "orgs") {
		return sqlText;
	}
	return sqlText.replace(/\borgs\./g, `${safeSchema}.`);
}

async function ensureLedgerTable(
	reserved: Awaited<ReturnType<SQL["reserve"]>>,
	safeSchema: string,
): Promise<void> {
	await reserved.unsafe(`CREATE SCHEMA IF NOT EXISTS "${safeSchema}"`);
	await reserved.unsafe(
		`CREATE TABLE IF NOT EXISTS "${safeSchema}".schema_migrations (
			version text PRIMARY KEY,
			filename text NOT NULL,
			checksum text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`,
	);
}

async function readAppliedLedger(
	reserved: Awaited<ReturnType<SQL["reserve"]>>,
	safeSchema: string,
): Promise<Map<string, { filename: string; checksum: string }>> {
	const rows = await reserved.unsafe<
		Array<{ version: string; filename: string; checksum: string }>
	>(`SELECT version, filename, checksum FROM "${safeSchema}".schema_migrations`);
	const ledger = new Map<string, { filename: string; checksum: string }>();
	for (const row of rows) {
		ledger.set(row.version, {
			filename: row.filename,
			checksum: row.checksum,
		});
	}
	return ledger;
}

async function applyPendingMigration(
	reserved: Awaited<ReturnType<SQL["reserve"]>>,
	safeSchema: string,
	migration: MigrationFile,
): Promise<void> {
	const stripped = stripOuterTransaction(migration.sql);
	const executableSql = rewriteSchemaReferences(stripped, safeSchema);
	await reserved.begin(async (tx) => {
		if (executableSql.length > 0) {
			await tx.unsafe(executableSql);
		}
		await tx.unsafe(
			`INSERT INTO "${safeSchema}".schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)`,
			[migration.version, migration.filename, migration.checksum],
		);
	});
}

async function executeMigrationsOnConnection(
	reserved: Awaited<ReturnType<SQL["reserve"]>>,
	safeSchema: string,
	migrations: MigrationFile[],
): Promise<MigrationRunResult> {
	await ensureLedgerTable(reserved, safeSchema);
	const ledger = await readAppliedLedger(reserved, safeSchema);
	const applied: string[] = [];
	const skipped: string[] = [];

	for (const migration of migrations) {
		const existing = ledger.get(migration.version);
		if (existing) {
			if (existing.checksum !== migration.checksum) {
				throw new Error(
					`Checksum mismatch for migration "${migration.filename}" (version ${migration.version}): expected ${existing.checksum}, got ${migration.checksum}.`,
				);
			}
			skipped.push(migration.filename);
			continue;
		}
		await applyPendingMigration(reserved, safeSchema, migration);
		applied.push(migration.filename);
	}

	return { applied, skipped };
}

export async function runMigrations(
	options: MigrationRunOptions = {},
): Promise<MigrationRunResult> {
	const databaseUrl = options.databaseUrl ?? resolveDatabaseUrl();
	const safeSchema = validateSchemaName(
		options.schema ?? (process.env.DB_SCHEMA || "orgs"),
	);
	const migrations = discoverMigrations(options.migrationsDir);
	const lockKey = `schema_migrations:${safeSchema}`;
	const db = new SQL(databaseUrl);

	try {
		const reserved = await db.reserve();
		try {
			await reserved.unsafe("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
				lockKey,
			]);
			try {
				return await executeMigrationsOnConnection(
					reserved,
					safeSchema,
					migrations,
				);
			} finally {
				await reserved.unsafe(
					"SELECT pg_advisory_unlock(hashtextextended($1, 0))",
					[lockKey],
				);
			}
		} finally {
			reserved.release();
		}
	} finally {
		await db.close();
	}
}

if (import.meta.main) {
	try {
		const result = await runMigrations();
		console.log(
			`Migrations complete: ${result.applied.length} applied, ${result.skipped.length} skipped.`,
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
