import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type LexerState = {
	mode: "normal" | "line" | "block" | "single" | "double";
	dollarTag: string | undefined;
	placeholders: number[];
	statementCount: number;
	hasContent: boolean;
};

type SqlAnalysis = LexerState & {
	staticPlaceholders: boolean;
	singleQuotedInterp: boolean;
	nonIdentInterp: boolean;
};

type FileContext = { sourceFile: ts.SourceFile; isTestSuite: boolean };

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultDirs = ["packages/backend/src", "packages/backend/tests"];
const sqlReceivers = new Set(
	"sql,tx,transaction,runner,database,client".split(","),
);

function normalizePath(filePath: string): string {
	const normalized = resolve(filePath).replaceAll("\\", "/");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

const testsRoot = `${normalizePath(resolve(projectRoot, "packages/backend/tests"))}/`;

function collectTargetFiles(cliArgs: string[]): string[] {
	const targets =
		cliArgs.length > 0
			? cliArgs.map((target) => resolve(target))
			: defaultDirs.map((dir) => resolve(projectRoot, dir));
	return targets.flatMap((target) =>
		ts.sys.fileExists(target)
			? [target]
			: ts.sys.readDirectory(target, [".ts"], undefined, undefined),
	);
}

function stepActiveRegion(state: LexerState, sql: string, i: number): number {
	if (state.dollarTag) {
		const end = sql.indexOf(state.dollarTag, i);
		if (end === -1) return sql.length;
		const next = end + state.dollarTag.length;
		state.dollarTag = undefined;
		return next;
	}
	if (state.mode === "line" || state.mode === "block") {
		const endToken = state.mode === "line" ? "\n" : "*/";
		const end = sql.indexOf(endToken, i);
		if (end === -1) return sql.length;
		state.mode = "normal";
		return end + endToken.length;
	}
	const quote = state.mode === "single" ? "'" : '"';
	if (sql[i] === quote) {
		if (sql[i + 1] === quote) return i + 2;
		state.mode = "normal";
	}
	return i + 1;
}

function stepNormalToken(state: LexerState, sql: string, i: number): number {
	const ch = sql[i];
	const next = sql[i + 1];
	if (ch === "-" && next === "-") {
		state.mode = "line";
		return i + 2;
	}
	if (ch === "/" && next === "*") {
		state.mode = "block";
		return i + 2;
	}
	if (ch === "'" || ch === '"') {
		state.hasContent = true;
		state.mode = ch === "'" ? "single" : "double";
		return i + 1;
	}
	if (ch === "$") {
		const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i))?.[0];
		if (tag) {
			state.hasContent = true;
			state.dollarTag = tag;
			return i + tag.length;
		}
		const match = /^\$(\d+)/.exec(sql.slice(i));
		if (match) {
			state.placeholders.push(Number(match[1]));
			state.hasContent = true;
			return i + match[0].length;
		}
	}
	if (ch === ";") {
		if (state.hasContent) state.statementCount += 1;
		state.hasContent = false;
		return i + 1;
	}
	if (!/\s/.test(ch)) state.hasContent = true;
	return i + 1;
}

function advanceLexer(state: LexerState, sql: string): void {
	let i = 0;
	while (i < sql.length) {
		i =
			state.dollarTag || state.mode !== "normal"
				? stepActiveRegion(state, sql, i)
				: stepNormalToken(state, sql, i);
	}
}

function isIdentifierLike(expr: ts.Expression): boolean {
	return (
		ts.isIdentifier(expr) ||
		expr.kind === ts.SyntaxKind.ThisKeyword ||
		(ts.isPropertyAccessExpression(expr) && isIdentifierLike(expr.expression))
	);
}

function hasStringConcatenation(expr: ts.Expression): boolean {
	let cur = expr;
	while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
	return (
		ts.isBinaryExpression(cur) &&
		cur.operatorToken.kind === ts.SyntaxKind.PlusToken
	);
}

function analyzeSqlExpression(expr: ts.Expression): SqlAnalysis | undefined {
	const state: LexerState = {
		mode: "normal",
		dollarTag: undefined,
		placeholders: [],
		statementCount: 0,
		hasContent: false,
	};
	if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
		advanceLexer(state, expr.text);
		if (state.hasContent) state.statementCount += 1;
		return {
			...state,
			staticPlaceholders: true,
			singleQuotedInterp: false,
			nonIdentInterp: false,
		};
	}
	if (!ts.isTemplateExpression(expr)) return undefined;
	let singleQuotedInterp = false;
	let nonIdentInterp = false;
	advanceLexer(state, expr.head.text);
	for (const span of expr.templateSpans) {
		if (state.mode === "single") singleQuotedInterp = true;
		if (!isIdentifierLike(span.expression)) nonIdentInterp = true;
		advanceLexer(state, " identifier_placeholder ");
		advanceLexer(state, span.literal.text);
	}
	if (state.hasContent) state.statementCount += 1;
	return {
		...state,
		staticPlaceholders: !nonIdentInterp,
		singleQuotedInterp,
		nonIdentInterp,
	};
}

