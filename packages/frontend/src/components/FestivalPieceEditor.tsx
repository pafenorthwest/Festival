import type {
	CanonicalWork,
	RepertoireCatalogWork,
	RepertoirePiece,
} from "@festival/common";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
	applyCatalogWorkSelection,
	createEmptyPieceDraft,
	formatTotalDuration,
	getRepertoirePolicyError,
	hasPieceDraftContent,
	pieceDraftToRepertoirePiece,
	type RepertoirePieceDraft,
	repertoirePieceToDraft,
	validatePieceCatalogWork,
	validatePieceComposer,
	validatePieceDuration,
	validatePieceTitle,
} from "../pages/festivalRegistrationHelpers.js";
import { Button } from "./Button.js";

export interface FestivalPieceEditorProps {
	pieces: RepertoirePiece[];
	onChange: (pieces: RepertoirePiece[]) => void;
	maxPieces: 1 | 2 | 3;
	performanceMinutes: number;
	requiresConcerto?: boolean;
	showCatalog?: boolean;
	catalogWorks?: readonly (CanonicalWork | RepertoireCatalogWork)[];
	catalogSearch?: {
		query: () => string;
		setQuery: (value: string) => void;
		results: () => readonly CanonicalWork[];
		loading: () => boolean;
		error: () => string | undefined;
		retry: () => void;
	};
	onDirtyChange?: (dirty: boolean) => void;
	readOnly?: boolean;
	idPrefix?: string;
	initialIndex?: number;
}

function emptyDraft(): RepertoirePieceDraft {
	return { ...createEmptyPieceDraft(), durationMinutes: 0 };
}

