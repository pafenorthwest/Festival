import { expect, test } from "bun:test";
import { relative, resolve } from "node:path";
import TypeScript from "typescript";
import {
	countFileLines,
	normalizeRepoRelativePath,
} from "./architecture-boundaries.test.js";
import {
	GRANDFATHERED_EXISTING_NON_DOMAIN_FILES,
	GRANDFATHERED_SCHEMA_FILES,
	GRANDFATHERED_SQL_PREFIXES,
	MAX_GRANDFATHERED_SOURCE_FILE_LINES,
	MAX_NEW_SOURCE_FILE_LINES,
} from "./fixtures/file-size-ratchet-baseline.js";

export type FileSizeRuleId =
	| "new-file-line-ceiling"
	| "grandfathered-line-ceiling";

export interface FileSizeViolation {
	readonly rule: FileSizeRuleId;
	readonly filePath: string;
	readonly lineCount: number;
	readonly maxLines: number;
	readonly line: number;
	readonly message: string;
}

const SOURCE_SCAN_TARGETS: readonly {
	readonly dir: string;
	readonly extensions: readonly string[];
}[] = [
	{ dir: "packages/common/src", extensions: [".ts"] },
	{ dir: "packages/backend/src", extensions: [".ts", ".tsx"] },
	{ dir: "packages/frontend/src", extensions: [".ts", ".tsx"] },
	{
		dir: "packages/shopify-confirmation/extensions",
		extensions: [".ts", ".tsx"],
	},
	{ dir: "database", extensions: [".sql"] },
];

const READ_DIR_EXCLUDES = [
	"**/*.d.ts",
	"**/*.test.ts",
	"**/*.test.tsx",
	"**/node_modules/**",
	"**/dist/**",
] as const;

const INSPECTED_SOURCE_PREFIXES = SOURCE_SCAN_TARGETS.filter(
	(target) => target.dir !== "database",
).map((target) => `${target.dir}/`);

const isGrandfatheredSqlFile = (filePath: string): boolean =>
	filePath.endsWith(".sql") &&
	GRANDFATHERED_SQL_PREFIXES.some((prefix) => filePath.startsWith(prefix));

function isInspectedTsSourceFile(filePath: string): boolean {
	if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return false;
	const excluded = [".d.ts", ".test.ts", ".test.tsx"].some((ext) =>
		filePath.endsWith(ext),
	);
	return (
		!excluded &&
		INSPECTED_SOURCE_PREFIXES.some((prefix) => filePath.startsWith(prefix))
	);
}

function isStrictDomainOrEntrypoint(filePath: string): boolean {
	return (
		filePath.startsWith("packages/backend/src/domains/") ||
		filePath.startsWith("packages/frontend/src/domains/") ||
		filePath === "packages/backend/src/app.ts" ||
		filePath.startsWith("packages/backend/src/composition/")
	);
}

export function loadRepositorySourceFiles(
	repoRoot: string,
): Record<string, string> {
	const files: Record<string, string> = {};
	for (const target of SOURCE_SCAN_TARGETS) {
		const absDir = resolve(repoRoot, target.dir);
		if (!TypeScript.sys.directoryExists(absDir)) continue;
		const discovered = TypeScript.sys.readDirectory(
			absDir,
			target.extensions,
			READ_DIR_EXCLUDES,
		);
		for (const file of discovered) {
			const content = TypeScript.sys.readFile(file);
			if (content !== undefined) {
				files[normalizeRepoRelativePath(relative(repoRoot, file))] = content;
			}
		}
	}
	return files;
}

export function analyzeSourceFileSizeRatchet(
	files: Readonly<Record<string, string>>,
): FileSizeViolation[] {
	const violations: FileSizeViolation[] = [];
	const entries = Object.entries(files)
		.map(
			([rawPath, content]) =>
				[normalizeRepoRelativePath(rawPath), content] as const,
		)
		.sort(([a], [b]) => a.localeCompare(b));
	for (const [filePath, content] of entries) {
		if (
			isGrandfatheredSqlFile(filePath) ||
			!isInspectedTsSourceFile(filePath)
		) {
			continue;
		}
		const isGrandfathered =
			!isStrictDomainOrEntrypoint(filePath) &&
			(GRANDFATHERED_SCHEMA_FILES.has(filePath) ||
				GRANDFATHERED_EXISTING_NON_DOMAIN_FILES.has(filePath));
		const rule: FileSizeRuleId = isGrandfathered
			? "grandfathered-line-ceiling"
			: "new-file-line-ceiling";
		const maxLines = isGrandfathered
			? MAX_GRANDFATHERED_SOURCE_FILE_LINES
			: MAX_NEW_SOURCE_FILE_LINES;
		const lineCount = countFileLines(content);
		if (lineCount > maxLines) {
			violations.push({
				rule,
				filePath,
				lineCount,
				maxLines,
				line: maxLines + 1,
				message: `"${filePath}" has ${lineCount} lines (max ${maxLines} under ${rule}).`,
			});
		}
	}
	return violations;
}

