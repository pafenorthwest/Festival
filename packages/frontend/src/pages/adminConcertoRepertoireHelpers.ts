import type {
	ConcertoCsvValidationErrorDto,
	ConcertoRepertoireCsvImportResultDto,
	ConcertoRepertoireCsvPreviewDto,
	ImportConcertoRepertoireCsvRequestDto,
} from "@festival/common";
import { createMemo, createSignal } from "solid-js";
import {
	ConcertoCsvApiError,
	downloadConcertoRepertoireTemplateCsv,
	exportConcertoRepertoireCsv,
	importConcertoRepertoireCsv,
	previewConcertoRepertoireCsv,
} from "../lib/api.js";

export type ConcertoBusyAction =
	| "template"
	| "export"
	| "preview"
	| "import"
	| null;

export interface AdminConcertoRepertoireApiDeps {
	downloadTemplateCsv: (idToken: string, slug: string) => Promise<string>;
	exportCatalogCsv: (idToken: string, slug: string) => Promise<string>;
	previewCsv: (
		idToken: string,
		slug: string,
		csvText: string,
	) => Promise<ConcertoRepertoireCsvPreviewDto>;
	importCsv: (
		idToken: string,
		slug: string,
		input: ImportConcertoRepertoireCsvRequestDto,
	) => Promise<ConcertoRepertoireCsvImportResultDto>;
}

export interface CreateAdminConcertoRepertoireControllerOptions {
	slug: () => string;
	getIdToken: () => Promise<string | null>;
	api?: AdminConcertoRepertoireApiDeps;
	triggerDownload?: (filename: string, csvContent: string) => void;
}

const DEFAULT_API_DEPS: AdminConcertoRepertoireApiDeps = {
	downloadTemplateCsv: downloadConcertoRepertoireTemplateCsv,
	exportCatalogCsv: exportConcertoRepertoireCsv,
	previewCsv: previewConcertoRepertoireCsv,
	importCsv: importConcertoRepertoireCsv,
};

export function buildConcertoTemplateFilename(): string {
	return "concerto-repertoire-template.csv";
}

export function buildConcertoExportFilename(slug: string): string {
	const safeSlug =
		slug.trim().replace(/[^A-Za-z0-9_-]/g, "-") || "organization";
	return `${safeSlug}-concerto-repertoire.csv`;
}

export function triggerCsvBlobDownload(
	filename: string,
	csvContent: string,
): void {
	if (typeof document === "undefined" || typeof URL === "undefined") return;
	const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
	const objectUrl = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = objectUrl;
	anchor.download = filename;
	anchor.style.display = "none";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(objectUrl);
}

export function canConfirmConcertoImport(
	preview: ConcertoRepertoireCsvPreviewDto | null,
	confirmClearAll: boolean,
	isBusy: boolean,
): boolean {
	if (!preview?.valid || preview.errors.length > 0 || isBusy) {
		return false;
	}
	const needsClearConfirmation =
		preview.clearsEntireCatalog || preview.requiresClearAllConfirmation;
	return !needsClearConfirmation || confirmClearAll;
}

function createConcertoSignals() {
	const [csvText, setCsvText] = createSignal("");
	const [uploadedFilename, setUploadedFilename] = createSignal<string | null>(
		null,
	);
	const [preview, setPreview] =
		createSignal<ConcertoRepertoireCsvPreviewDto | null>(null);
	const [importResult, setImportResult] =
		createSignal<ConcertoRepertoireCsvImportResultDto | null>(null);
	const [confirmClearAll, setConfirmClearAll] = createSignal(false);
	const [validationErrors, setValidationErrors] = createSignal<
		ConcertoCsvValidationErrorDto[]
	>([]);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
	const [statusMessage, setStatusMessage] = createSignal<string | null>(null);
	const [busyAction, setBusyAction] = createSignal<ConcertoBusyAction>(null);

	return {
		busyAction,
		confirmClearAll,
		csvText,
		errorMessage,
		importResult,
		preview,
		setBusyAction,
		setConfirmClearAll,
		setCsvText,
		setErrorMessage,
		setImportResult,
		setPreview,
		setStatusMessage,
		setUploadedFilename,
		setValidationErrors,
		statusMessage,
		uploadedFilename,
		validationErrors,
	};
}

