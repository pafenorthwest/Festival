import { describe, expect, it } from "bun:test";
import {
	type EntitlementReportEntry,
	filterEntitlementReportEntries,
	listEntitlementReportDivisions,
	paginateEntitlementReportEntries,
	parseEntitlementReportFilters,
	parseEntitlementReportPage,
} from "./entitlement-report.js";

const entry = (
	overrides: Partial<EntitlementReportEntry>,
): EntitlementReportEntry => ({
	id: "e1",
	entitlementClass: "teacher_membership",
	customerName: "Aaron Teacher",
	customerEmail: "aaron@example.com",
	offeringName: "Teacher Membership",
	divisions: [],
	startsOn: "2026-09-12",
	endsOn: "2027-09-12",
	source: "teacher_checkout",
	status: "active",
	...overrides,
});

describe("parseEntitlementReportFilters", () => {
	it("returns no filters for empty or blank values", () => {
		expect(parseEntitlementReportFilters({})).toEqual({});
		expect(
			parseEntitlementReportFilters({
				search: "  ",
				entitlementClass: "",
				status: " ",
			}),
		).toEqual({});
	});

	it("trims and accepts valid filters", () => {
		expect(
			parseEntitlementReportFilters({
				search: "  aaron ",
				entitlementClass: "accompanist_membership",
				status: "expired",
			}),
		).toEqual({
			search: "aaron",
			entitlementClass: "accompanist_membership",
			status: "expired",
		});
	});

	it("rejects unknown classes, statuses, and oversized search text", () => {
		expect(() =>
			parseEntitlementReportFilters({ entitlementClass: "student" }),
		).toThrow("Entitlement class filter is invalid.");
		expect(() => parseEntitlementReportFilters({ status: "pending" })).toThrow(
			"Status filter is invalid.",
		);
		expect(() =>
			parseEntitlementReportFilters({ search: "x".repeat(201) }),
		).toThrow("Search text is too long.");
	});
});

describe("filterEntitlementReportEntries", () => {
	const entries = [
		entry({ id: "e1" }),
		entry({
			id: "e2",
			entitlementClass: "accompanist_membership",
			customerName: "Beth Accompanist",
			customerEmail: "beth@example.com",
			status: "expired",
		}),
		entry({ id: "e3", customerName: undefined, customerEmail: undefined }),
	];

	it("combines filters with AND semantics", () => {
		expect(
			filterEntitlementReportEntries(entries, {
				entitlementClass: "teacher_membership",
				status: "active",
			}).map((e) => e.id),
		).toEqual(["e1", "e3"]);
	});

	it("matches search case-insensitively on name or email and tolerates missing customers", () => {
		expect(
			filterEntitlementReportEntries(entries, { search: "BETH@" }).map(
				(e) => e.id,
			),
		).toEqual(["e2"]);
		expect(
			filterEntitlementReportEntries(entries, { search: "teacher" }).map(
				(e) => e.id,
			),
		).toEqual(["e1"]);
	});

	it("filters by division id, including entries holding several divisions", () => {
		const piano = { divisionId: "d-piano", divisionName: "Piano" };
		const voice = { divisionId: "d-voice", divisionName: "Voice" };
		const withDivisions = [
			entry({ id: "p", divisions: [piano] }),
			entry({ id: "pv", divisions: [piano, voice] }),
			entry({ id: "v", divisions: [voice] }),
			entry({ id: "none", divisions: [] }),
		];
		expect(
			filterEntitlementReportEntries(withDivisions, {
				divisionId: "d-voice",
			}).map((e) => e.id),
		).toEqual(["pv", "v"]);
	});
});

describe("parseEntitlementReportFilters division", () => {
	it("trims the division id and rejects oversized values", () => {
		expect(parseEntitlementReportFilters({ divisionId: " d1 " })).toEqual({
			divisionId: "d1",
		});
		expect(() =>
			parseEntitlementReportFilters({ divisionId: "x".repeat(201) }),
		).toThrow("Division filter is invalid.");
	});
});

describe("parseEntitlementReportPage", () => {
	it("defaults to the first page of 25", () => {
		expect(parseEntitlementReportPage({})).toEqual({ page: 1, pageSize: 25 });
		expect(parseEntitlementReportPage({ page: " ", pageSize: "" })).toEqual({
			page: 1,
			pageSize: 25,
		});
	});

	it("accepts positive integers up to the maximum page size", () => {
		expect(parseEntitlementReportPage({ page: "3", pageSize: "100" })).toEqual({
			page: 3,
			pageSize: 100,
		});
	});

	it("rejects zero, negatives, fractions, text, and oversized pages", () => {
		for (const page of ["0", "-1", "1.5", "abc", "1e3"]) {
			expect(() => parseEntitlementReportPage({ page })).toThrow(
				"Page is invalid.",
			);
		}
		for (const pageSize of ["0", "101", "x"]) {
			expect(() => parseEntitlementReportPage({ pageSize })).toThrow(
				"Page size is invalid.",
			);
		}
	});
});

describe("paginateEntitlementReportEntries", () => {
	const many = Array.from({ length: 7 }, (_, i) => entry({ id: `e${i + 1}` }));

	it("returns the requested slice with totals", () => {
		const result = paginateEntitlementReportEntries(many, {
			page: 2,
			pageSize: 3,
		});
		expect(result.entries.map((e) => e.id)).toEqual(["e4", "e5", "e6"]);
		expect(result).toMatchObject({
			total: 7,
			page: 2,
			pageSize: 3,
			totalPages: 3,
		});
	});

	it("clamps a page past the end to the last page", () => {
		const result = paginateEntitlementReportEntries(many, {
			page: 99,
			pageSize: 3,
		});
		expect(result.page).toBe(3);
		expect(result.entries.map((e) => e.id)).toEqual(["e7"]);
	});

	it("reports one empty page when there are no entries", () => {
		expect(
			paginateEntitlementReportEntries([], { page: 4, pageSize: 25 }),
		).toEqual({ entries: [], total: 0, page: 1, pageSize: 25, totalPages: 1 });
	});
});

describe("listEntitlementReportDivisions", () => {
	it("returns each division once, sorted by name", () => {
		const voice = { divisionId: "d-voice", divisionName: "Voice" };
		const piano = { divisionId: "d-piano", divisionName: "Piano" };
		expect(
			listEntitlementReportDivisions([
				entry({ id: "a", divisions: [voice, piano] }),
				entry({ id: "b", divisions: [piano] }),
				entry({ id: "c", divisions: [] }),
			]),
		).toEqual([piano, voice]);
	});
});
