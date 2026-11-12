import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const checkSqlScript = fileURLToPath(
	new URL("../../../scripts/check-sql.ts", import.meta.url),
);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

type CheckResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

function runCheckSql(sourceCode: string): CheckResult {
	const tempDir = mkdtempSync(join(tmpdir(), "check-sql-"));
	try {
		writeFileSync(join(tempDir, "sample.ts"), sourceCode, "utf8");
		const result = Bun.spawnSync({
			cmd: [process.execPath, checkSqlScript, tempDir],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});
		const decoder = new TextDecoder();
		return {
			exitCode: result.exitCode,
			stdout: decoder.decode(result.stdout),
			stderr: decoder.decode(result.stderr),
		};
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

describe("scripts/check-sql.ts", () => {
	test("accepts valid sql.unsafe and tx.unsafe queries with schema interpolation, comments, quotes, and dollar quotes", () => {
		const result = runCheckSql(`
			export class SampleRepo {
				private readonly schema = "festival";

				async run(sql: any, tx: any, a: string, b: string) {
					await sql.unsafe("SELECT * FROM users WHERE id = $1 AND org_id = $2", [a, b]);
					await tx.unsafe(
						\`SELECT * FROM \${this.schema}.users -- ignore $9;
						 /* ignore $8; */
						 WHERE id = $1 AND note = '$9;' AND body = $$semi; $7$$ AND tag = $tag$$6;$tag$\`,
						[a],
					);
				}
			}
		`);
		expect(result.exitCode).toBe(0);
	});

	test("rejects mismatched placeholder count for sql.unsafe and tx.unsafe", () => {
		const sqlResult = runCheckSql(`
			await sql.unsafe("SELECT * FROM users WHERE id = $1 AND org_id = $2", [a]);
		`);
		expect(sqlResult.exitCode).toBe(1);
		expect(sqlResult.stderr).toContain("placeholders through $2");

		const txResult = runCheckSql(`
			await tx.unsafe(\`SELECT * FROM \${this.schema}.users WHERE id = $1 AND org_id = $2\`, [a]);
		`);
		expect(txResult.exitCode).toBe(1);
		expect(txResult.stderr).toContain("placeholders through $2");
	});

	test("rejects non-contiguous placeholders for sql.unsafe and tx.unsafe", () => {
		const gapResult = runCheckSql(`
			await tx.unsafe("SELECT * FROM users WHERE id = $1 AND org_id = $3", [a, b, c]);
		`);
		expect(gapResult.exitCode).toBe(1);
		expect(gapResult.stderr).toContain("contiguous from $1");

		const skipFirstResult = runCheckSql(`
			await sql.unsafe("SELECT * FROM users WHERE id = $2", [a, b]);
		`);
		expect(skipFirstResult.exitCode).toBe(1);
		expect(skipFirstResult.stderr).toContain("contiguous from $1");
	});

	test("rejects multi-statement parameterized SQL for sql.unsafe and tx.unsafe", () => {
		const sqlResult = runCheckSql(`
			await sql.unsafe("SELECT $1; SELECT $2", [a, b]);
		`);
		expect(sqlResult.exitCode).toBe(1);
		expect(sqlResult.stderr).toContain("contains 2 statements");

		const txResult = runCheckSql(`
			await tx.unsafe("SELECT $1; SELECT $2", [a, b]);
		`);
		expect(txResult.exitCode).toBe(1);
		expect(txResult.stderr).toContain("contains 2 statements");
	});

	test("rejects spread elements in inline parameter arrays for sql.unsafe and tx.unsafe", () => {
		const sqlResult = runCheckSql(`
			await sql.unsafe("SELECT $1", [...params]);
		`);
		expect(sqlResult.exitCode).toBe(1);
		expect(sqlResult.stderr).toContain("spread element");

		const txResult = runCheckSql(`
			await tx.unsafe("SELECT $1", [...params]);
		`);
		expect(txResult.exitCode).toBe(1);
		expect(txResult.stderr).toContain("spread element");
	});

	test("rejects unparameterized sql.unsafe and tx.unsafe calls containing $1 placeholders", () => {
		const sqlResult = runCheckSql(`
			await sql.unsafe("SELECT * FROM users WHERE id = $1");
		`);
		expect(sqlResult.exitCode).toBe(1);

		const txResult = runCheckSql(`
			await tx.unsafe("SELECT * FROM users WHERE id = $1");
		`);
		expect(txResult.exitCode).toBe(1);
	});

	test("rejects string concatenation and single-quoted or non-identifier template interpolation", () => {
		const concatTx = runCheckSql(`
			await tx.unsafe("SELECT * FROM users WHERE id = " + userId);
		`);
		expect(concatTx.exitCode).toBe(1);

		const concatSql = runCheckSql(`
			await sql.unsafe("SELECT * FROM users WHERE id = " + userId);
		`);
		expect(concatSql.exitCode).toBe(1);

		const exprInterpTx = runCheckSql(`
			await tx.unsafe(\`SELECT * FROM users WHERE id = '\${userId.trim()}'\`);
		`);
		expect(exprInterpTx.exitCode).toBe(1);

		const unquotedExprTx = runCheckSql(`
			await tx.unsafe(\`SELECT * FROM users WHERE id = \${userId.trim()}\`);
		`);
		expect(unquotedExprTx.exitCode).toBe(1);

		const singleQuotedIdentTx = runCheckSql(`
			await tx.unsafe(\`SELECT * FROM users WHERE id = '\${userId}'\`);
		`);
		expect(singleQuotedIdentTx.exitCode).toBe(1);

		const singleQuotedIdentSql = runCheckSql(`
			await sql.unsafe(\`SELECT * FROM users WHERE id = '\${userId}'\`);
		`);
		expect(singleQuotedIdentSql.exitCode).toBe(1);
	});

	test("validates transaction, runner, database, client, and property-chained receivers", () => {
		const validReceivers = runCheckSql(`
			await transaction.unsafe("SELECT $1", [a]);
			await runner.unsafe("SELECT $1", [a]);
			await database.unsafe("SELECT $1", [a]);
			await fixture.client.unsafe("SELECT $1", [a]);
		`);
		expect(validReceivers.exitCode).toBe(0);

		const invalidChained = runCheckSql(`
			await fixture.client.unsafe("SELECT $1, $2", [a]);
		`);
		expect(invalidChained.exitCode).toBe(1);
	});
});
