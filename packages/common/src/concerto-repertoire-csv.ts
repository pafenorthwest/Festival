import * as v from "valibot";
import { nonEmptyText } from "./schema-utils.js";

export const CONCERTO_REPERTOIRE_CSV_HEADERS = [
	"work_id",
	"title",
	"composer",
	"imslp_url",
] as const;

export const CONCERTO_REPERTOIRE_CSV_HEADER_LINE =
	CONCERTO_REPERTOIRE_CSV_HEADERS.join(",");

export const CONCERTO_REPERTOIRE_CSV_TEMPLATE = `${CONCERTO_REPERTOIRE_CSV_HEADER_LINE}\n`;

export const MAX_CONCERTO_CSV_WORK_ID_LENGTH = 128;
export const MAX_CONCERTO_CSV_TITLE_LENGTH = 300;
export const MAX_CONCERTO_CSV_COMPOSER_LENGTH = 300;
export const MAX_CONCERTO_CSV_URL_LENGTH = 2048;
export const MAX_CONCERTO_CSV_TEXT_LENGTH = 200_000;

export type ConcertoCsvErrorField =
	| "csv"
	| "header"
	| "row"
	| "work_id"
	| "title"
	| "composer"
	| "imslp_url";

export interface ConcertoCsvValidationErrorDto {
	rowNumber: number;
	field: ConcertoCsvErrorField;
	code: string;
	message: string;
}

export interface ParsedConcertoCsvRow {
	rowNumber: number;
	workId: string | null;
	title: string;
	normalizedTitle: string;
	composer: string;
	normalizedComposer: string;
	imslpUrl: string | null;
}

export interface ConcertoCsvParseResult {
	headerValid: boolean;
	rows: ParsedConcertoCsvRow[];
	errors: ConcertoCsvValidationErrorDto[];
}

export interface ConcertoRepertoireCsvExportRow {
	workId: string;
	title: string;
	composer: string;
	imslpUrl: string | null;
}

export interface ConcertoCsvAddedItemDto {
	rowNumber: number;
	existingWorkId: string | null;
	title: string;
	composer: string;
	imslpUrl: string | null;
}

export interface ConcertoCsvFieldChangeDto {
	field: "title" | "composer" | "imslp_url";
	before: string | null;
	after: string | null;
}

export interface ConcertoCsvUpdatedItemDto {
	rowNumber: number;
	workId: string;
	beforeTitle: string;
	afterTitle: string;
	beforeComposer: string;
	afterComposer: string;
	beforeImslpUrl: string | null;
	afterImslpUrl: string | null;
	changedFields: ConcertoCsvFieldChangeDto[];
}

export interface ConcertoCsvCatalogItemDto {
	workId: string;
	title: string;
	composer: string;
	imslpUrl: string | null;
}

export interface ConcertoCsvPreviewSummaryDto {
	totalRows: number;
	addedCount: number;
	updatedCount: number;
	unchangedCount: number;
	removedCount: number;
	errorCount: number;
}

export interface ConcertoRepertoireCsvPreviewDto {
	valid: boolean;
	errors: ConcertoCsvValidationErrorDto[];
	summary: ConcertoCsvPreviewSummaryDto;
	added: ConcertoCsvAddedItemDto[];
	updated: ConcertoCsvUpdatedItemDto[];
	unchangedCount: number;
	unchanged: ConcertoCsvCatalogItemDto[];
	removed: ConcertoCsvCatalogItemDto[];
	clearsEntireCatalog: boolean;
	requiresClearAllConfirmation: boolean;
	catalogDigest: string;
}

export interface ConcertoRepertoireCsvImportResultDto {
	applied: true;
	summary: {
		totalRows: number;
		addedCount: number;
		updatedCount: number;
		unchangedCount: number;
		removedCount: number;
	};
	addedWorkIds: string[];
	updatedWorkIds: string[];
	unchangedWorkIds: string[];
	removedWorkIds: string[];
	clearsEntireCatalog: boolean;
	catalogDigest: string;
}

