import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CANONICAL_SCHEMA_PATH = resolve(
	import.meta.dir,
	"../database/postgres17-schema.sql",
);
const MAX_DIFF_LINES = 20;

const IGNORED_LINE_PATTERNS: RegExp[] = [
	/^\s*--.*$/,
	/^\s*SET\s+.*;\s*$/i,
	/^\s*SELECT\s+pg_catalog\.set_config\(.*\);\s*$/i,
	/^\s*\\(un)?restrict\b.*$/i,
	/^\s*CREATE\s+EXTENSION\b.*WITH\s+SCHEMA\s+public;\s*$/i,
	/^\s*COMMENT\s+ON\s+EXTENSION\b.*;\s*$/i,
];

function isIgnoredParityLine(line: string): boolean {
	if (line.trim().length === 0) {
		return true;
	}
	return IGNORED_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

export function normalizePgDumpForParity(sqlText: string): string {
	return sqlText
		.replace(/^\uFEFF/, "")
		.replaceAll("\r\n", "\n")
		.split("\n")
		.filter((line) => !isIgnoredParityLine(line))
		.join("\n");
}

function buildDiffSummary(
	canonicalNormalized: string,
	dumpNormalized: string,
): string {
	const canonicalLines = canonicalNormalized.split("\n");
	const dumpLines = dumpNormalized.split("\n");
	const maxLen = Math.max(canonicalLines.length, dumpLines.length);
	const diffs: string[] = [];

	for (let i = 0; i < maxLen; i += 1) {
		const left = canonicalLines[i];
		const right = dumpLines[i];
		if (left !== right) {
			diffs.push(`L${i + 1} - canonical: ${left ?? "<EOF>"}`);
			diffs.push(`L${i + 1} + dump:      ${right ?? "<EOF>"}`);
			if (diffs.length >= MAX_DIFF_LINES) {
				diffs.push("... diff truncated");
				break;
			}
		}
	}

	return diffs.join("\n");
}

export function compareSchemaParity(
	canonicalPath: string,
	dumpPath: string,
): { equal: boolean; diffSummary: string } {
	const canonicalRaw = readFileSync(resolve(canonicalPath), "utf8");
	const dumpRaw = readFileSync(resolve(dumpPath), "utf8");
	const canonicalNormalized = normalizePgDumpForParity(canonicalRaw);
	const dumpNormalized = normalizePgDumpForParity(dumpRaw);

	if (canonicalNormalized === dumpNormalized) {
		return { equal: true, diffSummary: "" };
	}

	return {
		equal: false,
		diffSummary: buildDiffSummary(canonicalNormalized, dumpNormalized),
	};
}

if (import.meta.main) {
	const dumpPath = process.argv[2] ?? process.env.PG_DUMP_PATH;
	if (!dumpPath) {
		console.error(
			"Usage: bun scripts/check-schema-parity.ts <pg-dump-path> (or set PG_DUMP_PATH).",
		);
		process.exit(1);
	}

	const result = compareSchemaParity(DEFAULT_CANONICAL_SCHEMA_PATH, dumpPath);
	if (result.equal) {
		console.log("Schema parity check passed.");
		process.exit(0);
	}

	console.error("Schema parity mismatch:");
	console.error(result.diffSummary);
	process.exit(1);
}
