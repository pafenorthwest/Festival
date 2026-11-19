import { describe, expect, it } from "bun:test";
import type {
	ConcertoCsvValidationErrorDto,
	ConcertoRepertoireCsvImportResultDto,
	ConcertoRepertoireCsvPreviewDto,
	ImportConcertoRepertoireCsvRequestDto,
} from "@festival/common";
import { createRoot } from "solid-js";
import { ConcertoCsvApiError } from "../src/lib/api.js";
import {
	type AdminConcertoRepertoireApiDeps,
	buildConcertoExportFilename,
	buildConcertoTemplateFilename,
	canConfirmConcertoImport,
	createAdminConcertoRepertoireController,
} from "../src/pages/adminConcertoRepertoireHelpers.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const countLines = (text: string) =>
	text.replace(/\r?\n$/, "").split(/\r?\n/).length;

function buildPreview(
	overrides: Partial<ConcertoRepertoireCsvPreviewDto> = {},
): ConcertoRepertoireCsvPreviewDto {
	return {
		valid: true,
		errors: [],
		summary: {
			totalRows: 2,
			addedCount: 1,
			updatedCount: 1,
			unchangedCount: 3,
			removedCount: 1,
			errorCount: 0,
		},
		added: [
			{
				rowNumber: 2,
				existingWorkId: null,
				title: "Piano Concerto in A minor, Op. 16",
				composer: "Edvard Grieg",
				imslpUrl: "https://imslp.org/wiki/Grieg_Concerto",
			},
		],
		updated: [
			{
				rowNumber: 3,
				workId: "w-existing",
				beforeTitle: "Violin Concerto",
				afterTitle: "Violin Concerto in D major, Op. 35",
				beforeComposer: "Tchaikovsky",
				afterComposer: "Pyotr Ilyich Tchaikovsky",
				beforeImslpUrl: null,
				afterImslpUrl: "https://imslp.org/wiki/Tchaikovsky_Op35",
				changedFields: [
					{
						field: "title",
						before: "Violin Concerto",
						after: "Violin Concerto in D major, Op. 35",
					},
					{
						field: "composer",
						before: "Tchaikovsky",
						after: "Pyotr Ilyich Tchaikovsky",
					},
					{
						field: "imslp_url",
						before: null,
						after: "https://imslp.org/wiki/Tchaikovsky_Op35",
					},
				],
			},
		],
		unchangedCount: 3,
		unchanged: [],
		removed: [
			{
				workId: "w-removed",
				title: "Cello Concerto in E minor, Op. 85",
				composer: "Edward Elgar",
				imslpUrl: null,
			},
		],
		clearsEntireCatalog: false,
		requiresClearAllConfirmation: false,
		catalogDigest: "sha256:catalog-v1",
		...overrides,
	};
}

function buildImportResult(
	overrides: Partial<ConcertoRepertoireCsvImportResultDto> = {},
): ConcertoRepertoireCsvImportResultDto {
	return {
		applied: true,
		summary: {
			totalRows: 2,
			addedCount: 1,
			updatedCount: 1,
			unchangedCount: 3,
			removedCount: 1,
		},
		addedWorkIds: ["w-new"],
		updatedWorkIds: ["w-existing"],
		unchangedWorkIds: ["w-1", "w-2", "w-3"],
		removedWorkIds: ["w-removed"],
		clearsEntireCatalog: false,
		catalogDigest: "sha256:catalog-v2",
		...overrides,
	};
}

function mountController(options: {
	slug?: string;
	token?: string | null;
	api?: Partial<AdminConcertoRepertoireApiDeps>;
}) {
	const downloads: Array<{ filename: string; csvContent: string }> = [];
	const importCalls: Array<{
		token: string;
		slug: string;
		input: ImportConcertoRepertoireCsvRequestDto;
	}> = [];
	const api: AdminConcertoRepertoireApiDeps = {
		downloadTemplateCsv: async () => "work_id,title,composer,imslp_url\n",
		exportCatalogCsv: async () =>
			"work_id,title,composer,imslp_url\nw-1,Concerto,Grieg,\n",
		previewCsv: async () => buildPreview(),
		importCsv: async (token, slug, input) => {
			importCalls.push({ token, slug, input });
			return buildImportResult();
		},
		...options.api,
	};
	return createRoot((dispose) => {
		const controller = createAdminConcertoRepertoireController({
			slug: () => options.slug ?? "pafe",
			getIdToken: async () =>
				options.token === undefined ? "tok-admin" : options.token,
			api,
			triggerDownload: (filename, csvContent) => {
				downloads.push({ filename, csvContent });
			},
		});
		return { controller, downloads, importCalls, dispose };
	});
}

