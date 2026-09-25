import { fileURLToPath } from "node:url";
import TypeScript from "typescript";

type Position = { line: number; character: number };

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectories = ["packages/backend/src", "packages/backend/tests"];
const files = sourceDirectories.flatMap((directory) =>
	TypeScript.sys.readDirectory(
		`${projectRoot}${directory}`,
		[".ts"],
		undefined,
		undefined,
	),
);

function readDollarQuote(sql: string, offset: number): string | undefined {
	const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
		sql.slice(offset),
	);
	return match?.[0];
}

function scanSql(sql: string): { placeholders: number[]; statementCount: number } {
	const placeholders: number[] = [];
	let statementCount = 0;
	let hasStatementContent = false;
	let offset = 0;

	while (offset < sql.length) {
		const character = sql[offset];
		const nextCharacter = sql[offset + 1];

		if (character === "-" && nextCharacter === "-") {
			offset = sql.indexOf("\n", offset + 2);
			if (offset === -1) break;
			continue;
		}
		if (character === "/" && nextCharacter === "*") {
			const end = sql.indexOf("*/", offset + 2);
			offset = end === -1 ? sql.length : end + 2;
			continue;
		}
		if (character === "'" || character === '"') {
			const quote = character;
			hasStatementContent = true;
			offset += 1;
			while (offset < sql.length) {
				if (sql[offset] === quote) {
					if (sql[offset + 1] === quote) {
						offset += 2;
						continue;
					}
					offset += 1;
					break;
				}
				offset += 1;
			}
			continue;
		}
		if (character === "$") {
			const dollarQuote = readDollarQuote(sql, offset);
			if (dollarQuote) {
				hasStatementContent = true;
				const end = sql.indexOf(dollarQuote, offset + dollarQuote.length);
				offset = end === -1 ? sql.length : end + dollarQuote.length;
				continue;
			}

			const placeholder = /^\$(\d+)/.exec(sql.slice(offset));
			if (placeholder) {
				placeholders.push(Number(placeholder[1]));
				hasStatementContent = true;
				offset += placeholder[0].length;
				continue;
			}
		}
		if (character === ";") {
			if (hasStatementContent) statementCount += 1;
			hasStatementContent = false;
			offset += 1;
			continue;
		}
		if (!/\s/.test(character)) hasStatementContent = true;
		offset += 1;
	}

	if (hasStatementContent) statementCount += 1;
	return { placeholders, statementCount };
}

function isIdentifierLike(expression: TypeScript.Expression): boolean {
	return (
		TypeScript.isIdentifier(expression) ||
		(TypeScript.isPropertyAccessExpression(expression) &&
			isIdentifierLike(expression.expression))
	);
}

function getStaticSql(expression: TypeScript.Expression): string | undefined {
	if (
		TypeScript.isStringLiteral(expression) ||
		TypeScript.isNoSubstitutionTemplateLiteral(expression)
	)
		return expression.text;
	if (
		TypeScript.isTemplateExpression(expression) &&
		expression.templateSpans.every((span) => isIdentifierLike(span.expression))
	) {
		return expression.templateSpans.reduce(
			(sql, span) => `${sql} identifier_placeholder ${span.literal.text}`,
			expression.head.text,
		);
	}
	return undefined;
}

function isSqlUnsafeCall(node: TypeScript.CallExpression): boolean {
	return (
		TypeScript.isPropertyAccessExpression(node.expression) &&
		node.expression.name.text === "unsafe" &&
		TypeScript.isIdentifier(node.expression.expression) &&
		node.expression.expression.text === "sql"
	);
}

function formatPosition(sourceFile: TypeScript.SourceFile, position: Position): string {
	return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}`;
}

const errors: string[] = [];

for (const fileName of files) {
	const sourceText = TypeScript.sys.readFile(fileName);
	if (!sourceText) continue;
	const sourceFile = TypeScript.createSourceFile(
		fileName,
		sourceText,
		TypeScript.ScriptTarget.Latest,
		true,
	);

	function visit(node: TypeScript.Node): void {
		if (
			TypeScript.isCallExpression(node) &&
			isSqlUnsafeCall(node) &&
			node.arguments.length >= 2 &&
			TypeScript.isArrayLiteralExpression(node.arguments[1])
		) {
			const query = getStaticSql(node.arguments[0]);
			if (query !== undefined) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
				const location = formatPosition(sourceFile, position);
				const { placeholders, statementCount } = scanSql(query);
				const uniquePlaceholders = [...new Set(placeholders)].sort((a, b) => a - b);
				const highestPlaceholder = uniquePlaceholders.at(-1) ?? 0;
				const expectedPlaceholders = Array.from(
					{ length: highestPlaceholder },
					(_, index) => index + 1,
				);

				if (statementCount > 1 && placeholders.length > 0) {
					errors.push(
						`${location}: parameterized sql.unsafe query contains ${statementCount} statements; PostgreSQL prepared statements accept one command.`,
					);
				}
				if (
					uniquePlaceholders.length !== expectedPlaceholders.length ||
					uniquePlaceholders.some((value, index) => value !== expectedPlaceholders[index])
				) {
					errors.push(
						`${location}: SQL placeholders must be contiguous from $1; found ${uniquePlaceholders.map((value) => `$${value}`).join(", ") || "none"}.`,
					);
				}
				if (node.arguments[1].elements.some(TypeScript.isSpreadElement)) {
					errors.push(
						`${location}: cannot validate an inline parameter array containing a spread element.`,
					);
				} else if (node.arguments[1].elements.length !== highestPlaceholder) {
					errors.push(
						`${location}: SQL uses placeholders through $${highestPlaceholder}, but its inline parameter array has ${node.arguments[1].elements.length} elements.`,
					);
				}
			}
		}

		TypeScript.forEachChild(node, visit);
	}

	visit(sourceFile);
}

if (errors.length > 0) {
	console.error("SQL validation failed:\n\n" + errors.map((error) => `- ${error}`).join("\n"));
	process.exitCode = 1;
} else {
	console.log(`Validated ${files.length} backend TypeScript files.`);
}