function isSqlUnsafeCall(node: ts.CallExpression): boolean {
	if (
		!ts.isPropertyAccessExpression(node.expression) ||
		node.expression.name.text !== "unsafe"
	) {
		return false;
	}
	const recv = node.expression.expression;
	if (ts.isIdentifier(recv)) return sqlReceivers.has(recv.text);
	return (
		ts.isPropertyAccessExpression(recv) && sqlReceivers.has(recv.name.text)
	);
}

function getInlineArrayErrors(
	loc: string,
	analysis: SqlAnalysis,
	arr: ts.ArrayLiteralExpression,
): string[] {
	const out: string[] = [];
	const unique = [...new Set(analysis.placeholders)].sort((a, b) => a - b);
	const highest = unique.at(-1) ?? 0;
	const contiguous =
		unique.length === highest && unique.every((v, idx) => v === idx + 1);

	if (analysis.statementCount > 1 && analysis.placeholders.length > 0) {
		out.push(
			`${loc}: parameterized sql.unsafe query contains ${analysis.statementCount} statements; PostgreSQL prepared statements accept one command.`,
		);
	}
	if (!contiguous) {
		const found = unique.map((v) => `$${v}`).join(", ") || "none";
		out.push(
			`${loc}: SQL placeholders must be contiguous from $1; found ${found}.`,
		);
	}
	if (arr.elements.some(ts.isSpreadElement)) {
		out.push(
			`${loc}: cannot validate an inline parameter array containing a spread element.`,
		);
	} else if (arr.elements.length !== highest) {
		out.push(
			`${loc}: SQL uses placeholders through $${highest}, but its inline parameter array has ${arr.elements.length} elements.`,
		);
	}
	return out;
}

function validateUnsafeCall(
	node: ts.CallExpression,
	ctx: FileContext,
	errors: string[],
): void {
	const queryArg = node.arguments[0];
	if (!queryArg) return;
	const pos = ctx.sourceFile.getLineAndCharacterOfPosition(
		node.getStart(ctx.sourceFile),
	);
	const loc = `${ctx.sourceFile.fileName}:${pos.line + 1}:${pos.character + 1}`;
	if (hasStringConcatenation(queryArg)) {
		errors.push(`${loc}: unsafe SQL query must not use string concatenation.`);
		return;
	}
	const analysis = analyzeSqlExpression(queryArg);
	if (!analysis) return;
	if (!ctx.isTestSuite && analysis.singleQuotedInterp) {
		errors.push(
			`${loc}: SQL template literal must not interpolate inside single-quoted string literals.`,
		);
	} else if (
		!ctx.isTestSuite &&
		node.arguments.length === 1 &&
		analysis.nonIdentInterp
	) {
		errors.push(
			`${loc}: unparameterized unsafe SQL template literal may only interpolate identifiers.`,
		);
	}
	if (node.arguments.length === 1) {
		if (analysis.placeholders.length > 0) {
			errors.push(
				`${loc}: unparameterized unsafe SQL query contains placeholders without parameters.`,
			);
		}
		return;
	}
	const paramArg = node.arguments[1];
	if (ts.isArrayLiteralExpression(paramArg) && analysis.staticPlaceholders) {
		errors.push(...getInlineArrayErrors(loc, analysis, paramArg));
	}
}

function validateFile(fileName: string, errors: string[]): void {
	const sourceText = ts.sys.readFile(fileName);
	if (!sourceText) return;
	const sourceFile = ts.createSourceFile(
		fileName,
		sourceText,
		ts.ScriptTarget.Latest,
		true,
	);
	const ctx: FileContext = {
		sourceFile,
		isTestSuite: normalizePath(fileName).startsWith(testsRoot),
	};
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && isSqlUnsafeCall(node)) {
			validateUnsafeCall(node, ctx, errors);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

const files = collectTargetFiles(process.argv.slice(2));
const errors: string[] = [];
for (const fileName of files) validateFile(fileName, errors);

if (errors.length > 0) {
	console.error(
		`SQL validation failed:\n\n${errors.map((e) => `- ${e}`).join("\n")}`,
	);
	process.exitCode = 1;
} else {
	console.log(`Validated ${files.length} backend TypeScript files.`);
}
