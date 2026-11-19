import { sql } from "bun";
import { loadEnv } from "../src/config/env.js";
import { postgresSchemaName } from "../src/repo/postgres-schema.js";
import {
	type LeaseReaperCycleResult,
	PeriodicLeaseReaper,
} from "../src/runtime/periodic-lease-reaper.js";

export interface ReapClassCheckoutCliOptions {
	batchSize?: number;
	closeDatabase?: boolean;
}

function resolveDatabaseConfig(): { connection: string; schema: string } {
	const connection =
		process.env.DATABASE_URL?.trim() ||
		process.env.FESTIVAL_DB?.trim() ||
		loadEnv({ requireDatabase: true, requireFirebaseAdmin: false }).databaseUrl;
	const configuredSchema = process.env.DB_SCHEMA?.trim();
	if (!connection || !configuredSchema) {
		throw new Error("Database configuration is required.");
	}
	return {
		connection,
		schema: postgresSchemaName(configuredSchema),
	};
}

export async function runReapClassCheckoutExecutionsCli(
	options?: ReapClassCheckoutCliOptions,
): Promise<LeaseReaperCycleResult> {
	const { connection, schema } = resolveDatabaseConfig();
	process.env.DATABASE_URL = connection;
	const reaper = new PeriodicLeaseReaper({
		schema,
		batchSize: options?.batchSize,
	});
	try {
		const result = await reaper.runCycle();
		console.log(JSON.stringify(result));
		return result;
	} finally {
		if (options?.closeDatabase !== false) {
			await sql.close();
		}
	}
}

if (import.meta.main) {
	try {
		await runReapClassCheckoutExecutionsCli();
	} catch {
		console.error(
			"Class checkout and lease reaper maintenance failed; connection details withheld.",
		);
		process.exitCode = 1;
	}
}
