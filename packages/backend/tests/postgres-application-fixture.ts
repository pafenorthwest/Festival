import { spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql, type TransactionSQL } from "bun";
import { assertApplicationFixtureSql } from "./postgres-application-sql-guard.js";

export interface ApplicationPostgresFixture {
	schema: string;
	id(label: string): string;
	trackOrganization(id: string): void;
	repository<T extends { ensureReady(): Promise<void> }>(repository: T): T;
	savepoint<T>(callback: () => Promise<T>): Promise<T>;
}

/** Real repository SQL on one actual-schema connection, always rolled back. */
export async function withApplicationRollback(
	callback: (fixture: ApplicationPostgresFixture) => Promise<void>,
): Promise<void> {
	if (
		!process.env.POSTGRES_INTEGRATION_URL ||
		process.env.POSTGRES_APPLICATION_CATALOG_VERIFIED !== "1"
	)
		throw new Error(
			"Run the PostgreSQL runner: application catalog preflight is required.",
		);
	const schema = process.env.DB_SCHEMA?.trim() || "orgs";
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema))
		throw new Error("Invalid application schema.");
	const prefix = randomUUID();
	const organizationIds = new Set<string>();
	const rollback = new Error("Intentional application fixture rollback");
	const realBegin = sql.begin.bind(sql);
	const realUnsafe = sql.unsafe.bind(sql);
	const current = await realUnsafe(
		`SELECT
		(SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema=$1 AND (table_name,column_name,data_type) IN (('registration_metadata','registration_snapshot','jsonb'),('customer_festival_availability','available_hours','jsonb'))) AS columns,
		(SELECT COUNT(*)::int FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname=$1 AND r.relname='shopify_webhook_deliveries' AND c.convalidated AND c.contype='c' AND c.conname IN ('shopify_webhook_deliveries_failure_stage_check','shopify_webhook_deliveries_failure_code_check')) AS checks`,
		[schema],
	);
	if (current[0]?.columns !== 2 || current[0]?.checks !== 2)
		throw new Error("Application schema current columns/checks are required.");
	const restorers: Array<() => void> = [];
	const guarded = (transaction: TransactionSQL) => ({
		unsafe: ((query: string, ...args: unknown[]) => {
			assertApplicationFixtureSql(query);
			return transaction.unsafe(query, ...args);
		}) as typeof sql.unsafe,
	});
	let failed = false;
	let failure: unknown;
	try {
		await realBegin(async (transaction) => {
			await transaction.unsafe("SET LOCAL lock_timeout = '5s'");
			await transaction.unsafe("SET LOCAL statement_timeout = '30s'");
			try {
				const client = guarded(transaction);
				const unsafe = spyOn(sql, "unsafe").mockImplementation(client.unsafe);
				restorers.push(() => unsafe.mockRestore());
				const begin = spyOn(sql, "begin").mockImplementation((async (
					operation: (runner: ReturnType<typeof guarded>) => Promise<unknown>,
				) =>
					transaction.savepoint(async (nested) =>
						operation(guarded(nested)),
					)) as typeof sql.begin);
				restorers.push(() => begin.mockRestore());
				const reserve = spyOn(sql, "reserve").mockImplementation(async () => {
					throw new Error(
						"Application fixture cannot open another connection.",
					);
				});
				restorers.push(() => reserve.mockRestore());
				await callback({
					schema,
					id(label) {
						if (!/^[A-Za-z0-9_-]+$/.test(label))
							throw new Error("Invalid fixture identity label.");
						return `${prefix}-${label}`;
					},
					trackOrganization(id) {
						organizationIds.add(id);
					},
					repository(repository) {
						const ready = spyOn(repository, "ensureReady").mockResolvedValue(
							undefined,
						);
						restorers.push(() => ready.mockRestore());
						return repository;
					},
					savepoint: (operation) => transaction.savepoint(operation),
				});
			} finally {
				for (const restore of restorers.reverse()) restore();
			}
			throw rollback;
		});
	} catch (error) {
		if (error !== rollback) {
			failed = true;
			failure = error;
		}
	}
	// This query runs outside the completed transaction, independently proving
	// that even the root fixture organization was never committed.
	const rows = await realUnsafe(
		`SELECT id FROM ${schema}.organizations WHERE id LIKE $1 OR id = ANY($2::text[])`,
		[`${prefix}-%`, sql.array([...organizationIds], "text")],
	);
	if (rows.length)
		throw new Error("Application fixture rollback left organization rows.");
	console.info(
		`[postgres-fixture] rolled back application transaction ${prefix}`,
	);
	if (failed) throw failure;
}
