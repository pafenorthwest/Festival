import type { CanonicalWork, RepertoirePiece } from "@festival/common";
import { batch, createSignal, Index, Show } from "solid-js";
import {
	applyCatalogWorkSelection,
	arePiecesValid,
	createEmptyPieceDraft,
	getRepertoirePolicyError,
	pieceDraftToRepertoirePiece,
	type RepertoirePieceDraft,
	repertoirePieceToDraft,
	validatePieceComposer,
	validatePieceDuration,
	validatePieceTitle,
} from "../pages/festivalRegistrationHelpers.js";
import { Button } from "./Button.js";
import { ConcertoTitleField } from "./ConcertoTitleField.js";

interface FestivalRepertoireModalProps {
	organizationSlug: string;
	festivalSlug: string;
	maxPieces: 1 | 2 | 3;
	performanceMinutes?: number;
	initialPieces: RepertoirePiece[];
	suggestConcertos: boolean;
	onSave: (pieces: RepertoirePiece[]) => Promise<void>;
	onClose: () => void;
}

export function FestivalRepertoireModal(props: FestivalRepertoireModalProps) {
	const [pieces, setPieces] = createSignal<RepertoirePieceDraft[]>(
		props.initialPieces.length > 0
			? props.initialPieces.map(repertoirePieceToDraft)
			: [createEmptyPieceDraft()],
	);
	const [activePieceIndex, setActivePieceIndex] = createSignal(0);
	const [activePieceRevision, setActivePieceRevision] = createSignal(1);
	const [touched, setTouched] = createSignal(false);
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal<string>();

	function updatePieceField<K extends keyof RepertoirePieceDraft>(
		index: number,
		field: K,
		value: RepertoirePieceDraft[K],
	) {
		setPieces((current) =>
			current.map((item, i) =>
				i === index ? { ...item, [field]: value } : item,
			),
		);
	}

	function handleSelectCatalogWork(index: number, work: CanonicalWork) {
		setPieces((current) =>
			current.map((item, i) =>
				i === index ? applyCatalogWorkSelection(item, work.id, [work]) : item,
			),
		);
	}

	function handleAddPiece() {
		if (pieces().length < props.maxPieces) {
			const nextIndex = pieces().length;
			setPieces((current) => [...current, createEmptyPieceDraft()]);
			setActivePieceIndex(nextIndex);
		}
	}

	function handleRemovePiece(index: number) {
		if (pieces().length > 1) {
			const remaining = pieces().filter((_, i) => i !== index);
			batch(() => {
				setPieces(remaining);
				setActivePieceIndex(Math.min(index, remaining.length - 1));
				setActivePieceRevision((revision) => revision + 1);
			});
		}
	}

	async function handleSave(event: Event) {
		event.preventDefault();
		if (saving()) return;
		setError(undefined);
		setTouched(true);
		if (!arePiecesValid(pieces())) {
			const invalidIndex = pieces().findIndex(
				(p) =>
					validatePieceTitle(p.title, p.catalogWorkId) ||
					validatePieceComposer(p.composer) ||
					validatePieceDuration(p.durationMinutes, p.durationSeconds),
			);
			if (invalidIndex !== -1) setActivePieceIndex(invalidIndex);
			return;
		}
		const savedPieces = pieces().map(pieceDraftToRepertoirePiece);
		const policyError = getRepertoirePolicyError(
			savedPieces,
			props.maxPieces,
			props.performanceMinutes,
		);
		if (policyError) {
			setError(policyError);
			return;
		}
		setSaving(true);
		try {
			await props.onSave(savedPieces);
			props.onClose();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Repertoire could not be saved. Please try again.",
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-repertoire-title"
		>
			<div class="panel modal-card repertoire-modal-card">
				<header class="admin-page-header">
					<div>
						<h3
							id="modal-repertoire-title"
							data-testid="modal-repertoire-title"
						>
							Repertoire Details
						</h3>
						<p class="muted">
							Enter between 1 and {props.maxPieces} pieces performed for this
							class.
						</p>
					</div>
				</header>

				<form onSubmit={(event) => void handleSave(event)} noValidate>
					<fieldset
						class="flow-panel"
						style="border: 0; padding: 0; margin: 0; min-inline-size: 0;"
						disabled={saving()}
					>
						<Show when={pieces().length > 1}>
							<div
								class="repertoire-modal-pagination repertoire-modal-pagination-top"
								style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;"
							>
								<Button
									type="button"
									variant="secondary"
									onClick={() =>
										setActivePieceIndex((prev) => Math.max(0, prev - 1))
									}
									disabled={activePieceIndex() === 0}
									data-testid="btn-pagination-top-prev"
								>
									Previous
								</Button>
								<span class="pagination-status">
									Piece {activePieceIndex() + 1} of {pieces().length}
								</span>
								<Button
									type="button"
									variant="secondary"
									onClick={() =>
										setActivePieceIndex((prev) =>
											Math.min(pieces().length - 1, prev + 1),
										)
									}
									disabled={activePieceIndex() === pieces().length - 1}
									data-testid="btn-pagination-top-next"
								>
									Next
								</Button>
							</div>
						</Show>

						<Index each={pieces()}>
							{(piece, index) => (
								<Show when={index === activePieceIndex()}>
									<div class="panel flow-panel repertoire-piece-box">
										<div class="division-row-heading">
											<strong>Piece {index + 1}</strong>
											<Show when={pieces().length > 1}>
												<Button
													type="button"
													variant="secondary"
													onClick={() => handleRemovePiece(index)}
													data-testid={`btn-remove-piece-${index}`}
												>
													Remove piece
												</Button>
											</Show>
										</div>

										<Show
											when={props.suggestConcertos}
											fallback={
												<label
													class="field"
													for={`repertoire-piece-${index}-title`}
												>
													<span>Title</span>
													<input
														id={`repertoire-piece-${index}-title`}
														name={`repertoire-piece-${index}-title`}
														data-testid={`input-piece-title-${index}`}
														type="text"
														value={piece().title}
														onInput={(e) =>
															updatePieceField(
																index,
																"title",
																e.currentTarget.value,
															)
														}
														placeholder="e.g. Moonlight Sonata"
														required
													/>
												</label>
											}
										>
											<Show when={activePieceRevision()} keyed>
												{(_revision) => (
													<ConcertoTitleField
														id={`repertoire-piece-${index}-title`}
														name={`repertoire-piece-${index}-title`}
														testId={`input-piece-title-${index}`}
														organizationSlug={props.organizationSlug}
														festivalSlug={props.festivalSlug}
														title={piece().title}
														catalogWorkId={piece().catalogWorkId}
														onTitleInput={(title) =>
															updatePieceField(index, "title", title)
														}
														onSelect={(work) =>
															handleSelectCatalogWork(index, work)
														}
														onManual={() =>
															updatePieceField(
																index,
																"catalogWorkId",
																undefined,
															)
														}
													/>
												)}
											</Show>
										</Show>
										<Show
											when={
												touched() &&
												validatePieceTitle(piece().title, piece().catalogWorkId)
											}
										>
											{(titleError) => (
												<p class="field-error" role="alert">
													{titleError()}
												</p>
											)}
										</Show>

										<label
											class="field"
											for={`repertoire-piece-${index}-composer`}
										>
											<span>Composer</span>
											<input
												id={`repertoire-piece-${index}-composer`}
												name={`repertoire-piece-${index}-composer`}
												data-testid={`input-piece-composer-${index}`}
												type="text"
												value={piece().composer}
												onInput={(e) =>
													updatePieceField(
														index,
														"composer",
														e.currentTarget.value,
													)
												}
												placeholder="e.g. Ludwig van Beethoven"
												required
											/>
											<Show
												when={
													touched() && validatePieceComposer(piece().composer)
												}
											>
												<p class="field-error" role="alert">
													{validatePieceComposer(piece().composer)}
												</p>
											</Show>
										</label>

										<label
											class="field"
											for={`repertoire-piece-${index}-movement`}
										>
											<span>Movement / Section (optional)</span>
											<input
												id={`repertoire-piece-${index}-movement`}
												name={`repertoire-piece-${index}-movement`}
												data-testid={`input-piece-movement-${index}`}
												type="text"
												value={piece().movement}
												onInput={(e) =>
													updatePieceField(
														index,
														"movement",
														e.currentTarget.value,
													)
												}
												placeholder="e.g. I. Adagio sostenuto"
											/>
										</label>

										<div
											class="duration-inputs"
											style="display: flex; gap: 0.5rem; align-items: flex-end;"
										>
											<label
												class="field"
												for={`repertoire-piece-${index}-minutes`}
												style="flex: 1;"
											>
												<span>Minutes</span>
												<input
													id={`repertoire-piece-${index}-minutes`}
													name={`repertoire-piece-${index}-minutes`}
													data-testid={`input-piece-duration-minutes-${index}`}
													type="number"
													min="0"
													max="60"
													value={piece().durationMinutes}
													onInput={(e) =>
														updatePieceField(
															index,
															"durationMinutes",
															Number(e.currentTarget.value),
														)
													}
												/>
											</label>
											<label
												class="field"
												for={`repertoire-piece-${index}-seconds`}
												style="flex: 1;"
											>
												<span>Seconds</span>
												<input
													id={`repertoire-piece-${index}-seconds`}
													name={`repertoire-piece-${index}-seconds`}
													data-testid={`input-piece-duration-seconds-${index}`}
													type="number"
													min="0"
													max="59"
													value={piece().durationSeconds}
													onInput={(e) =>
														updatePieceField(
															index,
															"durationSeconds",
															Number(e.currentTarget.value),
														)
													}
												/>
											</label>
										</div>
										<Show
											when={
												touched() &&
												validatePieceDuration(
													piece().durationMinutes,
													piece().durationSeconds,
												)
											}
										>
											<p class="field-error" role="alert">
												{validatePieceDuration(
													piece().durationMinutes,
													piece().durationSeconds,
												)}
											</p>
										</Show>
									</div>
								</Show>
							)}
						</Index>

						<Show when={pieces().length > 1}>
							<div
								class="repertoire-modal-pagination repertoire-modal-pagination-bottom"
								style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem;"
							>
								<Button
									type="button"
									variant="secondary"
									onClick={() =>
										setActivePieceIndex((prev) => Math.max(0, prev - 1))
									}
									disabled={activePieceIndex() === 0}
									data-testid="btn-pagination-bottom-prev"
								>
									Previous
								</Button>
								<span class="pagination-status">
									Piece {activePieceIndex() + 1} of {pieces().length}
								</span>
								<Button
									type="button"
									variant="secondary"
									onClick={() =>
										setActivePieceIndex((prev) =>
											Math.min(pieces().length - 1, prev + 1),
										)
									}
									disabled={activePieceIndex() === pieces().length - 1}
									data-testid="btn-pagination-bottom-next"
								>
									Next
								</Button>
							</div>
						</Show>

						<Show when={pieces().length < props.maxPieces}>
							<Button
								type="button"
								variant="secondary"
								onClick={handleAddPiece}
								data-testid="btn-add-piece"
							>
								+ Add another piece ({pieces().length}/{props.maxPieces})
							</Button>
						</Show>

						<Show when={error()}>
							<p class="field-error" role="alert">
								{error()}
							</p>
						</Show>
						<div class="division-actions" style="margin-top: 1rem;">
							<Button type="submit" data-testid="btn-save-repertoire">
								{saving() ? "Saving…" : "Save repertoire"}
							</Button>
							<Button
								type="button"
								variant="secondary"
								onClick={props.onClose}
								data-testid="btn-cancel-repertoire"
							>
								Cancel
							</Button>
						</div>
					</fieldset>
				</form>
			</div>
		</div>
	);
}
