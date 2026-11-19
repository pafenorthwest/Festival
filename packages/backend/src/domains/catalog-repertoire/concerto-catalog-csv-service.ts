import {
	AppError,
	CONCERTO_REPERTOIRE_CSV_TEMPLATE,
	type ConcertoCsvAddedItemDto,
	type ConcertoCsvCatalogItemDto,
	type ConcertoCsvFieldChangeDto,
	type ConcertoCsvUpdatedItemDto,
	type ConcertoCsvValidationErrorDto,
	type ConcertoRepertoireCsvImportResultDto,
	type ConcertoRepertoireCsvPreviewDto,
	type ParsedConcertoCsvRow,
	parseConcertoRepertoireCsv,
	serializeConcertoRepertoireCsv,
} from "@festival/common";
import {
	type DomainCacheInvalidator,
	emitDomainInvalidation,
	type S09InvalidationSink,
} from "../../infra/s09-infra.js";
import {
	type ConcertoCatalogAddedOperation,
	type ConcertoCatalogMutationPlan,
	type ConcertoCatalogUpdatedOperation,
	type ConcertoCatalogWorkSnapshot,
	compareCCollation,
	computeConcertoCatalogDigest,
	type ImportConcertoCatalogCsvInput,
	type PreviewConcertoCatalogCsvInput,
	type RepertoireCatalogRepository,
	sortConcertoSnapshot,
} from "./repertoire-types.js";

export {
	compareCCollation,
	computeConcertoCatalogDigest,
	sortConcertoSnapshot,
};

const SYNTAX_ERROR_CODES = new Set([
	"CSV_TOO_LARGE",
	"EMPTY_CSV",
	"INVALID_HEADER",
	"MALFORMED_CSV_QUOTE",
	"UNCLOSED_CSV_QUOTE",
	"INVALID_COLUMN_COUNT",
]);

const compositeKey = (title: string, composer: string) =>
	`${title}\0${composer}`;

const toCatalogDto = (
	w: ConcertoCatalogWorkSnapshot,
): ConcertoCsvCatalogItemDto => ({
	workId: w.workId,
	title: w.title,
	composer: w.composer,
	imslpUrl: w.imslpUrl,
});

const workIdIssue = (
	rowNumber: number,
	code: string,
	message: string,
): ConcertoCsvValidationErrorDto => ({
	rowNumber,
	field: "work_id",
	code,
	message,
});

function diffConcertoFields(
	before: ConcertoCatalogWorkSnapshot,
	row: ParsedConcertoCsvRow,
): ConcertoCsvFieldChangeDto[] {
	const changes: ConcertoCsvFieldChangeDto[] = [];
	if (before.title !== row.title) {
		changes.push({ field: "title", before: before.title, after: row.title });
	}
	if (before.composer !== row.composer) {
		changes.push({
			field: "composer",
			before: before.composer || null,
			after: row.composer,
		});
	}
	if ((before.imslpUrl ?? null) !== (row.imslpUrl ?? null)) {
		changes.push({
			field: "imslp_url",
			before: before.imslpUrl ?? null,
			after: row.imslpUrl ?? null,
		});
	}
	return changes;
}

type ResolvedCsvAction =
	| { kind: "new_work"; row: ParsedConcertoCsvRow }
	| {
			kind: "attach_non_concerto" | "concerto_target";
			row: ParsedConcertoCsvRow;
			target: ConcertoCatalogWorkSnapshot;
	  };

function validateExplicitRows(
	rows: readonly ParsedConcertoCsvRow[],
	worksById: ReadonlyMap<string, ConcertoCatalogWorkSnapshot>,
) {
	const errors: ConcertoCsvValidationErrorDto[] = [];
	const seenExplicitIds = new Set<string>();
	const explicitTargetKeys = new Set<string>();
	const actions: ResolvedCsvAction[] = [];

	for (const row of rows) {
		if (row.workId === null) continue;
		const existing = worksById.get(row.workId);
		if (!existing) {
			errors.push(
				workIdIssue(row.rowNumber, "unknown_work_id", "Unknown work_id."),
			);
		} else if (!existing.isConcerto) {
			errors.push(
				workIdIssue(row.rowNumber, "non_concerto_work_id", "Not a concerto."),
			);
		} else if (seenExplicitIds.has(row.workId)) {
			errors.push(
				workIdIssue(row.rowNumber, "duplicate_work_id", "Duplicate work_id."),
			);
		} else {
			seenExplicitIds.add(row.workId);
			explicitTargetKeys.add(
				compositeKey(row.normalizedTitle, row.normalizedComposer),
			);
			actions.push({ kind: "concerto_target", row, target: existing });
		}
	}
	return { errors, seenExplicitIds, explicitTargetKeys, actions };
}