type ConcertoSignals = ReturnType<typeof createConcertoSignals>;

interface ConcertoControllerContext {
	signals: ConcertoSignals;
	api: AdminConcertoRepertoireApiDeps;
	download: (filename: string, csvContent: string) => void;
	slug: () => string;
	isBusy: () => boolean;
	requireToken: () => Promise<string>;
}

function applyImportFailure(signals: ConcertoSignals, error: unknown) {
	if (
		error instanceof ConcertoCsvApiError &&
		(error.status === 409 || error.code === "stale_catalog_preview")
	) {
		signals.setPreview(null);
		signals.setConfirmClearAll(false);
		signals.setErrorMessage(
			`${error.message} Run Preview Replacement again to review the latest catalog diff.`,
		);
		return;
	}
	if (
		error instanceof ConcertoCsvApiError &&
		(error.status === 422 ||
			error.code === "concerto_csv_validation_failed" ||
			error.errors.length > 0)
	) {
		signals.setPreview(null);
		signals.setConfirmClearAll(false);
		signals.setValidationErrors(error.errors);
		signals.setErrorMessage(error.message);
		return;
	}
	signals.setErrorMessage(
		error instanceof Error
			? error.message
			: "Could not replace concerto repertoire catalog.",
	);
}

function resetConcertoCsvDraft(
	signals: ConcertoSignals,
	nextCsvText: string,
	filename?: string | null,
) {
	signals.setCsvText(nextCsvText);
	signals.setUploadedFilename(filename ?? null);
	signals.setPreview(null);
	signals.setConfirmClearAll(false);
	signals.setValidationErrors([]);
	signals.setErrorMessage(null);
	signals.setStatusMessage(null);
	signals.setImportResult(null);
}

async function readSelectedConcertoCsvFile(
	signals: ConcertoSignals,
	file: File | null | undefined,
) {
	if (!file) return;
	try {
		const content = await file.text();
		resetConcertoCsvDraft(signals, content, file.name);
	} catch (error) {
		signals.setErrorMessage(
			error instanceof Error ? error.message : "Could not read CSV file.",
		);
	}
}

async function runCsvDownloadAction(
	ctx: ConcertoControllerContext,
	mode: "template" | "export",
) {
	if (ctx.isBusy()) return;
	ctx.signals.setBusyAction(mode);
	ctx.signals.setErrorMessage(null);
	try {
		const token = await ctx.requireToken();
		const slug = ctx.slug();
		const csv =
			mode === "template"
				? await ctx.api.downloadTemplateCsv(token, slug)
				: await ctx.api.exportCatalogCsv(token, slug);
		const filename =
			mode === "template"
				? buildConcertoTemplateFilename()
				: buildConcertoExportFilename(slug);
		ctx.download(filename, csv);
		ctx.signals.setStatusMessage(
			`${mode === "template" ? "Downloaded" : "Exported"} ${filename}.`,
		);
	} catch (error) {
		const fallback =
			mode === "template"
				? "Could not download template."
				: "Could not export concerto catalog.";
		ctx.signals.setErrorMessage(
			error instanceof Error ? error.message : fallback,
		);
	} finally {
		ctx.signals.setBusyAction(null);
	}
}

