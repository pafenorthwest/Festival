import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const migrationDirectory = resolve(
	import.meta.dir,
	"../../../database/migrations",
);

test("musical repertoire migration separates concurrent and transactional phases", async () => {
	const [concurrentPhase, transactionalPhase, runbook] = await Promise.all([
		readFile(
			resolve(
				migrationDirectory,
				"20260922_musical_repertoire.concurrent-index.sql",
			),
			"utf8",
		),
		readFile(
			resolve(migrationDirectory, "20260922_musical_repertoire.sql"),
			"utf8",
		),
		readFile(resolve(migrationDirectory, "README.md"), "utf8"),
	]);

	expect(concurrentPhase).toContain("CREATE UNIQUE INDEX CONCURRENTLY");
	expect(concurrentPhase).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
	expect(transactionalPhase).not.toContain("CREATE UNIQUE INDEX CONCURRENTLY");
	expect(transactionalPhase).toMatch(
		/BEGIN;[\s\S]*SET LOCAL lock_timeout = '5s';\s+ALTER TABLE[\s\S]*COMMIT;/,
	);
	expect(runbook).toContain("20260922_musical_repertoire.concurrent-index.sql");
	expect(runbook).toContain("DROP INDEX CONCURRENTLY");
});
