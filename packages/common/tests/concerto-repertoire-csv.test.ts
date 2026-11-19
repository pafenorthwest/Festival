import { describe, expect, it } from "bun:test";
import {
	CONCERTO_REPERTOIRE_CSV_HEADER_LINE,
	CONCERTO_REPERTOIRE_CSV_HEADERS,
	CONCERTO_REPERTOIRE_CSV_TEMPLATE,
	type ConcertoCsvParseResult,
	type ConcertoCsvValidationErrorDto,
	type ConcertoRepertoireCsvExportRow,
	type ParsedConcertoCsvRow,
	parseConcertoRepertoireCsv,
	serializeConcertoRepertoireCsv,
} from "../src/concerto-repertoire-csv.js";
import * as commonIndex from "../src/index.js";

function toExportRows(
	rows: readonly ParsedConcertoCsvRow[],
): ConcertoRepertoireCsvExportRow[] {
	return rows.map((row) => ({
		workId: row.workId ?? "",
		title: row.title,
		composer: row.composer,
		imslpUrl: row.imslpUrl,
	}));
}

describe("concerto repertoire CSV contract", () => {
	describe("constants and barrel exports", () => {
		it("defines canonical header constants and template", () => {
			expect(CONCERTO_REPERTOIRE_CSV_HEADERS).toEqual([
				"work_id",
				"title",
				"composer",
				"imslp_url",
			]);
			expect(CONCERTO_REPERTOIRE_CSV_HEADER_LINE).toBe(
				"work_id,title,composer,imslp_url",
			);
			expect(CONCERTO_REPERTOIRE_CSV_TEMPLATE).toBe(
				"work_id,title,composer,imslp_url\n",
			);
		});

		it("re-exports CSV constants and helpers from @festival/common barrel", () => {
			expect(commonIndex.CONCERTO_REPERTOIRE_CSV_HEADERS).toBe(
				CONCERTO_REPERTOIRE_CSV_HEADERS,
			);
			expect(commonIndex.CONCERTO_REPERTOIRE_CSV_HEADER_LINE).toBe(
				CONCERTO_REPERTOIRE_CSV_HEADER_LINE,
			);
			expect(commonIndex.CONCERTO_REPERTOIRE_CSV_TEMPLATE).toBe(
				CONCERTO_REPERTOIRE_CSV_TEMPLATE,
			);
			expect(commonIndex.parseConcertoRepertoireCsv).toBe(
				parseConcertoRepertoireCsv,
			);
			expect(commonIndex.serializeConcertoRepertoireCsv).toBe(
				serializeConcertoRepertoireCsv,
			);
		});
	});

	describe("parseConcertoRepertoireCsv valid inputs", () => {
		it("parses header-only template with LF, CRLF, BOM, or no trailing newline", () => {
			for (const input of [
				CONCERTO_REPERTOIRE_CSV_TEMPLATE,
				"work_id,title,composer,imslp_url\r\n",
				"work_id,title,composer,imslp_url",
				`\uFEFF${CONCERTO_REPERTOIRE_CSV_TEMPLATE}`,
			]) {
				const result: ConcertoCsvParseResult =
					parseConcertoRepertoireCsv(input);
				expect(result).toEqual({
					headerValid: true,
					rows: [],
					errors: [],
				});
			}
		});

		it("trims fields, normalizes lowercase keys, and maps blank optional fields to null", () => {
			const csv = [
				"\uFEFFwork_id,title,composer,imslp_url",
				"  work-1  ,  Piano Concerto No. 2  ,  Sergei Rachmaninoff  ,  https://imslp.org/wiki/Test  ",
				"   , Violin Concerto in D , Pyotr Tchaikovsky ,   ",
				"",
			].join("\r\n");

			const result = parseConcertoRepertoireCsv(csv);
			expect(result.headerValid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.rows).toEqual([
				{
					rowNumber: 2,
					workId: "work-1",
					title: "Piano Concerto No. 2",
					normalizedTitle: "piano concerto no. 2",
					composer: "Sergei Rachmaninoff",
					normalizedComposer: "sergei rachmaninoff",
					imslpUrl: "https://imslp.org/wiki/Test",
				},
				{
					rowNumber: 3,
					workId: null,
					title: "Violin Concerto in D",
					normalizedTitle: "violin concerto in d",
					composer: "Pyotr Tchaikovsky",
					normalizedComposer: "pyotr tchaikovsky",
					imslpUrl: null,
				},
			]);
		});

		it("preserves embedded newlines, escaped quotes, and Unicode with 1-based record numbers", () => {
			const csv =
				"work_id,title,composer,imslp_url\r\n" +
				'w-1,"Concerto ""l\'Estate"",\nOp. 8 No. 2","Antonio\r\nVivaldi",http://imslp.org/wiki/Summer\r\n' +
				"w-2,梁祝小提琴协奏曲,Niccolò Paganini & 何占豪,https://imslp.org/wiki/Butterfly\n";

			const result = parseConcertoRepertoireCsv(csv);
			expect(result.headerValid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.rows).toEqual([
				{
					rowNumber: 2,
					workId: "w-1",
					title: 'Concerto "l\'Estate",\nOp. 8 No. 2',
					normalizedTitle: 'concerto "l\'estate",\nop. 8 no. 2',
					composer: "Antonio\r\nVivaldi",
					normalizedComposer: "antonio\r\nvivaldi",
					imslpUrl: "http://imslp.org/wiki/Summer",
				},
				{
					rowNumber: 3,
					workId: "w-2",
					title: "梁祝小提琴协奏曲",
					normalizedTitle: "梁祝小提琴协奏曲",
					composer: "Niccolò Paganini & 何占豪",
					normalizedComposer: "niccolò paganini & 何占豪",
					imslpUrl: "https://imslp.org/wiki/Butterfly",
				},
			]);
		});

		it("accepts boundary lengths for work_id (128), title (300), composer (300), and imslp_url (2048)", () => {
			const workId = "w".repeat(128);
			const title = "T".repeat(300);
			const composer = "C".repeat(300);
			const prefix = "https://imslp.org/wiki/";
			const imslpUrl = `${prefix}${"a".repeat(2048 - prefix.length)}`;

			const result = parseConcertoRepertoireCsv(
				`${CONCERTO_REPERTOIRE_CSV_HEADER_LINE}\n${workId},${title},${composer},${imslpUrl}\n`,
			);
			expect(result.headerValid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0]?.imslpUrl?.length).toBe(2048);
		});
	});

	describe("parseConcertoRepertoireCsv validation errors", () => {
		it("reports empty file as rowNumber 1 header error", () => {
			for (const emptyCsv of ["", "\uFEFF", "   "]) {
				const result = parseConcertoRepertoireCsv(emptyCsv);
				expect(result.headerValid).toBe(false);
				expect(result.rows).toEqual([]);
				expect(result.errors.length).toBeGreaterThan(0);
				expect(result.errors[0]).toMatchObject({
					rowNumber: 1,
					field: "header",
				});
				expect(result.errors[0]?.code.length).toBeGreaterThan(0);
				expect(result.errors[0]?.message.length).toBeGreaterThan(0);
			}
		});

		it("reports wrong header names, column count, or order on rowNumber 1", () => {
			const badHeaders = [
				"id,title,composer,imslp_url\n",
				"work_id,title,composer\n",
				"work_id,title,composer,imslp_url,notes\n",
				"title,work_id,composer,imslp_url\n",
			];

			for (const csv of badHeaders) {
				const result = parseConcertoRepertoireCsv(csv);
				expect(result.headerValid).toBe(false);
				expect(result.errors[0]).toMatchObject({
					rowNumber: 1,
					field: "header",
				});
			}
		});

		it("reports malformed RFC 4180 quotes on field 'csv' with offending 1-based rowNumber", () => {
			const unclosed = parseConcertoRepertoireCsv(
				`${CONCERTO_REPERTOIRE_CSV_HEADER_LINE}\nw1,"Unclosed title,Mozart,\n`,
			);
			expect(unclosed.errors).toContainEqual(
				expect.objectContaining({
					rowNumber: 2,
					field: "csv",
				}),
			);

			const unescapedMidField = parseConcertoRepertoireCsv(
				`${CONCERTO_REPERTOIRE_CSV_HEADER_LINE}\nw1,Good,Mozart,\nw2,Bad"Quote,Bach,\n`,
			);
			expect(unescapedMidField.errors).toContainEqual(
				expect.objectContaining({
					rowNumber: 3,
					field: "csv",
				}),
			);

			const trailingAfterQuote = parseConcertoRepertoireCsv(
				`${CONCERTO_REPERTOIRE_CSV_HEADER_LINE}\nw1,Good,Mozart,\nw2,"Quoted"extra,Bach,\n`,
			);
			expect(trailingAfterQuote.errors).toContainEqual(
				expect.objectContaining({
					rowNumber: 3,
					field: "csv",
				}),
			);
		});

		it("reports < 4 or > 4 columns on field 'row' with 1-based rowNumber", () => {
			const csv = [
				CONCERTO_REPERTOIRE_CSV_HEADER_LINE,
				"w1,Only Three,Mozart",
				"w2,Valid Title,Valid Composer,",
				"w3,Too Many,Mozart,,extra",
			].join("\n");

			const result = parseConcertoRepertoireCsv(csv);
			expect(result.headerValid).toBe(true);
			expect(result.errors).toEqual([
				expect.objectContaining({ rowNumber: 2, field: "row" }),
				expect.objectContaining({ rowNumber: 4, field: "row" }),
			]);
		});

		it("reports field-level errors for work_id, title, composer, and imslp_url", () => {
			const longWorkId = "w".repeat(129);
			const longTitle = "T".repeat(301);
			const longComposer = "C".repeat(301);
			const longUrl = `https://imslp.org/wiki/${"u".repeat(2030)}`;

			const csv = [
				CONCERTO_REPERTOIRE_CSV_HEADER_LINE,
				`${longWorkId},Concerto,Mozart,`,
				"w2,   ,Mozart,",
				`w3,${longTitle},Mozart,`,
				"w4,Concerto,   ,",
				`w5,Concerto,${longComposer},`,
				"w6,Concerto,Mozart,ftp://imslp.org/wiki/Bad_Scheme",
				"w7,Concerto,Mozart,imslp.org/wiki/Missing_Scheme",
				"w8,Concerto,Mozart,https://imslp.org/wiki/Has Space",
				`w9,Concerto,Mozart,${longUrl}`,
			].join("\n");

			const result = parseConcertoRepertoireCsv(csv);
			const simplified = result.errors.map(
				(err: ConcertoCsvValidationErrorDto) => ({
					rowNumber: err.rowNumber,
					field: err.field,
				}),
			);

			expect(simplified).toEqual([
				{ rowNumber: 2, field: "work_id" },
				{ rowNumber: 3, field: "title" },
				{ rowNumber: 4, field: "title" },
				{ rowNumber: 5, field: "composer" },
				{ rowNumber: 6, field: "composer" },
				{ rowNumber: 7, field: "imslp_url" },
				{ rowNumber: 8, field: "imslp_url" },
				{ rowNumber: 9, field: "imslp_url" },
				{ rowNumber: 10, field: "imslp_url" },
			]);
		});
	});

	describe("serializeConcertoRepertoireCsv and lossless round-trips", () => {
		it("serializes empty rows as CONCERTO_REPERTOIRE_CSV_TEMPLATE", () => {
			expect(serializeConcertoRepertoireCsv([])).toBe(
				CONCERTO_REPERTOIRE_CSV_TEMPLATE,
			);
		});

		it("quotes fields with commas, quotes, CR/LF, or surrounding whitespace", () => {
			const serialized = serializeConcertoRepertoireCsv([
				{
					workId: "w-1",
					title: 'Concerto "Emperor", No. 5',
					composer: " Ludwig van Beethoven ",
					imslpUrl: null,
				},
			]);

			expect(serialized).toBe(
				'work_id,title,composer,imslp_url\nw-1,"Concerto ""Emperor"", No. 5"," Ludwig van Beethoven ",\n',
			);
		});

		it("round-trips embedded commas, escaped quotes, embedded LF/CRLF, and Unicode losslessly", () => {
			const originalRows: ConcertoRepertoireCsvExportRow[] = [
				{
					workId: "work-quote-1",
					title: 'Concerto in D, "The Hunt" — Movement I\nAllegro',
					composer: 'Wolfgang "Amadeus"\r\nMozart',
					imslpUrl: "https://imslp.org/wiki/Horn_Concerto_No.4,_K.495",
				},
				{
					workId: "work-unicode-2",
					title: "Mosè-fantasia, MS 23 / 梁祝",
					composer: "Niccolò Paganini",
					imslpUrl: null,
				},
			];

			const csv = serializeConcertoRepertoireCsv(originalRows);
			const parsed = parseConcertoRepertoireCsv(csv);
			expect(parsed.headerValid).toBe(true);
			expect(parsed.errors).toEqual([]);
			expect(toExportRows(parsed.rows)).toEqual(originalRows);
			expect(serializeConcertoRepertoireCsv(toExportRows(parsed.rows))).toBe(
				csv,
			);
		});

		it("round-trips real database/bootstrap/pafe-concertos.csv (all 25 rows) with 0 errors", async () => {
			const bootstrapUrl = new URL(
				"../../../database/bootstrap/pafe-concertos.csv",
				import.meta.url,
			);
			const rawCsv = await Bun.file(bootstrapUrl).text();

			const firstParse = parseConcertoRepertoireCsv(rawCsv);
			expect(firstParse.headerValid).toBe(true);
			expect(firstParse.errors).toEqual([]);
			expect(firstParse.rows).toHaveLength(25);

			const wieniawskiDuplicates = firstParse.rows.filter(
				(row) =>
					row.workId === "pafe-bootstrap-work-21" ||
					row.workId === "pafe-bootstrap-work-22",
			);
			expect(wieniawskiDuplicates).toHaveLength(2);
			expect(wieniawskiDuplicates[0]?.title).toBe(
				"Violin Concerto No. 2 in D minor, Op. 22",
			);
			expect(wieniawskiDuplicates[0]?.composer).toBe("Henryk Wieniawski");
			expect(wieniawskiDuplicates[1]?.title).toBe(
				wieniawskiDuplicates[0]?.title,
			);
			expect(wieniawskiDuplicates[1]?.composer).toBe(
				wieniawskiDuplicates[0]?.composer,
			);

			const emptyUrlRow = firstParse.rows.find(
				(row) => row.workId === "pafe-bootstrap-work-11",
			);
			expect(emptyUrlRow?.imslpUrl).toBeNull();

			const paganiniRow = firstParse.rows.find(
				(row) => row.workId === "pafe-bootstrap-work-295",
			);
			expect(paganiniRow?.composer).toBe("Niccolò Paganini");

			const reserialized = serializeConcertoRepertoireCsv(
				toExportRows(firstParse.rows),
			);
			const secondParse = parseConcertoRepertoireCsv(reserialized);
			expect(secondParse).toEqual(firstParse);
			expect(
				serializeConcertoRepertoireCsv(toExportRows(secondParse.rows)),
			).toBe(reserialized);
		});
	});
});