async function runPreviewAction(ctx: ConcertoControllerContext) {
	if (ctx.isBusy()) return;
	ctx.signals.setBusyAction("preview");
	ctx.signals.setErrorMessage(null);
	ctx.signals.setStatusMessage(null);
	ctx.signals.setImportResult(null);
	ctx.signals.setConfirmClearAll(false);
	ctx.signals.setValidationErrors([]);
	try {
		const token = await ctx.requireToken();
		const result = await ctx.api.previewCsv(
			token,
			ctx.slug(),
			ctx.signals.csvText(),
		);
		ctx.signals.setPreview(result);
		ctx.signals.setValidationErrors(result.errors);
		if (!result.valid || result.errors.length > 0) {
			ctx.signals.setErrorMessage(
				`Preview found ${result.errors.length} validation error(s). Fix the CSV rows below before importing.`,
			);
		}
	} catch (error) {
		applyImportFailure(ctx.signals, error);
	} finally {
		ctx.signals.setBusyAction(null);
	}
}

async function runImportAction(ctx: ConcertoControllerContext) {
	const currentPreview = ctx.signals.preview();
	if (
		!currentPreview ||
		!canConfirmConcertoImport(
			currentPreview,
			ctx.signals.confirmClearAll(),
			ctx.isBusy(),
		)
	) {
		return;
	}
	ctx.signals.setBusyAction("import");
	ctx.signals.setErrorMessage(null);
	ctx.signals.setStatusMessage(null);
	try {
		const token = await ctx.requireToken();
		const result = await ctx.api.importCsv(token, ctx.slug(), {
			csvText: ctx.signals.csvText(),
			expectedCatalogDigest: currentPreview.catalogDigest,
			confirmClearAll: ctx.signals.confirmClearAll(),
		});
		ctx.signals.setImportResult(result);
		ctx.signals.setPreview(null);
		ctx.signals.setConfirmClearAll(false);
		ctx.signals.setValidationErrors([]);
		ctx.signals.setStatusMessage(
			`Concerto repertoire catalog replaced (${result.summary.addedCount} added, ${result.summary.updatedCount} updated, ${result.summary.unchangedCount} unchanged, ${result.summary.removedCount} removed).`,
		);
	} catch (error) {
		applyImportFailure(ctx.signals, error);
	} finally {
		ctx.signals.setBusyAction(null);
	}
}

export function createAdminConcertoRepertoireController(
	options: CreateAdminConcertoRepertoireControllerOptions,
) {
	const signals = createConcertoSignals();
	const isBusy = createMemo(() => signals.busyAction() !== null);
	const canConfirmImport = createMemo(() =>
		canConfirmConcertoImport(
			signals.preview(),
			signals.confirmClearAll(),
			isBusy(),
		),
	);
	const ctx: ConcertoControllerContext = {
		signals,
		api: options.api ?? DEFAULT_API_DEPS,
		download: options.triggerDownload ?? triggerCsvBlobDownload,
		slug: options.slug,
		isBusy,
		requireToken: async () => {
			const token = await options.getIdToken();
			if (!token) throw new Error("Admin authentication is required.");
			return token;
		},
	};

	return {
		busyAction: signals.busyAction,
		canConfirmImport,
		confirmClearAll: signals.confirmClearAll,
		csvText: signals.csvText,
		errorMessage: signals.errorMessage,
		handleConfirmImport: () => runImportAction(ctx),
		handleDownloadTemplate: () => runCsvDownloadAction(ctx, "template"),
		handleExportCatalog: () => runCsvDownloadAction(ctx, "export"),
		handleFileSelected: (file: File | null | undefined) =>
			readSelectedConcertoCsvFile(signals, file),
		handlePreview: () => runPreviewAction(ctx),
		importResult: signals.importResult,
		isBusy,
		preview: signals.preview,
		setConfirmClearAll: signals.setConfirmClearAll,
		statusMessage: signals.statusMessage,
		updateCsvText: (nextCsvText: string, filename?: string | null) =>
			resetConcertoCsvDraft(signals, nextCsvText, filename),
		uploadedFilename: signals.uploadedFilename,
		validationErrors: signals.validationErrors,
	};
}

export type AdminConcertoRepertoireController = ReturnType<
	typeof createAdminConcertoRepertoireController
>;
