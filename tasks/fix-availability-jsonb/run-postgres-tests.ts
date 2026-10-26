import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const connection = process.env.FESTIVAL_DB;
if (!connection) {
	console.error("FESTIVAL_DB is missing from the selected database.env file.");
	process.exit(1);
}
let parsed: URL;
try {
	parsed = new URL(connection);
	if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error();
} catch {
	console.error("FESTIVAL_DB must contain a valid PostgreSQL connection URL; value withheld.");
	process.exit(1);
}
if (process.argv.includes("--check-config")) {
	console.log("database.env loaded; FESTIVAL_DB is a valid PostgreSQL URL. No connection made; value withheld.");
	process.exit(0);
}

const tests: string[] = [];
for (const file of new Bun.Glob("**/*.test.ts").scanSync({
	cwd: `${repoRoot}/packages/backend/tests`,
})) {
	const path = `packages/backend/tests/${file}`;
	if ((await Bun.file(`${repoRoot}/${path}`).text()).includes("POSTGRES_INTEGRATION_URL")) tests.push(path);
}
tests.sort();
const preflight = "packages/backend/tests/postgres-application-catalog.integration.test.ts";
if (!tests.includes(preflight)) {
	console.error("Application catalog preflight file is missing; no tests run.");
	process.exit(1);
}
const exceptions = new Set([
	"packages/backend/tests/postgres-class-capacity-atomic.integration.test.ts",
	"packages/backend/tests/postgres-class-capacity-cutoff.integration.test.ts",
	"packages/backend/tests/postgres-commerce-repository.test.ts",
]);
const includeExceptions = !process.argv.includes("--application-only");
const selected = [preflight, ...tests.filter(file => file !== preflight && (includeExceptions || !exceptions.has(file)))];
const secrets = [connection, parsed.password, decodeURIComponent(parsed.password)].filter(Boolean);
function sanitize(value: string): string {
	let safe = value;
	for (const secret of secrets) safe = safe.replaceAll(secret, "[REDACTED]");
	return safe.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]");
}
const logDir = "/private/tmp/schema-parity-integration-validation";
await mkdir(logDir, { recursive: true });
let output = `Selected ${selected.length} PostgreSQL-gated test files using private FESTIVAL_DB configuration. Catalog preflight runs first; ordinary fixtures use rolled-back application transactions. Each file runs in its own bounded Bun process.\n${selected.join("\n")}\n${includeExceptions ? "Full suite includes concurrency/fault cases in disposable current-schema namespaces." : "Application-only subset excludes the three isolated concurrency/fault files."}\n`;
console.log(output);
let failures = 0;
let initializations = 0;
const startedAt = performance.now();
let catalogVerified = false;
let rollbacks = 0;
let passed = 0;
for (const file of selected) {
	console.log(`Running ${file}`);
	const child = Bun.spawn([process.execPath, "test", file], {
		cwd: repoRoot,
		env: { ...process.env, DATABASE_URL: connection, POSTGRES_INTEGRATION_URL: connection, POSTGRES_APPLICATION_CATALOG_VERIFIED: catalogVerified ? "1" : "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, 60_000);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timer);
	initializations += stdout.split("[postgres-fixture] initialized current schema").length - 1;
	rollbacks += stdout.split("[postgres-fixture] rolled back application transaction ").length - 1;
	const section = sanitize(`\n${file}: exit ${exitCode}${timedOut ? " (60 second process timeout)" : ""}\n${stdout}${stderr}`);
	output += section;
	await Bun.write(`${logDir}/postgres-integration.log`, output);
	console.log(section);
	if (exitCode !== 0 || timedOut) {
		failures++;
		if (file === preflight) break;
	} else {
		passed++;
		if (file === preflight) catalogVerified = true;
	}
}
const summary = `PostgreSQL-gated files complete: ${passed} passed, ${failures} failed, ${selected.length-passed-failures} not run; ${initializations} current schema initializations; ${rollbacks} application rollbacks; ${Math.round(performance.now() - startedAt)}ms wall time. Mode: ${includeExceptions ? "full suite" : "application-only subset"}.`;
await Bun.write(`${logDir}/postgres-integration.log`, `${output}\n${summary}\n`);
console.log(summary);
process.exit(failures ? 1 : 0);
