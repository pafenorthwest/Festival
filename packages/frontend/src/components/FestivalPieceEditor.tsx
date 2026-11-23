import type { CanonicalWork, RepertoirePiece } from "@festival/common";
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
	validatePieceComposer,
	validatePieceDuration,
	validatePieceTitle,
} from "../pages/festivalRegistrationHelpers.js";
import { Button } from "./Button.js";
import { ConcertoTitleField } from "./ConcertoTitleField.js";

export interface FestivalPieceEditorProps {
	pieces: RepertoirePiece[];
	onChange: (pieces: RepertoirePiece[]) => void;
	maxPieces: 1 | 2 | 3;
	performanceMinutes: number;
	catalogScope?: { organizationSlug: string; festivalSlug: string };
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
	const [draftRevision, setDraftRevision] = createSignal(1);
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
	function resetDraft(piece?: RepertoirePiece) {
		setDraft(piece ? repertoirePieceToDraft(piece) : emptyDraft());
		setDraftRevision((revision) => revision + 1);
		setError("");
	}
	function openPiece(index: number) {
		if (isDirty() && !window.confirm("Discard changes to this piece?")) return;
		setActiveIndex(index);
		resetDraft(props.pieces[index]);
	}
	function update<K extends keyof RepertoirePieceDraft>(
		field: K,
		value: RepertoirePieceDraft[K],
	) {
		setDraft((current) => ({ ...current, [field]: value }));
		setError("");
	}
	function chooseCatalogWork(work: CanonicalWork) {
		setDraft((current) => applyCatalogWorkSelection(current, work.id, [work]));
		setError("");
	}
	function savePiece(event: Event) {
		event.preventDefault();
		const current = draft();
		const validationError =
			validatePieceTitle(current.title, current.catalogWorkId) ||
			validatePieceComposer(current.composer) ||
			validatePieceDuration(current.durationMinutes, current.durationSeconds);
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
		resetDraft();
		props.onDirtyChange?.(false);
	}
	function discardPiece() {
		resetDraft(existing());
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
												resetDraft();
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
					<div class="parent-fields">
						<Show
							when={props.catalogScope}
							fallback={
								<label class="field" for={`${prefix()}-title`}>
									<span>Title</span>
									<input
										id={`${prefix()}-title`}
										value={draft().title}
										onInput={(event) =>
											update("title", event.currentTarget.value)
										}
										required
									/>
								</label>
							}
						>
							{(scope) => (
								<Show when={draftRevision()} keyed>
									<ConcertoTitleField
										id={`${prefix()}-title`}
										organizationSlug={scope().organizationSlug}
										festivalSlug={scope().festivalSlug}
										title={draft().title}
										catalogWorkId={draft().catalogWorkId}
										onTitleInput={(title) => update("title", title)}
										onSelect={chooseCatalogWork}
										onManual={() => update("catalogWorkId", undefined)}
									/>
								</Show>
							)}
						</Show>
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