const concertoCsvTextSchema = v.pipe(
	v.string("CSV text must be a string."),
	v.maxLength(
		MAX_CONCERTO_CSV_TEXT_LENGTH,
		`CSV text must be ${MAX_CONCERTO_CSV_TEXT_LENGTH} characters or less.`,
	),
);

export const PreviewConcertoRepertoireCsvRequestSchema = v.strictObject({
	csvText: concertoCsvTextSchema,
});

export type PreviewConcertoRepertoireCsvRequestDto = v.InferOutput<
	typeof PreviewConcertoRepertoireCsvRequestSchema
>;

export const ImportConcertoRepertoireCsvRequestSchema = v.strictObject({
	csvText: concertoCsvTextSchema,
	expectedCatalogDigest: nonEmptyText("Expected catalog digest", 256),
	confirmClearAll: v.optional(
		v.boolean("Confirm clear all must be a boolean."),
	),
});

export type ImportConcertoRepertoireCsvRequestDto = v.InferOutput<
	typeof ImportConcertoRepertoireCsvRequestSchema
>;

const CSV_ERROR_SPECS = {
	CSV_TOO_LARGE: [
		"csv",
		`CSV text must be ${MAX_CONCERTO_CSV_TEXT_LENGTH} characters or less.`,
	],
	EMPTY_CSV: [
		"header",
		`CSV is empty. Expected header: ${CONCERTO_REPERTOIRE_CSV_HEADER_LINE}.`,
	],
	INVALID_HEADER: [
		"header",
		`CSV header must match: ${CONCERTO_REPERTOIRE_CSV_HEADER_LINE}.`,
	],
	MALFORMED_CSV_QUOTE: ["csv", "Malformed RFC 4180 quote in CSV field."],
	UNCLOSED_CSV_QUOTE: ["csv", "Unclosed quoted CSV field."],
	WORK_ID_TOO_LONG: [
		"work_id",
		`work_id must be ${MAX_CONCERTO_CSV_WORK_ID_LENGTH} characters or less.`,
	],
	TITLE_REQUIRED: ["title", "title is required."],
	TITLE_TOO_LONG: [
		"title",
		`title must be ${MAX_CONCERTO_CSV_TITLE_LENGTH} characters or less.`,
	],
	COMPOSER_REQUIRED: ["composer", "composer is required."],
	COMPOSER_TOO_LONG: [
		"composer",
		`composer must be ${MAX_CONCERTO_CSV_COMPOSER_LENGTH} characters or less.`,
	],
	IMSLP_URL_TOO_LONG: [
		"imslp_url",
		`imslp_url must be ${MAX_CONCERTO_CSV_URL_LENGTH} characters or less.`,
	],
	INVALID_IMSLP_URL: [
		"imslp_url",
		"imslp_url must be a valid http:// or https:// URL.",
	],
} as const satisfies Record<string, readonly [ConcertoCsvErrorField, string]>;

type CsvErrorCode = keyof typeof CSV_ERROR_SPECS;

function csvError(
	rowNumber: number,
	code: CsvErrorCode,
): ConcertoCsvValidationErrorDto {
	const [field, message] = CSV_ERROR_SPECS[code];
	return { rowNumber, field, code, message };
}

type FieldScanStep =
	| { kind: "field"; value: string; nextIndex: number; done: boolean }
	| { kind: "error"; error: ConcertoCsvValidationErrorDto; nextIndex: number };

type CsvRecordStep =
	| {
			kind: "record";
			fields: string[];
			quotedFirst: boolean;
			nextIndex: number;
	  }
	| { kind: "error"; error: ConcertoCsvValidationErrorDto; nextIndex: number };

const fieldStep = (
	value: string,
	nextIndex: number,
	done: boolean,
): FieldScanStep => ({ kind: "field", value, nextIndex, done });

function consumeLineBreak(text: string, index: number): number {
	return text[index] === "\r" && text[index + 1] === "\n"
		? index + 2
		: index + 1;
}

function skipToNextLine(text: string, startIndex: number): number {
	let index = startIndex;
	while (index < text.length && text[index] !== "\r" && text[index] !== "\n") {
		index++;
	}
	return index < text.length ? consumeLineBreak(text, index) : index;
}

