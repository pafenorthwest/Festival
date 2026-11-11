import { expect, test } from "bun:test";
import { posix, relative, resolve } from "node:path";
import TypeScript from "typescript";

export const BOUNDED_CONTEXTS = [
	"tenant-org",
	"catalog-repertoire",
	"customer-identity",
	"teacher-directory",
	"volunteers-comms",
	"class-checkout",
	"commerce-projection",
] as const;

export type BoundedContext = (typeof BOUNDED_CONTEXTS)[number];

export const MAX_DOMAIN_FILE_LINES = 500;

export const ALLOWED_UPSTREAM_CONTEXTS: Readonly<
	Record<BoundedContext, readonly BoundedContext[]>
> = {
	"tenant-org": [],
	"catalog-repertoire": ["tenant-org"],
	"customer-identity": ["tenant-org"],
	"teacher-directory": [
		"tenant-org",
		"catalog-repertoire",
		"customer-identity",
	],
	"volunteers-comms": ["tenant-org", "catalog-repertoire", "customer-identity"],
	"class-checkout": [
		"tenant-org",
		"catalog-repertoire",
		"customer-identity",
		"teacher-directory",
	],
	"commerce-projection": [
		"tenant-org",
		"catalog-repertoire",
		"customer-identity",
		"teacher-directory",
		"class-checkout",
	],
};

export type BoundaryRuleId =
	| "known-context"
	| "line-ceiling"
	| "forbidden-package"
	| "cross-domain-dag"
	| "public-barrel-only"
	| "permitted-backend-layer";

export interface BoundaryViolation {
	readonly rule: BoundaryRuleId;
	readonly filePath: string;
	readonly line: number;
	readonly specifier?: string;
	readonly message: string;
}

type ExtractedSpecifier = { readonly specifier: string; readonly line: number };
type RuleFailure = { readonly rule: BoundaryRuleId; readonly message: string };

const REPO_ANCHOR = "/__repo__";
const BACKEND_DOMAINS = "packages/backend/src/domains";
const FRONTEND_DOMAINS = "packages/frontend/src/domains";
const CONTEXT_SET: ReadonlySet<string> = new Set(BOUNDED_CONTEXTS);

const fail = (rule: BoundaryRuleId, message: string): RuleFailure => ({
	rule,
	message,
});
const isBoundedContext = (v: string): v is BoundedContext => CONTEXT_SET.has(v);

