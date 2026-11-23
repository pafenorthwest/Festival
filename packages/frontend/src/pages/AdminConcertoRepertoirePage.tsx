import type {
	ConcertoCsvAddedItemDto,
	ConcertoCsvCatalogItemDto,
	ConcertoCsvUpdatedItemDto,
	ConcertoCsvValidationErrorDto,
	ConcertoRepertoireCsvPreviewDto,
} from "@festival/common";
import { For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	type AdminConcertoRepertoireController,
	createAdminConcertoRepertoireController,
} from "./adminConcertoRepertoireHelpers.js";

interface AdminConcertoRepertoirePageProps {
	app: FestivalAppController;
	slug: string;
}

function formatFieldValue(value: string | null): string {
	return value && value.length > 0 ? value : "(empty)";
}

function ConcertoToolbarSection(props: {
	controller: AdminConcertoRepertoireController;
}) {
	return (
		<div class="concerto-csv-section">
			<header class="admin-page-header">
				<div>
					<h2>Concerto Repertoire</h2>
					<p>
						Manage the organization concerto repertoire catalog via UTF-8 CSV (
						<code>work_id,title,composer,imslp_url</code>) with dry-run diff
						preview and single-transaction atomic replacement.
					</p>
				</div>
			</header>
			<div class="stack-actions">
				<Button
					type="button"
					variant="secondary"
					disabled={props.controller.isBusy()}
					onClick={() => void props.controller.handleDownloadTemplate()}
				>
					{props.controller.busyAction() === "template"
						? "Downloading…"
						: "Download Blank Template"}
				</Button>
				<Button
					type="button"
					variant="secondary"
					disabled={props.controller.isBusy()}
					onClick={() => void props.controller.handleExportCatalog()}
				>
					{props.controller.busyAction() === "export"
						? "Exporting…"
						: "Export Current Concerto CSV"}
				</Button>
			</div>
		</div>
	);
}

function ConcertoUploadSection(props: {
	controller: AdminConcertoRepertoireController;
}) {
	const c = props.controller;
	return (
		<div class="concerto-csv-section">
			<h3>1. Upload or Paste Replacement CSV</h3>
			<label class="field">
				<span>Choose CSV file (.csv)</span>
				<input
					type="file"
					accept=".csv,text/csv"
					disabled={c.isBusy()}
					onChange={(e) =>
						void c.handleFileSelected(e.currentTarget.files?.[0])
					}
				/>
			</label>
			<Show when={c.uploadedFilename()}>
				{(filename) => (
					<p class="concerto-csv-note">
						Loaded file: <strong>{filename()}</strong>
					</p>
				)}
			</Show>
			<label class="field">
				<span>CSV contents (header: work_id,title,composer,imslp_url)</span>
				<textarea
					rows={8}
					class="concerto-csv-textarea"
					placeholder={"work_id,title,composer,imslp_url\n"}
					value={c.csvText()}
					disabled={c.isBusy()}
					onInput={(e) =>
						c.updateCsvText(e.currentTarget.value, c.uploadedFilename())
					}
				/>
			</label>
			<div class="stack-actions">
				<Button
					type="button"
					disabled={c.isBusy() || c.csvText().trim().length === 0}
					onClick={() => void c.handlePreview()}
				>
					{c.busyAction() === "preview" ? "Previewing…" : "Preview Replacement"}
				</Button>
			</div>
		</div>
	);
}

function ConcertoValidationErrorsSection(props: {
	errors: ConcertoCsvValidationErrorDto[];
}) {
	return (
		<div class="concerto-csv-section">
			<h3>CSV Validation Errors ({props.errors.length})</h3>
			<div class="listing-table concerto-csv-errors-table">
				<div class="listing-table-header">
					<span>Row</span>
					<span>Field</span>
					<span>Reason</span>
				</div>
				<For each={props.errors}>
					{(err) => (
						<div class="listing-table-row">
							<span>Row {err.rowNumber}</span>
							<span>
								<code>{err.field}</code>
							</span>
							<span>
								{err.message} <small>({err.code})</small>
							</span>
						</div>
					)}
				</For>
			</div>
		</div>
	);
}