const repositoryRoot = resolve(import.meta.dir, "../../..");
const buildLines = (n: number): string =>
	`${Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`;
const mapFiles = (
	paths: readonly string[],
	content: string,
): Record<string, string> => Object.fromEntries(paths.map((p) => [p, content]));

test("enforces zero file-size ratchet violations on the live repository", () => {
	const liveFiles = loadRepositorySourceFiles(repositoryRoot);
	expect(analyzeSourceFileSizeRatchet(liveFiles)).toEqual([]);
	for (const requiredFile of [
		"packages/backend/src/app.ts",
		"packages/backend/src/composition/runtime.ts",
		"packages/backend/src/domains/tenant-org/index.ts",
		"packages/backend/src/repo/postgres-schema.ts",
		"packages/backend/src/routes/customer/customer-class-checkout.routes.ts",
		"packages/common/src/organization.ts",
		"packages/frontend/src/lib/api/registration.ts",
		"packages/shopify-confirmation/extensions/festival-account-return/src/order-status.ts",
		"database/postgres17-schema.sql",
	]) {
		expect(liveFiles[requiredFile]).toBeDefined();
	}
	expect(liveFiles["packages/common/src/availability.test.ts"]).toBeUndefined();
});

test("flags 501-line new and strict files under new-file-line-ceiling", () => {
	const targets = [
		"packages/backend/src/routes/new.routes.ts",
		"packages/frontend/src/pages/NewPage.tsx",
		"packages/common/src/new-contract.ts",
		"packages/backend/src/app.ts",
		"packages/backend/src/composition/new-module.ts",
		"packages/backend/src/domains/tenant-org/new.ts",
		"packages/frontend/src/domains/catalog/NewView.tsx",
		"packages/shopify-confirmation/extensions/new-ext/src/index.ts",
	];
	expect(
		analyzeSourceFileSizeRatchet(
			mapFiles(targets, buildLines(MAX_NEW_SOURCE_FILE_LINES)),
		),
	).toEqual([]);
	const violations = analyzeSourceFileSizeRatchet(
		mapFiles(targets, buildLines(MAX_NEW_SOURCE_FILE_LINES + 1)),
	);
	expect(violations.map((v) => v.rule)).toEqual(
		targets.map(() => "new-file-line-ceiling"),
	);
});

test("allows grandfathered edits up to 2000 lines and flags 2001-line edits", () => {
	const atMax = buildLines(MAX_GRANDFATHERED_SOURCE_FILE_LINES);
	expect(
		analyzeSourceFileSizeRatchet({
			"packages/backend/src/routes/customer/customer-class-checkout.routes.ts":
				buildLines(535),
			"packages/frontend/src/lib/api/registration.ts": buildLines(533),
			"packages/shopify-confirmation/extensions/festival-account-return/src/order-status.ts":
				atMax,
		}),
	).toEqual([]);
	const overTargets = [
		"packages\\backend\\src\\routes\\customer\\customer-class-checkout.routes.ts",
		"packages/frontend/src/lib/api/registration.ts",
		"packages/backend/src/repo/postgres-schema.ts",
		"packages/common/src/organization.ts",
	];
	const violations = analyzeSourceFileSizeRatchet(
		mapFiles(overTargets, buildLines(MAX_GRANDFATHERED_SOURCE_FILE_LINES + 1)),
	);
	expect(violations.map((v) => v.rule)).toEqual(
		overTargets.map(() => "grandfathered-line-ceiling"),
	);
});

test("allows grandfathered SQL, schema, common contracts, and ignored files", () => {
	expect(
		analyzeSourceFileSizeRatchet({
			"database/postgres17-schema.sql": buildLines(5000),
			"packages/backend/src/repo/postgres-schema.ts": buildLines(1500),
			"packages/common/src/organization.ts": buildLines(696),
			"packages/common/src/availability.test.ts": buildLines(3000),
			"packages/frontend/src/vite-env.d.ts": buildLines(3000),
			"packages/frontend/src/pages/NewPage.test.tsx": buildLines(3000),
			"scripts/check.ts": buildLines(3000),
		}),
	).toEqual([]);
	for (const nonGrandfathered of [
		"packages/common/src/availability.test.ts",
		"packages/backend/src/app.ts",
		"packages/backend/src/composition/runtime.ts",
	]) {
		expect(GRANDFATHERED_SCHEMA_FILES.has(nonGrandfathered)).toBe(false);
		expect(GRANDFATHERED_EXISTING_NON_DOMAIN_FILES.has(nonGrandfathered)).toBe(
			false,
		);
	}
});