function validateBlankWorkIdRows(
	rows: readonly ParsedConcertoCsvRow[],
	ctx: {
		worksByKey: ReadonlyMap<string, ConcertoCatalogWorkSnapshot[]>;
		seenExplicitIds: ReadonlySet<string>;
		explicitTargetKeys: ReadonlySet<string>;
	},
) {
	const errors: ConcertoCsvValidationErrorDto[] = [];
	const seenBlankKeys = new Set<string>();
	const actions: ResolvedCsvAction[] = [];

	for (const row of rows) {
		if (row.workId !== null) continue;
		const key = compositeKey(row.normalizedTitle, row.normalizedComposer);
		if (seenBlankKeys.has(key)) {
			errors.push({
				rowNumber: row.rowNumber,
				field: "row",
				code: "duplicate_work_row",
				message: "Duplicate concerto row.",
			});
			continue;
		}
		seenBlankKeys.add(key);
		const matches = ctx.worksByKey.get(key) ?? [];
		const single = matches.length === 1 ? matches[0] : undefined;
		if (matches.length > 1) {
			errors.push(
				workIdIssue(
					row.rowNumber,
					"ambiguous_work_match",
					"Ambiguous work match; specify work_id.",
				),
			);
		} else if (
			(single && ctx.seenExplicitIds.has(single.workId)) ||
			ctx.explicitTargetKeys.has(key)
		) {
			errors.push(
				workIdIssue(
					row.rowNumber,
					"conflicting_work_target",
					"Row conflicts with an explicit work target.",
				),
			);
		} else if (single) {
			actions.push({
				kind: single.isConcerto ? "concerto_target" : "attach_non_concerto",
				row,
				target: single,
			});
		} else {
			actions.push({ kind: "new_work", row });
		}
	}
	return { errors, actions };
}

const EMPTY_MUTATION_PLAN: ConcertoCatalogMutationPlan = {
	added: [],
	updated: [],
	unchangedWorkIds: [],
	removedWorkIds: [],
};

function buildInvalidPlan(
	catalogDigest: string,
	errors: ConcertoCsvValidationErrorDto[],
	ctx: { totalRows: number; hasSyntaxError: boolean },
) {
	return {
		preview: {
			valid: false,
			errors,
			summary: {
				totalRows: ctx.totalRows,
				addedCount: 0,
				updatedCount: 0,
				unchangedCount: 0,
				removedCount: 0,
				errorCount: errors.length,
			},
			added: [],
			updated: [],
			unchangedCount: 0,
			unchanged: [],
			removed: [],
			clearsEntireCatalog: false,
			requiresClearAllConfirmation: false,
			catalogDigest,
		} satisfies ConcertoRepertoireCsvPreviewDto,
		hasSyntaxError: ctx.hasSyntaxError,
		mutationPlan: EMPTY_MUTATION_PLAN,
	};
}