function ConcertoSummaryMetrics(props: {
	preview: ConcertoRepertoireCsvPreviewDto;
}) {
	const summary = () => props.preview.summary;
	return (
		<div class="music-review-metrics-grid">
			<div class="metric-card metric-approved">
				<span class="metric-label">Added</span>
				<strong class="metric-value">{summary().addedCount}</strong>
			</div>
			<div class="metric-card metric-claimed">
				<span class="metric-label">Updated</span>
				<strong class="metric-value">{summary().updatedCount}</strong>
			</div>
			<div class="metric-card">
				<span class="metric-label">Unchanged</span>
				<strong class="metric-value">{summary().unchangedCount}</strong>
			</div>
			<div class="metric-card metric-pending">
				<span class="metric-label">Removed</span>
				<strong class="metric-value">{summary().removedCount}</strong>
			</div>
			<div class="metric-card metric-flagged">
				<span class="metric-label">Errors</span>
				<strong class="metric-value">{summary().errorCount}</strong>
			</div>
		</div>
	);
}

function ConcertoAddedDiffSection(props: { items: ConcertoCsvAddedItemDto[] }) {
	return (
		<div class="concerto-csv-section">
			<h4>Added ({props.items.length})</h4>
			<Show
				when={props.items.length > 0}
				fallback={<p class="concerto-csv-note">No added concerto works.</p>}
			>
				<div class="listing-table concerto-csv-added-table">
					<div class="listing-table-header">
						<span>Row</span>
						<span>Title</span>
						<span>Composer</span>
						<span>Catalog Details</span>
					</div>
					<For each={props.items}>
						{(item) => (
							<div class="listing-table-row">
								<span>Row {item.rowNumber}</span>
								<span>
									<strong>{item.title}</strong>
								</span>
								<span>{item.composer}</span>
								<span class="concerto-csv-cell-detail">
									{item.existingWorkId
										? `Reuses canonical work ${item.existingWorkId}`
										: "Creates new canonical work"}
									{item.imslpUrl ? ` • ${item.imslpUrl}` : ""}
								</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function ConcertoUpdatedDiffSection(props: {
	items: ConcertoCsvUpdatedItemDto[];
}) {
	return (
		<div class="concerto-csv-section">
			<h4>Updated ({props.items.length})</h4>
			<Show
				when={props.items.length > 0}
				fallback={<p class="concerto-csv-note">No updated concerto works.</p>}
			>
				<div class="listing-table concerto-csv-updated-table">
					<div class="listing-table-header">
						<span>Row</span>
						<span>Work ID</span>
						<span>Before / After Field Changes</span>
					</div>
					<For each={props.items}>
						{(item) => (
							<div class="listing-table-row">
								<span>Row {item.rowNumber}</span>
								<span>
									<code>{item.workId}</code>
								</span>
								<span class="concerto-csv-change-list">
									<For each={item.changedFields}>
										{(change) => (
											<span class="concerto-csv-change-item">
												<strong>{change.field}:</strong>{" "}
												{formatFieldValue(change.before)} →{" "}
												{formatFieldValue(change.after)}
											</span>
										)}
									</For>
								</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function ConcertoUnchangedDiffSection(props: {
	count: number;
	items: ConcertoCsvCatalogItemDto[];
}) {
	return (
		<div class="concerto-csv-section">
			<h4>Unchanged ({props.count})</h4>
			<Show
				when={props.items.length > 0}
				fallback={
					<p class="concerto-csv-note">
						{props.count} concerto work(s) remain unchanged.
					</p>
				}
			>
				<div class="listing-table concerto-csv-catalog-table">
					<div class="listing-table-header">
						<span>Work ID</span>
						<span>Title</span>
						<span>Composer</span>
						<span>IMSLP URL</span>
					</div>
					<For each={props.items}>
						{(item) => (
							<div class="listing-table-row">
								<span>
									<code>{item.workId}</code>
								</span>
								<span>{item.title}</span>
								<span>{item.composer}</span>
								<span>{formatFieldValue(item.imslpUrl)}</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function ConcertoRemovedDiffSection(props: {
	items: ConcertoCsvCatalogItemDto[];
}) {
	return (
		<div class="concerto-csv-section">
			<h4>Removed from Concerto Catalog ({props.items.length})</h4>
			<p class="concerto-csv-note">
				Only the <code>concerto</code> classification is removed for omitted
				works. Canonical works, other classifications, contributors, and
				historical registrations are preserved.
			</p>
			<Show
				when={props.items.length > 0}
				fallback={<p class="concerto-csv-note">No concerto works removed.</p>}
			>
				<div class="listing-table concerto-csv-catalog-table">
					<div class="listing-table-header">
						<span>Work ID</span>
						<span>Title</span>
						<span>Composer</span>
						<span>IMSLP URL</span>
					</div>
					<For each={props.items}>
						{(item) => (
							<div class="listing-table-row">
								<span>
									<code>{item.workId}</code>
								</span>
								<span>
									<strong>{item.title}</strong>
								</span>
								<span>{item.composer}</span>
								<span>{formatFieldValue(item.imslpUrl)}</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function ConcertoClearAllWarning(props: {
	controller: AdminConcertoRepertoireController;
}) {
	return (
		<div class="shopify-warning-banner" role="alert">
			<strong>Clear-all catalog warning</strong>
			<p>
				This header-only CSV removes all works from the active concerto
				repertoire catalog while preserving canonical works, other
				classifications, contributors, and historical registrations.
			</p>
			<label class="field-checkbox">
				<input
					type="checkbox"
					checked={props.controller.confirmClearAll()}
					disabled={props.controller.isBusy()}
					onChange={(event) =>
						props.controller.setConfirmClearAll(event.currentTarget.checked)
					}
				/>
				<span>
					I understand this import clears every work from the active concerto
					repertoire catalog.
				</span>
			</label>
		</div>
	);
}

function ConcertoPreviewSection(props: {
	preview: ConcertoRepertoireCsvPreviewDto;
	controller: AdminConcertoRepertoireController;
}) {
	const needsClearAllConfirmation = () =>
		props.preview.clearsEntireCatalog ||
		props.preview.requiresClearAllConfirmation;

	return (
		<div class="concerto-csv-section">
			<h3>2. Dry-Run Diff Preview</h3>
			<ConcertoSummaryMetrics preview={props.preview} />
			<Show when={needsClearAllConfirmation()}>
				<ConcertoClearAllWarning controller={props.controller} />
			</Show>
			<ConcertoAddedDiffSection items={props.preview.added} />
			<ConcertoUpdatedDiffSection items={props.preview.updated} />
			<ConcertoUnchangedDiffSection
				count={props.preview.unchangedCount}
				items={props.preview.unchanged}
			/>
			<ConcertoRemovedDiffSection items={props.preview.removed} />
			<div class="stack-actions">
				<Button
					type="button"
					disabled={!props.controller.canConfirmImport()}
					onClick={() => void props.controller.handleConfirmImport()}
				>
					{props.controller.busyAction() === "import"
						? "Replacing Catalog…"
						: "Confirm & Replace Concerto Catalog"}
				</Button>
			</div>
		</div>
	);
}

function ConcertoFeedbackBanners(props: {
	controller: AdminConcertoRepertoireController;
}) {
	return (
		<>
			<Show when={props.controller.statusMessage()}>
				{(msg) => <section class="banner status-banner">{msg()}</section>}
			</Show>
			<Show when={props.controller.errorMessage()}>
				{(msg) => (
					<section class="banner error-banner" role="alert">
						{msg()}
					</section>
				)}
			</Show>
			<Show when={props.controller.importResult()}>
				{(applied) => (
					<div class="concerto-csv-section">
						<h3>Last Applied Replacement</h3>
						<p class="concerto-csv-note">
							Added: {applied().summary.addedCount} • Updated:{" "}
							{applied().summary.updatedCount} • Unchanged:{" "}
							{applied().summary.unchangedCount} • Removed:{" "}
							{applied().summary.removedCount}
						</p>
					</div>
				)}
			</Show>
		</>
	);
}

export function AdminConcertoRepertoirePage(
	props: AdminConcertoRepertoirePageProps,
) {
	const controller = createAdminConcertoRepertoireController({
		slug: () => props.slug || props.app.slug,
		getIdToken: async () => {
			const user = props.app.firebaseUser();
			return user ? user.getIdToken() : null;
		},
	});

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage the concerto repertoire catalog." />
			}
		>
			<section class="panel flow-panel concerto-repertoire-panel">
				<ConcertoToolbarSection controller={controller} />
				<ConcertoFeedbackBanners controller={controller} />
				<ConcertoUploadSection controller={controller} />
				<Show when={controller.validationErrors().length > 0}>
					<ConcertoValidationErrorsSection
						errors={controller.validationErrors()}
					/>
				</Show>
				<Show when={controller.preview()}>
					{(currentPreview) => (
						<ConcertoPreviewSection
							preview={currentPreview()}
							controller={controller}
						/>
					)}
				</Show>
			</section>
		</Show>
	);
}