describe("admin concerto repertoire helpers", () => {
	it("builds canonical template and organization export filenames", () => {
		expect(buildConcertoTemplateFilename()).toBe(
			"concerto-repertoire-template.csv",
		);
		expect(buildConcertoExportFilename("pafe")).toBe(
			"pafe-concerto-repertoire.csv",
		);
	});

	it("evaluates canConfirmConcertoImport across validation, clear-all, and busy states", () => {
		const validPreview = buildPreview();
		const invalidPreview = buildPreview({ valid: false });
		const errorPreview = buildPreview({
			errors: [
				{
					rowNumber: 2,
					field: "title",
					code: "TITLE_REQUIRED",
					message: "title is required.",
				},
			],
		});
		const clearAllPreview = buildPreview({
			clearsEntireCatalog: true,
			requiresClearAllConfirmation: true,
		});

		expect(canConfirmConcertoImport(null, false, false)).toBe(false);
		expect(canConfirmConcertoImport(invalidPreview, false, false)).toBe(false);
		expect(canConfirmConcertoImport(errorPreview, false, false)).toBe(false);
		expect(canConfirmConcertoImport(validPreview, false, true)).toBe(false);
		expect(canConfirmConcertoImport(clearAllPreview, false, false)).toBe(false);
		expect(canConfirmConcertoImport(clearAllPreview, true, false)).toBe(true);
		expect(canConfirmConcertoImport(clearAllPreview, true, true)).toBe(false);
		expect(canConfirmConcertoImport(validPreview, false, false)).toBe(true);
	});

	it("invokes injected API and download callback for template download and catalog export", async () => {
		const templateCalls: Array<[string, string]> = [];
		const exportCalls: Array<[string, string]> = [];
		const harness = mountController({
			slug: "pafe",
			api: {
				downloadTemplateCsv: async (token, slug) => {
					templateCalls.push([token, slug]);
					return "work_id,title,composer,imslp_url\n";
				},
				exportCatalogCsv: async (token, slug) => {
					exportCalls.push([token, slug]);
					return "work_id,title,composer,imslp_url\nw-1,Concerto,Grieg,\n";
				},
			},
		});

		try {
			await harness.controller.handleDownloadTemplate();
			await harness.controller.handleExportCatalog();

			expect(templateCalls).toEqual([["tok-admin", "pafe"]]);
			expect(exportCalls).toEqual([["tok-admin", "pafe"]]);
			expect(harness.downloads).toEqual([
				{
					filename: "concerto-repertoire-template.csv",
					csvContent: "work_id,title,composer,imslp_url\n",
				},
				{
					filename: "pafe-concerto-repertoire.csv",
					csvContent: "work_id,title,composer,imslp_url\nw-1,Concerto,Grieg,\n",
				},
			]);
		} finally {
			harness.dispose();
		}
	});

	it("populates preview diff fields and resets stale preview and confirmClearAll when CSV text changes", async () => {
		const expectedPreview = buildPreview({
			clearsEntireCatalog: true,
			requiresClearAllConfirmation: true,
			catalogDigest: "sha256:digest-99",
		});
		const harness = mountController({
			api: {
				previewCsv: async () => expectedPreview,
			},
		});

		try {
			harness.controller.updateCsvText(
				"work_id,title,composer,imslp_url\n",
				"initial.csv",
			);
			await harness.controller.handlePreview();
			harness.controller.setConfirmClearAll(true);

			expect(harness.controller.uploadedFilename()).toBe("initial.csv");
			expect(harness.controller.preview()?.added).toEqual(
				expectedPreview.added,
			);
			expect(harness.controller.preview()?.updated).toEqual(
				expectedPreview.updated,
			);
			expect(harness.controller.preview()?.unchangedCount).toBe(3);
			expect(harness.controller.preview()?.removed).toEqual(
				expectedPreview.removed,
			);
			expect(harness.controller.preview()?.clearsEntireCatalog).toBe(true);
			expect(harness.controller.preview()?.catalogDigest).toBe(
				"sha256:digest-99",
			);
			expect(harness.controller.confirmClearAll()).toBe(true);

			harness.controller.updateCsvText(
				"work_id,title,composer,imslp_url\n,New Piece,Bach,\n",
				"revised.csv",
			);

			expect(harness.controller.uploadedFilename()).toBe("revised.csv");
			expect(harness.controller.preview()).toBeNull();
			expect(harness.controller.confirmClearAll()).toBe(false);
			expect(harness.controller.canConfirmImport()).toBe(false);
		} finally {
			harness.dispose();
		}
	});

	it("requires confirmClearAll on header-only clear-all preview before submitting import", async () => {
		const clearPreview = buildPreview({
			summary: {
				totalRows: 0,
				addedCount: 0,
				updatedCount: 0,
				unchangedCount: 0,
				removedCount: 2,
				errorCount: 0,
			},
			added: [],
			updated: [],
			unchangedCount: 0,
			clearsEntireCatalog: true,
			requiresClearAllConfirmation: true,
			catalogDigest: "sha256:clear-digest",
		});
		const headerOnlyCsv = "work_id,title,composer,imslp_url\n";
		const harness = mountController({
			api: {
				previewCsv: async () => clearPreview,
			},
		});

		try {
			harness.controller.updateCsvText(headerOnlyCsv, "clear.csv");
			await harness.controller.handlePreview();

			expect(harness.controller.canConfirmImport()).toBe(false);
			await harness.controller.handleConfirmImport();
			expect(harness.importCalls).toHaveLength(0);

			harness.controller.setConfirmClearAll(true);
			expect(harness.controller.canConfirmImport()).toBe(true);
			await harness.controller.handleConfirmImport();

			expect(harness.importCalls).toEqual([
				{
					token: "tok-admin",
					slug: "pafe",
					input: {
						csvText: headerOnlyCsv,
						expectedCatalogDigest: "sha256:clear-digest",
						confirmClearAll: true,
					},
				},
			]);
			expect(harness.controller.importResult()?.applied).toBe(true);
		} finally {
			harness.dispose();
		}
	});

	it("invalidates stale preview on 409 stale_catalog_preview and surfaces structured row errors on 422", async () => {
		const rowErrors: ConcertoCsvValidationErrorDto[] = [
			{
				rowNumber: 3,
				field: "imslp_url",
				code: "INVALID_IMSLP_URL",
				message: "imslp_url must be a valid http:// or https:// URL.",
			},
		];
		let mode: "409" | "422" = "409";
		const harness = mountController({
			api: {
				importCsv: async () => {
					if (mode === "409") {
						throw new ConcertoCsvApiError(
							"Concerto catalog changed since preview.",
							{
								status: 409,
								code: "stale_catalog_preview",
								catalogDigest: "sha256:newer",
							},
						);
					}
					throw new ConcertoCsvApiError("Concerto CSV validation failed.", {
						status: 422,
						code: "concerto_csv_validation_failed",
						errors: rowErrors,
					});
				},
			},
		});

		try {
			harness.controller.updateCsvText(
				"work_id,title,composer,imslp_url\n,Concerto,Grieg,\n",
			);
			await harness.controller.handlePreview();
			expect(harness.controller.preview()).not.toBeNull();

			await harness.controller.handleConfirmImport();
			expect(harness.controller.preview()).toBeNull();
			expect(harness.controller.canConfirmImport()).toBe(false);
			expect(harness.controller.errorMessage()).toMatch(/preview/i);

			mode = "422";
			await harness.controller.handlePreview();
			await harness.controller.handleConfirmImport();
			expect(harness.controller.validationErrors()).toEqual(rowErrors);
			expect(harness.controller.errorMessage()).toBeTruthy();
		} finally {
			harness.dispose();
		}
	});
});