function partitionActions(actions: readonly ResolvedCsvAction[]) {
	const added: ConcertoCsvAddedItemDto[] = [];
	const updated: ConcertoCsvUpdatedItemDto[] = [];
	const planAdded: ConcertoCatalogAddedOperation[] = [];
	const planUpdated: ConcertoCatalogUpdatedOperation[] = [];
	const retainedIds = new Set<string>();
	const unchangedIds = new Set<string>();

	for (const action of [...actions].sort(
		(a, b) => a.row.rowNumber - b.row.rowNumber,
	)) {
		const { row } = action;
		if (action.kind !== "concerto_target") {
			const existingWorkId =
				action.kind === "attach_non_concerto" ? action.target.workId : null;
			added.push({
				rowNumber: row.rowNumber,
				existingWorkId,
				title: row.title,
				composer: row.composer,
				imslpUrl: row.imslpUrl,
			});
			planAdded.push({
				kind: existingWorkId ? "attach_existing" : "insert",
				existingWorkId,
				...row,
			});
			continue;
		}
		const { target } = action;
		retainedIds.add(target.workId);
		const changedFields = diffConcertoFields(target, row);
		if (changedFields.length === 0) {
			unchangedIds.add(target.workId);
			continue;
		}
		updated.push({
			rowNumber: row.rowNumber,
			workId: target.workId,
			beforeTitle: target.title,
			afterTitle: row.title,
			beforeComposer: target.composer,
			afterComposer: row.composer,
			beforeImslpUrl: target.imslpUrl ?? null,
			afterImslpUrl: row.imslpUrl ?? null,
			changedFields,
		});
		planUpdated.push({ ...row, workId: target.workId });
	}
	return { added, updated, planAdded, planUpdated, retainedIds, unchangedIds };
}

function buildValidDiff(
	actions: readonly ResolvedCsvAction[],
	activeConcertos: readonly ConcertoCatalogWorkSnapshot[],
	ctx: { totalRows: number; catalogDigest: string },
) {
	const p = partitionActions(actions);
	const unchanged = activeConcertos
		.filter((w) => p.unchangedIds.has(w.workId))
		.map(toCatalogDto);
	const removed = activeConcertos
		.filter((w) => !p.retainedIds.has(w.workId))
		.map(toCatalogDto);
	const clearsEntireCatalog = ctx.totalRows === 0;
	return {
		preview: {
			valid: true,
			errors: [],
			summary: {
				totalRows: ctx.totalRows,
				addedCount: p.added.length,
				updatedCount: p.updated.length,
				unchangedCount: unchanged.length,
				removedCount: removed.length,
				errorCount: 0,
			},
			added: p.added,
			updated: p.updated,
			unchangedCount: unchanged.length,
			unchanged,
			removed,
			clearsEntireCatalog,
			requiresClearAllConfirmation: clearsEntireCatalog,
			catalogDigest: ctx.catalogDigest,
		} satisfies ConcertoRepertoireCsvPreviewDto,
		hasSyntaxError: false,
		mutationPlan: {
			added: p.planAdded,
			updated: p.planUpdated,
			unchangedWorkIds: unchanged.map((w) => w.workId),
			removedWorkIds: removed.map((w) => w.workId),
		} satisfies ConcertoCatalogMutationPlan,
	};
}

export function planConcertoCatalogCsv(
	snapshot: readonly ConcertoCatalogWorkSnapshot[],
	csvText: string,
) {
	const ordered = sortConcertoSnapshot(snapshot);
	const catalogDigest = computeConcertoCatalogDigest(ordered);
	const parsed = parseConcertoRepertoireCsv(csvText);
	const hasSyntaxError =
		!parsed.headerValid ||
		parsed.errors.some((err) => SYNTAX_ERROR_CODES.has(err.code));
	if (!parsed.headerValid) {
		return buildInvalidPlan(catalogDigest, parsed.errors, {
			totalRows: 0,
			hasSyntaxError: true,
		});
	}

	const worksById = new Map(ordered.map((w) => [w.workId, w]));
	const worksByKey = new Map<string, ConcertoCatalogWorkSnapshot[]>();
	for (const w of ordered) {
		const key = compositeKey(w.normalizedTitle, w.normalizedComposer);
		worksByKey.set(key, [...(worksByKey.get(key) ?? []), w]);
	}

	const explicit = validateExplicitRows(parsed.rows, worksById);
	const blank = validateBlankWorkIdRows(parsed.rows, {
		worksByKey,
		seenExplicitIds: explicit.seenExplicitIds,
		explicitTargetKeys: explicit.explicitTargetKeys,
	});
	const errors = [...parsed.errors, ...explicit.errors, ...blank.errors].sort(
		(a, b) => a.rowNumber - b.rowNumber,
	);
	if (errors.length > 0) {
		return buildInvalidPlan(catalogDigest, errors, {
			totalRows: parsed.rows.length + parsed.errors.length,
			hasSyntaxError,
		});
	}

	return buildValidDiff(
		[...explicit.actions, ...blank.actions],
		ordered.filter((w) => w.isConcerto),
		{ totalRows: parsed.rows.length, catalogDigest },
	);
}