function finishClosedQuote(
	text: string,
	afterQuoteIndex: number,
	ctx: { value: string; rowNumber: number },
): FieldScanStep {
	if (afterQuoteIndex >= text.length) {
		return fieldStep(ctx.value, afterQuoteIndex, true);
	}
	const next = text[afterQuoteIndex];
	if (next === ",") return fieldStep(ctx.value, afterQuoteIndex + 1, false);
	if (next === "\r" || next === "\n") {
		return fieldStep(ctx.value, consumeLineBreak(text, afterQuoteIndex), true);
	}
	return {
		kind: "error",
		error: csvError(ctx.rowNumber, "MALFORMED_CSV_QUOTE"),
		nextIndex: skipToNextLine(text, afterQuoteIndex),
	};
}

function readQuotedField(
	text: string,
	startIndex: number,
	rowNumber: number,
): FieldScanStep {
	let index = startIndex + 1;
	let value = "";
	while (index < text.length) {
		if (text[index] === '"') {
			if (text[index + 1] === '"') {
				value += '"';
				index += 2;
				continue;
			}
			return finishClosedQuote(text, index + 1, { value, rowNumber });
		}
		value += text[index];
		index++;
	}
	return {
		kind: "error",
		error: csvError(rowNumber, "UNCLOSED_CSV_QUOTE"),
		nextIndex: text.length,
	};
}

function readUnquotedField(
	text: string,
	startIndex: number,
	rowNumber: number,
): FieldScanStep {
	for (let index = startIndex; index < text.length; index++) {
		const ch = text[index];
		if (ch === '"') {
			return {
				kind: "error",
				error: csvError(rowNumber, "MALFORMED_CSV_QUOTE"),
				nextIndex: skipToNextLine(text, index),
			};
		}
		if (ch === ",") {
			return fieldStep(text.slice(startIndex, index), index + 1, false);
		}
		if (ch === "\r" || ch === "\n") {
			return fieldStep(
				text.slice(startIndex, index),
				consumeLineBreak(text, index),
				true,
			);
		}
	}
	return fieldStep(text.slice(startIndex), text.length, true);
}

function readCsvRecord(
	text: string,
	startIndex: number,
	rowNumber: number,
): CsvRecordStep {
	const fields: string[] = [];
	const quotedFirst = text[startIndex] === '"';
	let index = startIndex;
	for (;;) {
		const step =
			text[index] === '"'
				? readQuotedField(text, index, rowNumber)
				: readUnquotedField(text, index, rowNumber);
		if (step.kind === "error") return step;
		fields.push(step.value);
		index = step.nextIndex;
		if (step.done) {
			return { kind: "record", fields, quotedFirst, nextIndex: index };
		}
	}
}

function isHeaderRecordValid(fields: readonly string[]): boolean {
	return (
		fields.length === CONCERTO_REPERTOIRE_CSV_HEADERS.length &&
		fields.every(
			(value, idx) => value.trim() === CONCERTO_REPERTOIRE_CSV_HEADERS[idx],
		)
	);
}

