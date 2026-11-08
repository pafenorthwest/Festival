import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const outputDirectory = fileURLToPath(new URL("./", import.meta.url));
const connection = process.env.FESTIVAL_DB;
if (!connection) {
	console.error("FESTIVAL_DB is missing from the selected environment file; value withheld.");
	process.exit(1);
}
let parsed: URL;
try {
	parsed = new URL(connection);
	if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error();
} catch {
	console.error("FESTIVAL_DB must be a valid PostgreSQL URL; value withheld.");
	process.exit(1);
}
const secrets = [connection, parsed.password, decodeURIComponent(parsed.password)].filter(Boolean);
function sanitize(value: string) {
	let result = value;
	for (const secret of secrets) result = result.replaceAll(secret, "[REDACTED]");
	return result.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]");
}

// Only this generated target and the individual suites' owned fixtures are written.
const schema = `it_checkout_full_${randomUUID().replaceAll("-", "")}`;
process.env.DATABASE_URL = connection;
process.env.POSTGRES_INTEGRATION_URL = connection;
process.env.DB_SCHEMA = schema;
const { sql } = await import("bun");
const { initializePostgresSchema } = await import(`${root}/packages/backend/src/repo/postgres-schema.ts`);
await mkdir(outputDirectory, { recursive: true });
let owned = false;
let cleaned = false;
let log = "Full PostgreSQL validation uses an owned disposable current-target schema. Configured application schema remains untouched.\n";
let failures = 0;
let passedFiles = 0;
let selected: string[] = [];
const startedAt = performance.now();
try {
	const extensions = await sql.unsafe("SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','btree_gist')");
	if (extensions.length !== 2) throw new Error("Required extensions are absent; refusing shared-database extension changes.");
	const existing = await sql.unsafe("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema]);
	if (existing.length) throw new Error("Disposable schema ownership collision; no existing schema will be used.");
	owned = true;
	await initializePostgresSchema(schema);
	const testRoot = `${root}/packages/backend/tests`;
	const tests: string[] = [];
	for (const file of new Bun.Glob("**/*.test.ts").scanSync({ cwd: testRoot })) {
		if ((await Bun.file(`${testRoot}/${file}`).text()).includes("POSTGRES_INTEGRATION_URL")) tests.push(`packages/backend/tests/${file}`);
	}
	tests.sort();
	const preflight = "packages/backend/tests/postgres-application-catalog.integration.test.ts";
	if (!tests.includes(preflight)) throw new Error("Required catalog preflight is missing.");
	selected = [preflight, ...tests.filter((file) => file !== preflight)];
	log += `Selected ${selected.length} PostgreSQL-gated files.\n${selected.join("\n")}\n`;
	let catalogVerified = false;
	for (const file of selected) {
		console.log(`Running ${file}`);
		const child = Bun.spawn([process.execPath, "--no-env-file", "test", file], {
			cwd: root,
			env: { ...process.env, DATABASE_URL: connection, POSTGRES_INTEGRATION_URL: connection, DB_SCHEMA: schema, POSTGRES_APPLICATION_CATALOG_VERIFIED: catalogVerified ? "1" : "0" },
			stdout: "pipe", stderr: "pipe",
		});
		let timedOut = false;
		const timer = setTimeout(() => { timedOut = true; child.kill(); }, 60_000);
		const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		clearTimeout(timer);
		log += sanitize(`\n${file}: exit ${code}${timedOut ? " (60-second timeout)" : ""}\n${stdout}${stderr}`);
		await Bun.write(`${outputDirectory}/postgres-full.log`, log);
		if (code !== 0 || timedOut) {
			failures++;
			if (file === preflight) break;
		} else {
			passedFiles++;
			if (file === preflight) catalogVerified = true;
		}
	}
} catch (error) {
	failures++;
	log += `\nValidation failure: ${sanitize(error instanceof Error ? error.message : String(error))}\n`;
} finally {
	if (owned) {
		try {
			await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
			cleaned = (await sql.unsafe("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).length === 0;
		} catch (error) {
			failures++;
			log += `\nOwned-schema cleanup failure: ${sanitize(error instanceof Error ? error.message : String(error))}\n`;
		}
	}
	const count = (label: string) => [...log.matchAll(new RegExp(`^\\s*(\\d+) ${label}\\s*$`, "gm"))].reduce((total, match) => total + Number(match[1]), 0);
	const summary = {
		schema, configuredApplicationSchemaModified: false, initializedOnlyDisposableTarget: true, cleaned,
		failed: failures > 0, passedFiles, failedFiles: failures, selectedFiles: selected.length, notRunFiles: Math.max(0, selected.length - passedFiles - failures),
		testsPassed: count("pass"), testsFailed: count("fail"), testsSkipped: count("skip"),
		currentSchemaInitializations: log.split("[postgres-fixture] initialized current schema").length - 1,
		applicationRollbacks: log.split("[postgres-fixture] rolled back application transaction ").length - 1,
		includedPaymentSuite: selected.some((file) => file.endsWith("postgres-class-checkout-payment.integration.test.ts")),
		wallTimeMs: Math.round(performance.now() - startedAt),
	};
	await Bun.write(`${outputDirectory}/postgres-full.log`, log);
	await Bun.write(`${outputDirectory}/postgres-full-summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
	console.log(JSON.stringify(summary));
	await sql.close();
}
process.exit(failures ? 1 : 0);