export function toPosixPath(p: string): string {
	return p.replaceAll("\\", "/").replace(/^[A-Z]:\//, (m) => m.toLowerCase());
}

export function normalizeRepoRelativePath(p: string, rootDir?: string): string {
	let candidate = toPosixPath(p);
	if (rootDir !== undefined) {
		const root = toPosixPath(rootDir).replace(/\/+$/, "");
		if (candidate.startsWith(`${root}/`)) {
			candidate = candidate.slice(root.length + 1);
		}
	}
	return posix.normalize(candidate.replace(/^(?:\.\/|\/)+/, ""));
}

export function countFileLines(content: string): number {
	return content.length === 0
		? 0
		: content.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

export function findGraphCycles(
	graph: Readonly<Record<string, readonly string[]>>,
): string[] {
	const state = new Map<string, "visiting" | "visited">();
	const cycles: string[] = [];
	function visit(node: string, trail: readonly string[]): void {
		const current = state.get(node);
		if (current === "visited") return;
		if (current === "visiting") {
			cycles.push([...trail, node].join(" -> "));
			return;
		}
		state.set(node, "visiting");
		for (const upstream of graph[node] ?? []) visit(upstream, [...trail, node]);
		state.set(node, "visited");
	}
	for (const node of Object.keys(graph)) visit(node, []);
	return cycles;
}

function getNodeSpecifier(node: TypeScript.Node): string | undefined {
	if (
		(TypeScript.isImportDeclaration(node) ||
			TypeScript.isExportDeclaration(node)) &&
		node.moduleSpecifier !== undefined &&
		TypeScript.isStringLiteralLike(node.moduleSpecifier)
	) {
		return node.moduleSpecifier.text;
	}
	const arg = TypeScript.isCallExpression(node) ? node.arguments[0] : undefined;
	return TypeScript.isCallExpression(node) &&
		node.expression.kind === TypeScript.SyntaxKind.ImportKeyword &&
		arg !== undefined &&
		TypeScript.isStringLiteralLike(arg)
		? arg.text
		: undefined;
}

export function extractModuleSpecifiers(
	filePath: string,
	content: string,
): ExtractedSpecifier[] {
	const kind = filePath.endsWith(".tsx")
		? TypeScript.ScriptKind.TSX
		: TypeScript.ScriptKind.TS;
	const sf = TypeScript.createSourceFile(
		filePath,
		content,
		TypeScript.ScriptTarget.Latest,
		true,
		kind,
	);
	const extracted: ExtractedSpecifier[] = [];
	function visit(node: TypeScript.Node): void {
		const specifier = getNodeSpecifier(node);
		if (specifier !== undefined) {
			const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
			extracted.push({ specifier, line });
		}
		TypeScript.forEachChild(node, visit);
	}
	visit(sf);
	return extracted;
}

function resolveRepoTarget(
	filePath: string,
	rawSpecifier: string,
): string | undefined {
	const specifier = toPosixPath(rawSpecifier);
	const resolved = specifier.startsWith(".")
		? posix.resolve(`${REPO_ANCHOR}/${posix.dirname(filePath)}`, specifier)
		: specifier.startsWith("/")
			? posix.resolve(REPO_ANCHOR, specifier.slice(1))
			: specifier.startsWith("packages/")
				? posix.resolve(REPO_ANCHOR, specifier)
				: undefined;
	if (resolved === undefined) return undefined;
	return resolved.startsWith(`${REPO_ANCHOR}/`)
		? resolved.slice(REPO_ANCHOR.length + 1)
		: "__ESCAPED_REPO_ROOT__";
}

function isForbiddenWorkspaceImport(
	rawSpecifier: string,
	target: string | undefined,
): boolean {
	const specifier = toPosixPath(rawSpecifier);
	if (
		specifier.startsWith("@festival/") &&
		specifier !== "@festival/common" &&
		!specifier.startsWith("@festival/common/")
	) {
		return true;
	}
	return (
		target !== undefined &&
		(target === "packages/frontend" ||
			target.startsWith("packages/frontend/") ||
			target === "packages/shopify-confirmation" ||
			target.startsWith("packages/shopify-confirmation/"))
	);
}

function checkDomainTarget(
	sourceContext: BoundedContext,
	targetPath: string,
): RuleFailure | undefined {
	if (targetPath === BACKEND_DOMAINS) {
		return fail("known-context", `Cannot import ${BACKEND_DOMAINS} root.`);
	}
	const [targetContext, ...rest] = targetPath
		.slice(BACKEND_DOMAINS.length + 1)
		.split("/");
	if (targetContext === undefined || !isBoundedContext(targetContext)) {
		return fail("known-context", `Unknown bounded context in "${targetPath}".`);
	}
	if (targetContext === sourceContext) return undefined;
	if (!ALLOWED_UPSTREAM_CONTEXTS[sourceContext].includes(targetContext)) {
		return fail(
			"cross-domain-dag",
			`Context "${sourceContext}" cannot import "${targetContext}".`,
		);
	}
	const isBarrel =
		rest.length === 0 ||
		(rest.length === 1 && (rest[0] === "index.ts" || rest[0] === "index.js"));
	return isBarrel
		? undefined
		: fail(
				"public-barrel-only",
				`Cross-domain import "${sourceContext}" -> "${targetContext}" must target index barrel, not "${targetPath}".`,
			);
}

function evaluateBackendSpecifier(
	sourceContext: BoundedContext,
	filePath: string,
	rawSpecifier: string,
): RuleFailure | undefined {
	const target = resolveRepoTarget(filePath, rawSpecifier);
	if (isForbiddenWorkspaceImport(rawSpecifier, target)) {
		return fail(
			"forbidden-package",
			`Forbidden workspace package "${rawSpecifier}".`,
		);
	}
	if (target === undefined) return undefined;
	if (target === BACKEND_DOMAINS || target.startsWith(`${BACKEND_DOMAINS}/`)) {
		return checkDomainTarget(sourceContext, target);
	}
	const permitted =
		target === "packages/backend/src/infra" ||
		target.startsWith("packages/backend/src/infra/") ||
		target === "packages/backend/src/routes/shared" ||
		target.startsWith("packages/backend/src/routes/shared/");
	return permitted
		? undefined
		: fail(
				"permitted-backend-layer",
				`Unauthorized non-domain backend import "${target}".`,
			);
}

function analyzeBackendDomainFile(
	filePath: string,
	content: string,
): BoundaryViolation[] {
	const remainder = filePath.slice(BACKEND_DOMAINS.length + 1);
	const slash = remainder.indexOf("/");
	const context = slash === -1 ? undefined : remainder.slice(0, slash);
	if (context === undefined || !isBoundedContext(context)) {
		return [
			{
				...fail("known-context", `Invalid domain path "${filePath}".`),
				filePath,
				line: 1,
			},
		];
	}
	return extractModuleSpecifiers(filePath, content).flatMap((item) => {
		const failure = evaluateBackendSpecifier(context, filePath, item.specifier);
		return failure === undefined
			? []
			: [{ ...failure, filePath, line: item.line, specifier: item.specifier }];
	});
}

export function analyzeArchitectureBoundaries(
	files: Readonly<Record<string, string>>,
): BoundaryViolation[] {
	const violations: BoundaryViolation[] = [];
	for (const [rawPath, content] of Object.entries(files)) {
		const filePath = normalizeRepoRelativePath(rawPath);
		if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) continue;
		const isBackend = filePath.startsWith(`${BACKEND_DOMAINS}/`);
		const isFrontend = filePath.startsWith(`${FRONTEND_DOMAINS}/`);
		if (!isBackend && !isFrontend) continue;
		const lineCount = countFileLines(content);
		if (lineCount > MAX_DOMAIN_FILE_LINES) {
			violations.push({
				...fail("line-ceiling", `"${filePath}" has ${lineCount} lines.`),
				filePath,
				line: MAX_DOMAIN_FILE_LINES + 1,
			});
		}
		if (isBackend) {
			violations.push(...analyzeBackendDomainFile(filePath, content));
		}
	}
	return violations;
}

export function loadRepositoryDomainFiles(
	repoRoot: string,
): Record<string, string> {
	const files: Record<string, string> = {};
	for (const dir of [BACKEND_DOMAINS, FRONTEND_DOMAINS]) {
		const absDir = resolve(repoRoot, dir);
		if (!TypeScript.sys.directoryExists(absDir)) continue;
		for (const file of TypeScript.sys.readDirectory(absDir, [".ts", ".tsx"])) {
			const content = TypeScript.sys.readFile(file);
			if (content !== undefined) {
				files[normalizeRepoRelativePath(relative(repoRoot, file))] = content;
			}
		}
	}
	return files;
}

const repositoryRoot = resolve(import.meta.dir, "../../..");
const bDom = (sub: string): string => `${BACKEND_DOMAINS}/${sub}`;
const fDom = (sub: string): string => `${FRONTEND_DOMAINS}/${sub}`;
const buildLines = (n: number): string =>
	`${Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`;
const rulesOf = (files: Readonly<Record<string, string>>): BoundaryRuleId[] =>
	analyzeArchitectureBoundaries(files).map((v) => v.rule);

test("verifies the 7 canonical bounded contexts form a strict acyclic DAG", () => {
	expect(BOUNDED_CONTEXTS).toHaveLength(7);
	expect(Object.keys(ALLOWED_UPSTREAM_CONTEXTS)).toEqual([...BOUNDED_CONTEXTS]);
	expect(findGraphCycles(ALLOWED_UPSTREAM_CONTEXTS)).toEqual([]);
	expect(findGraphCycles({ a: ["b"], b: ["a"] })).toEqual(["a -> b -> a"]);
});

test("enforces zero architecture boundary violations on the live repository", () => {
	expect(
		analyzeArchitectureBoundaries(loadRepositoryDomainFiles(repositoryRoot)),
	).toEqual([]);
});

test("accepts valid imports across all 7 bounded contexts and 500-line files", () => {
	expect(
		rulesOf({
			[bDom("tenant-org/index.ts")]: buildLines(MAX_DOMAIN_FILE_LINES),
			[bDom("tenant-org/service.ts")]:
				'import type { T } from "@festival/common"; import { c } from "../../infra/cache.js"; import { g } from "../../routes/shared/csrf-guard.js"; import { v0 } from "./index.js"; export { c, g, v0 }; export type { T };',
			[bDom("catalog-repertoire/service.ts")]:
				'import { v0 } from "../tenant-org/index.js"; export { v0 };',
			[bDom("customer-identity/service.ts")]:
				'import type { v0 } from "../tenant-org/index.ts"; export type { v0 };',
			[bDom("teacher-directory/service.ts")]:
				'import { a } from "../tenant-org"; import { b } from "../catalog-repertoire/index.js"; import { c } from "../customer-identity/index.js"; export { a, b, c };',
			[bDom("volunteers-comms/service.ts")]:
				'import { a } from "../tenant-org/index.js"; import { b } from "../catalog-repertoire/index.js"; import { c } from "../customer-identity/index.js"; export { a, b, c };',
			[bDom("class-checkout/routes/checkout.routes.ts")]:
				'import { a } from "../../tenant-org/index.js"; import { b } from "../../catalog-repertoire/index.js"; import { c } from "../../customer-identity/index.js"; import { d } from "../../teacher-directory/index.js"; import { g } from "../../../routes/shared/csrf-guard.js"; export { a, b, c, d, g };',
			[bDom("commerce-projection/service.ts")]:
				'import { a } from "../tenant-org/index.js"; import { b } from "../catalog-repertoire/index.js"; import { c } from "../customer-identity/index.js"; import { d } from "../teacher-directory/index.js"; import { e } from "../class-checkout/index.js"; export { a, b, c, d, e };',
			[fDom("catalog/CatalogView.tsx")]: buildLines(MAX_DOMAIN_FILE_LINES),
		}),
	).toEqual([]);
});

test("flags downward, sibling, and Windows-backslash cross-domain dependencies", () => {
	const rules = rulesOf({
		[bDom("tenant-org/downward.ts")]:
			'import { x } from "../catalog-repertoire/index.js"; export { x };',
		[bDom("class-checkout/downward.ts")]:
			'import { x } from "../commerce-projection/index.js"; export { x };',
		[bDom("catalog-repertoire/sibling.ts")]:
			'import { x } from "../customer-identity/index.js"; export { x };',
		[bDom("class-checkout/sibling.ts")]:
			'import { x } from "../volunteers-comms/index.js"; export { x };',
		[bDom("teacher-directory/sibling.ts")]:
			'import { x } from "../volunteers-comms/index.js"; export { x };',
		"packages\\backend\\src\\domains\\commerce-projection\\sibling.ts": String.raw`import { x } from "..\\volunteers-comms\\index.js"; export { x };`,
	});
	expect(rules).toEqual(Array(6).fill("cross-domain-dag"));
});

test("flags deep internal cross-domain imports bypassing public barrel", () => {
	expect(
		rulesOf({
			[bDom("teacher-directory/deep.ts")]:
				'import { repo } from "../catalog-repertoire/repertoire-repo.js"; export { repo };',
			[bDom("class-checkout/nested.ts")]:
				'import { r } from "../teacher-directory/routes/index.js"; export { r };',
		}),
	).toEqual(["public-barrel-only", "public-barrel-only"]);
});

test("flags escapes, forbidden packages, unknown contexts, 501-line files, re-exports, and dynamic imports", () => {
	const over = buildLines(MAX_DOMAIN_FILE_LINES + 1);
	const rules = rulesOf({
		[bDom("customer-identity/escape.ts")]:
			'import { svc } from "../../services/organization-service.js"; export { svc };',
		[bDom("tenant-org/pkg.ts")]:
			'import { ui } from "@festival/frontend"; import { ext } from "@festival/shopify-confirmation"; export { ui, ext };',
		[bDom("unknown-context/foo.ts")]: "export const x = 1;\n",
		[bDom("stray.ts")]: "export const y = 2;\n",
		[bDom("tenant-org/oversized.ts")]: over,
		[fDom("catalog/OversizedView.tsx")]: over,
		[bDom("tenant-org/reexport-and-dynamic.ts")]:
			'export * from "../commerce-projection/index.js"; export const load = () => import("../commerce-projection/index.js");',
	});
	expect(rules.join(",")).toBe(
		"permitted-backend-layer,forbidden-package,forbidden-package,known-context,known-context,line-ceiling,line-ceiling,cross-domain-dag,cross-domain-dag",
	);
});