function isValidHttpUrl(value: string): boolean {
	if (/\s/.test(value) || !/^https?:\/\//i.test(value)) return false;
	try {
		const parsed = new URL(value);
		return (
			(parsed.protocol === "http:" || parsed.protocol === "https:") &&
			parsed.hostname.length > 0
		);
	} catch {
		return false;
	}
}

function parseDataRow(
	fields: readonly string[],
	rowNumber: number,
): {
	row: ParsedConcertoCsvRow | null;
	errors: ConcertoCsvValidationErrorDto[];
} {
	if (fields.length !== CONCERTO_REPERTOIRE_CSV_HEADERS.length) {
		return {
			row: null,
			errors: [
				{
					rowNumber,
					field: "row",
					code: "INVALID_COLUMN_COUNT",
					message: `Expected ${CONCERTO_REPERTOIRE_CSV_HEADERS.length} columns, got ${fields.length}.`,
				},
			],
		};
	}
	const errors: ConcertoCsvValidationErrorDto[] = [];
	const workId = (fields[0] ?? "").trim() || null;
	const title = (fields[1] ?? "").trim();
	const composer = (fields[2] ?? "").trim();
	const imslpUrl = (fields[3] ?? "").trim() || null;

	if (workId && workId.length > MAX_CONCERTO_CSV_WORK_ID_LENGTH) {
		errors.push(csvError(rowNumber, "WORK_ID_TOO_LONG"));
	}
	if (title.length === 0) errors.push(csvError(rowNumber, "TITLE_REQUIRED"));
	else if (title.length > MAX_CONCERTO_CSV_TITLE_LENGTH) {
		errors.push(csvError(rowNumber, "TITLE_TOO_LONG"));
	}
	if (composer.length === 0) {
		errors.push(csvError(rowNumber, "COMPOSER_REQUIRED"));
	} else if (composer.length > MAX_CONCERTO_CSV_COMPOSER_LENGTH) {
		errors.push(csvError(rowNumber, "COMPOSER_TOO_LONG"));
	}
	if (imslpUrl && imslpUrl.length > MAX_CONCERTO_CSV_URL_LENGTH) {
		errors.push(csvError(rowNumber, "IMSLP_URL_TOO_LONG"));
	} else if (imslpUrl && !isValidHttpUrl(imslpUrl)) {
		errors.push(csvError(rowNumber, "INVALID_IMSLP_URL"));
	}
	if (errors.length > 0) return { row: null, errors };
	return {
		row: {
			rowNumber,
			workId,
			title,
			normalizedTitle: title.toLowerCase(),
			composer,
			normalizedComposer: composer.toLowerCase(),
			imslpUrl,
		},
		errors: [],
	};
}

export function parseConcertoRepertoireCsv(
	csvText: string,
): ConcertoCsvParseResult {
	if (csvText.length > MAX_CONCERTO_CSV_TEXT_LENGTH) {
		return {
			headerValid: false,
			rows: [],
			errors: [csvError(1, "CSV_TOO_LARGE")],
		};
	}
	const text = csvText.startsWith("\uFEFF") ? csvText.slice(1) : csvText;
	if (text.trim().length === 0) {
		return { headerValid: false, rows: [], errors: [csvError(1, "EMPTY_CSV")] };
	}
	const headerStep = readCsvRecord(text, 0, 1);
	if (headerStep.kind === "error") {
		return { headerValid: false, rows: [], errors: [headerStep.error] };
	}
	if (!isHeaderRecordValid(headerStep.fields)) {
		return {
			headerValid: false,
			rows: [],
			errors: [csvError(1, "INVALID_HEADER")],
		};
	}
	const rows: ParsedConcertoCsvRow[] = [];
	const errors: ConcertoCsvValidationErrorDto[] = [];
	let cursor = headerStep.nextIndex;
	for (let rowNumber = 2; cursor < text.length; rowNumber++) {
		const step = readCsvRecord(text, cursor, rowNumber);
		cursor = step.nextIndex;
		if (step.kind === "error") {
			errors.push(step.error);
			continue;
		}
		if (
			!step.quotedFirst &&
			step.fields.length === 1 &&
			step.fields[0]?.trim() === ""
		) {
			continue;
		}
		const parsed = parseDataRow(step.fields, rowNumber);
		if (parsed.row) rows.push(parsed.row);
		errors.push(...parsed.errors);
	}
	return { headerValid: true, rows, errors };
}

function escapeCsvField(value: string | null): string {
	if (value === null || value.length === 0) return "";
	const needsQuoting =
		value.includes(",") ||
		value.includes('"') ||
		value.includes("\n") ||
		value.includes("\r") ||
		value.trim() !== value;
	return needsQuoting ? `"${value.replaceAll('"', '""')}"` : value;
}

export function serializeConcertoRepertoireCsv(
	rows: readonly ConcertoRepertoireCsvExportRow[],
): string {
	if (rows.length === 0) return CONCERTO_REPERTOIRE_CSV_TEMPLATE;
	const lines = rows.map((row) =>
		[
			escapeCsvField(row.workId),
			escapeCsvField(row.title),
			escapeCsvField(row.composer),
			escapeCsvField(row.imslpUrl),
		].join(","),
	);
	return `${CONCERTO_REPERTOIRE_CSV_HEADER_LINE}\n${lines.join("\n")}\n`;
}