describe("admin concerto repertoire shell and page wiring", () => {
	it("wires breadcrumbs, organization lifecycle loading, and lazy route page", async () => {
		const state = await read("../src/app/createFestivalAppState.ts");
		const lifecycle = await read("../src/app/useFestivalLifecycle.ts");
		const lazyPages = await read("../src/app/lazyPages.ts");

		const adminBreadcrumbs = state
			.split(
				'const ADMIN_BREADCRUMBS: Partial<Record<AppRoute["kind"], string>> = {',
			)[1]
			?.split("};")[0];
		const orgLoadKinds = lifecycle
			.split(
				'const ORGANIZATION_LOAD_ROUTE_KINDS = new Set<AppRoute["kind"]>([',
			)[1]
			?.split("]);")[0];

		expect(adminBreadcrumbs).toContain(
			'"org-admin-concerto-repertoire": "Admin > Concerto Repertoire"',
		);
		expect(orgLoadKinds).toContain('"org-admin-concerto-repertoire"');
		expect(lazyPages).toContain("export const AdminConcertoRepertoirePage");
		expect(lazyPages).toContain(
			'"org-admin-concerto-repertoire": AdminConcertoRepertoirePage',
		);
	});

	it("gates AdminConcertoRepertoirePage with isAdminMember and AccessDeniedPanel, uses .listing-table, and stays <= 500 lines", async () => {
		const page = await read("../src/pages/AdminConcertoRepertoirePage.tsx");
		const helpers = await read(
			"../src/pages/adminConcertoRepertoireHelpers.ts",
		);

		expect(countLines(page)).toBeLessThanOrEqual(500);
		expect(countLines(helpers)).toBeLessThanOrEqual(500);
		expect(page).toContain("props.app.isAdminMember()");
		expect(page).toContain("AccessDeniedPanel");
		expect(page).toContain("listing-table");
		expect(page).not.toContain("<table");
		expect(page).not.toContain('role="table"');
	});
});
