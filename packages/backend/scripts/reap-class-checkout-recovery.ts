import { sql } from "bun";
import { PostgresClassCheckoutExecutionRepository } from "../src/checkout/postgres-class-checkout-execution.js";
import { loadEnv } from "../src/config/env.js";
import { postgresSchemaName } from "../src/repo/postgres-schema.js";

// A bounded maintenance pass. It never calls Shopify or recreates a cart.
// Run regularly and after database/process outages; request paths also reap
// their own expired execution before reporting status.
const connection =
	process.env.DATABASE_URL ||
	process.env.FESTIVAL_DB ||
	loadEnv({ requireDatabase: true, requireFirebaseAdmin: false }).databaseUrl;
const configuredSchema = process.env.DB_SCHEMA;
if (!connection || !configuredSchema)
	throw new Error("Database configuration is required.");
process.env.DATABASE_URL = connection;
const schema = postgresSchemaName(configuredSchema);
const repository = new PostgresClassCheckoutExecutionRepository(schema);
try {
	const organizations = (await sql.unsafe(
		`SELECT DISTINCT organization_id FROM ${schema}.class_checkout_executions WHERE state='running' AND lease_expires_at<=clock_timestamp() LIMIT 1000`,
	)) as Array<{ organization_id: string }>;
	let recoveredCount = 0;
	for (const organization of organizations)
		recoveredCount += await repository.reapExpired(
			organization.organization_id,
		);
	console.log(
		JSON.stringify({ organizationCount: organizations.length, recoveredCount }),
	);
} catch {
	console.error(
		"Class checkout recovery maintenance failed; connection details withheld.",
	);
	process.exitCode = 1;
} finally {
	await sql.close();
}