export function FestivalPieceEditor(props: FestivalPieceEditorProps) {
	const initialIndex =
		props.initialIndex ??
		(props.pieces.length < props.maxPieces ? props.pieces.length : null);
	const [activeIndex, setActiveIndex] = createSignal<number | null>(
		initialIndex,
	);
	const [draft, setDraft] = createSignal<RepertoirePieceDraft>(
		initialIndex !== null && props.pieces[initialIndex]
			? repertoirePieceToDraft(props.pieces[initialIndex])
			: emptyDraft(),
	);
	const [error, setError] = createSignal("");
	const prefix = () => props.idPrefix ?? "registration-piece";
	const existing = () =>
		activeIndex() === null ? undefined : props.pieces[activeIndex() as number];
	const isDirty = () => {
		if (props.readOnly || activeIndex() === null) return false;
		return existing()
			? JSON.stringify(draft()) !==
					JSON.stringify(repertoirePieceToDraft(existing() as RepertoirePiece))
			: hasPieceDraftContent(draft());
	};
	createEffect(() => props.onDirtyChange?.(isDirty()));
	function openPiece(index: number) {
		if (isDirty() && !window.confirm("Discard changes to this piece?")) return;
		setActiveIndex(index);
		setDraft(
			props.pieces[index]
				? repertoirePieceToDraft(props.pieces[index])
				: emptyDraft(),
		);
		setError("");
	}
	function update<K extends keyof RepertoirePieceDraft>(
		field: K,
		value: RepertoirePieceDraft[K],
	) {
		setDraft((current) => ({ ...current, [field]: value }));
		setError("");
	}
	function savePiece(event: Event) {
		event.preventDefault();
		const current = draft();
		const unchangedCatalog = Boolean(
			existing()?.catalogWorkId &&
				existing()?.catalogWorkId === current.catalogWorkId,
		);
		const validationError =
			validatePieceTitle(current.title) ||
			validatePieceComposer(current.composer) ||
			validatePieceDuration(current.durationMinutes, current.durationSeconds) ||
			validatePieceCatalogWork(current, {
				requiresConcerto: props.requiresConcerto,
				catalogWorks: unchangedCatalog ? undefined : props.catalogWorks,
			});
		if (validationError) {
			setError(validationError);
			return;
		}
		const index = activeIndex();
		if (index === null) return;
		const next = [...props.pieces];
		next[index] = pieceDraftToRepertoirePiece(current);
		const policyError = getRepertoirePolicyError(
			next,
			props.maxPieces,
			props.performanceMinutes,
		);
		if (policyError) {
			setError(policyError);
			return;
		}
		props.onChange(next);
		setActiveIndex(next.length < props.maxPieces ? next.length : null);
		setDraft(emptyDraft());
		setError("");
		props.onDirtyChange?.(false);
	}
	function discardPiece() {
		setDraft(
			existing()
				? repertoirePieceToDraft(existing() as RepertoirePiece)
				: emptyDraft(),
		);
		setError("");
	}
	return (
		<section class="parent-piece-editor">
			<div class="parent-piece-list">
				<For each={props.pieces}>
					{(piece, index) => (
						<article class="parent-piece-summary parent-panel">
							<div class="parent-row-heading">
								<div>
									<p class="parent-eyebrow">Piece {index() + 1}</p>
									<h3>{piece.title}</h3>
								</div>
								<span class="parent-badge parent-status-available">Saved</span>
							</div>
							<p>
								{piece.composer}
								{piece.movement ? ` · ${piece.movement}` : ""}
							</p>
							<p class="muted">{formatTotalDuration([piece])}</p>
							<Show when={!props.readOnly}>
								<div class="parent-piece-actions">
									<Button
										type="button"
										variant="secondary"
										onClick={() => openPiece(index())}
									>
										Edit piece {index() + 1}
									</Button>
									<Show when={props.pieces.length > 1}>
										<Button
											type="button"
											variant="secondary"
											onClick={() => {
												if (
													isDirty() &&
													!window.confirm("Discard changes to this piece?")
												)
													return;
												props.onChange(
													props.pieces.filter((_, i) => i !== index()),
												);
												setActiveIndex(null);
												setDraft(emptyDraft());
											}}
										>
											Remove piece {index() + 1}
										</Button>
									</Show>
								</div>
							</Show>
						</article>
					)}
				</For>
			</div>
			<Show when={!props.readOnly && activeIndex() !== null}>
				<form
					class="parent-piece-form parent-panel"
					onSubmit={savePiece}
					noValidate
				>
					<p class="parent-eyebrow">
						Piece {(activeIndex() ?? 0) + 1} of {props.maxPieces}
						{!existing() && props.pieces.length > 0 ? " · Optional" : ""}
					</p>
					<h2>
						{existing()
							? "Edit performance piece"
							: props.pieces.length
								? "Add another piece"
								: "Performance piece"}
					</h2>
					<Show when={!existing() && props.pieces.length > 0}>
						<p class="muted">
							Your saved repertoire is ready. Leave this next form empty to
							finish without another piece.
						</p>
					</Show>
					<Show when={props.showCatalog ?? props.requiresConcerto}>
						<div class="parent-fields">
							<Show when={props.catalogSearch}>
								{(search) => (
									<>
										<label class="field">
											<span>Search the concerto catalog</span>
											<input
												type="search"
												value={search().query()}
												onInput={(event) =>
													search().setQuery(event.currentTarget.value)
												}
												onKeyDown={(event) => {
													if (event.key === "Enter") event.preventDefault();
												}}
											/>
										</label>
										<Show when={search().loading()}>
											<p role="status">Searching the catalog…</p>
										</Show>
										<Show when={search().error()}>
											<p class="field-error" role="alert">
												{search().error()}
											</p>
											<Button
												type="button"
												variant="secondary"
												onClick={search().retry}
											>
												Retry search
											</Button>
										</Show>
									</>
								)}
							</Show>
							<label class="field" for={`${prefix()}-catalog`}>
								<span>Concerto catalog work</span>
								<select
									id={`${prefix()}-catalog`}
									value={draft().catalogWorkId ?? ""}
									onChange={(event) => {
										setDraft((current) =>
											applyCatalogWorkSelection(
												current,
												event.currentTarget.value,
												props.catalogWorks,
											),
										);
										setError("");
									}}
								>
									<option value="" selected={!draft().catalogWorkId}>
										Select a concerto work…
									</option>
									<Show
										when={
											draft().catalogWorkId &&
											!(props.catalogWorks ?? []).some(
												(work) => work.id === draft().catalogWorkId,
											)
										}
									>
										<option value={draft().catalogWorkId ?? ""} selected>
											{draft().title || "Previously selected work"}
										</option>
									</Show>
									<For
										each={(props.catalogWorks ?? []).filter(
											(work) =>
												work.isActive &&
												work.classifications?.includes("concerto"),
										)}
									>
										{(work) => (
											<option
												value={work.id}
												selected={draft().catalogWorkId === work.id}
											>
												{work.title}
												{work.composerName ? ` — ${work.composerName}` : ""}
											</option>
										)}
									</For>
								</select>
							</label>
						</div>
					</Show>
					<div class="parent-fields">
						<label class="field" for={`${prefix()}-title`}>
							<span>Title</span>
							<input
								id={`${prefix()}-title`}
								value={draft().title}
								onInput={(event) => update("title", event.currentTarget.value)}
								required
							/>
						</label>
						<label class="field" for={`${prefix()}-composer`}>
							<span>Composer</span>
							<input
								id={`${prefix()}-composer`}
								value={draft().composer}
								onInput={(event) =>
									update("composer", event.currentTarget.value)
								}
								required
							/>
						</label>
						<label class="field" for={`${prefix()}-movement`}>
							<span>Movement (if applicable)</span>
							<input
								id={`${prefix()}-movement`}
								value={draft().movement}
								onInput={(event) =>
									update("movement", event.currentTarget.value)
								}
							/>
						</label>
						<fieldset class="parent-duration">
							<legend>Performance duration</legend>
							<div class="parent-fields parent-fields-two">
								<label class="field" for={`${prefix()}-minutes`}>
									<span>Minutes</span>
									<input
										id={`${prefix()}-minutes`}
										type="number"
										min="0"
										step="1"
										value={draft().durationMinutes || ""}
										onInput={(event) =>
											update(
												"durationMinutes",
												Number(event.currentTarget.value),
											)
										}
									/>
								</label>
								<label class="field" for={`${prefix()}-seconds`}>
									<span>Seconds</span>
									<input
										id={`${prefix()}-seconds`}
										type="number"
										min="0"
										max="59"
										step="1"
										value={draft().durationSeconds || ""}
										onInput={(event) =>
											update(
												"durationSeconds",
												Number(event.currentTarget.value),
											)
										}
									/>
								</label>
							</div>
						</fieldset>
					</div>
					<Show when={error()}>
						<p class="field-error" role="alert">
							{error()}
						</p>
					</Show>
					<div class="parent-piece-actions">
						<Button type="submit" variant="secondary">
							Save piece
						</Button>
						<Show when={isDirty()}>
							<Button type="button" variant="secondary" onClick={discardPiece}>
								Discard piece changes
							</Button>
						</Show>
						<span class="muted">
							Maximum {props.maxPieces}{" "}
							{props.maxPieces === 1 ? "piece" : "pieces"} ·{" "}
							{props.performanceMinutes} minutes total
						</span>
					</div>
				</form>
			</Show>
			<Show
				when={
					!props.readOnly &&
					activeIndex() === null &&
					props.pieces.length < props.maxPieces
				}
			>
				<Button
					type="button"
					variant="secondary"
					onClick={() => openPiece(props.pieces.length)}
				>
					Add another piece
				</Button>
			</Show>
		</section>
	);
}