function assertImportPreconditions(
	planned: ReturnType<typeof planConcertoCatalogCsv>,
	input: ImportConcertoCatalogCsvInput,
): void {
	if (input.expectedCatalogDigest !== planned.preview.catalogDigest) {
		throw new AppError(
			"Concerto catalog changed since preview. Please preview again.",
			409,
			"stale_catalog_preview",
			{ catalogDigest: planned.preview.catalogDigest },
		);
	}
	if (!planned.preview.valid) {
		const code = planned.hasSyntaxError
			? "invalid_concerto_csv"
			: "concerto_csv_validation_failed";
		const status = planned.hasSyntaxError ? 400 : 422;
		const msg = planned.hasSyntaxError
			? (planned.preview.errors[0]?.message ?? "Invalid concerto CSV.")
			: "Concerto CSV validation failed.";
		throw new AppError(msg, status, code, { errors: planned.preview.errors });
	}
	if (
		planned.preview.requiresClearAllConfirmation &&
		input.confirmClearAll !== true
	) {
		throw new AppError(
			"Clearing all concertos requires explicit confirmation.",
			400,
			"clear_all_confirmation_required",
		);
	}
}

/** Domain service for Admin Concerto Repertoire CSV template, export, preview, and atomic import. */
export class ConcertoCatalogCsvService {
	private cacheInvalidator?: S09InvalidationSink | DomainCacheInvalidator;

	constructor(private readonly catalog: RepertoireCatalogRepository) {}

	bindCacheInvalidator(
		invalidator: S09InvalidationSink | DomainCacheInvalidator,
	): void {
		this.cacheInvalidator = invalidator;
	}

	getConcertoCatalogCsvTemplate(): string {
		return CONCERTO_REPERTOIRE_CSV_TEMPLATE;
	}

	async exportConcertoCatalogCsv(organizationId: string): Promise<string> {
		const snapshot =
			await this.catalog.listCatalogConcertoSnapshot(organizationId);
		const rows = sortConcertoSnapshot(snapshot)
			.filter((w) => w.isConcerto)
			.map(toCatalogDto);
		return serializeConcertoRepertoireCsv(rows);
	}

	async previewConcertoCatalogCsv(
		input: PreviewConcertoCatalogCsvInput,
	): Promise<ConcertoRepertoireCsvPreviewDto> {
		const snapshot = await this.catalog.listCatalogConcertoSnapshot(
			input.organizationId,
		);
		return planConcertoCatalogCsv(snapshot, input.csvText).preview;
	}

	async importConcertoCatalogCsv(
		input: ImportConcertoCatalogCsvInput,
	): Promise<ConcertoRepertoireCsvImportResultDto> {
		const result = await this.catalog.runConcertoCatalogCsvTransaction(
			input.organizationId,
			async (txRepo) => {
				const planned = planConcertoCatalogCsv(
					await txRepo.loadOrgWorkSnapshot(),
					input.csvText,
				);
				assertImportPreconditions(planned, input);
				const applied = await txRepo.applyMutationPlan(planned.mutationPlan);
				const updatedSnapshot = await txRepo.loadOrgWorkSnapshot();
				return {
					applied: true as const,
					summary: {
						totalRows: planned.preview.summary.totalRows,
						addedCount: applied.addedWorkIds.length,
						updatedCount: applied.updatedWorkIds.length,
						unchangedCount: applied.unchangedWorkIds.length,
						removedCount: applied.removedWorkIds.length,
					},
					...applied,
					clearsEntireCatalog: planned.preview.clearsEntireCatalog,
					catalogDigest: computeConcertoCatalogDigest(updatedSnapshot),
				};
			},
		);
		emitDomainInvalidation(this.cacheInvalidator, {
			type: "RepertoireUpdated",
			organizationId: input.organizationId,
			slug: input.slug,
		});
		return result;
	}
}
