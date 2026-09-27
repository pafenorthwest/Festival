import type { RepertoirePiece } from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import {
	arePiecesValid,
	createEmptyPieceDraft,
	pieceDraftToRepertoirePiece,
	type RepertoirePieceDraft,
	repertoirePieceToDraft,
	validatePieceComposer,
	validatePieceDuration,
	validatePieceTitle,
} from "../pages/festivalRegistrationHelpers.js";
import { Button } from "./Button.js";

interface FestivalRepertoireModalProps {
	isOpen: boolean;
	maxPieces: 1 | 2 | 3;
	initialPieces: RepertoirePiece[];
	onSave: (pieces: RepertoirePiece[]) => void;
	onClose: () => void;
}

export function FestivalRepertoireModal(props: FestivalRepertoireModalProps) {
	const [pieces, setPieces] = createSignal<RepertoirePieceDraft[]>(
		props.initialPieces.length > 0
			? props.initialPieces.map(repertoirePieceToDraft)
			: [createEmptyPieceDraft()],
	);
	const [touched, setTouched] = createSignal(false);

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

	function handleAddPiece() {
		if (pieces().length < props.maxPieces) {
			setPieces((current) => [...current, createEmptyPieceDraft()]);
		}
	}

	function handleRemovePiece(index: number) {
		if (pieces().length > 1) {
			setPieces((current) => current.filter((_, i) => i !== index));
		}
	}

	function handleSave(event: Event) {
		event.preventDefault();
		setTouched(true);
		if (!arePiecesValid(pieces())) return;
		props.onSave(pieces().map(pieceDraftToRepertoirePiece));
		props.onClose();
	}

	return (
		<Show when={props.isOpen}>
			<div
				class="modal-backdrop"
				role="dialog"
				aria-modal="true"
				aria-labelledby="modal-repertoire-title"
			>
				<div class="panel modal-card repertoire-modal-card">
					<header class="admin-page-header">
						<div>
							<h3 id="modal-repertoire-title">Repertoire Details</h3>
							<p class="muted">
								Enter between 1 and {props.maxPieces} pieces performed for this
								class.
							</p>
						</div>
					</header>

					<form class="flow-panel" onSubmit={handleSave}>
						<For each={pieces()}>
							{(piece, index) => (
								<div class="panel flow-panel repertoire-piece-box">
									<div class="division-row-heading">
										<strong>Piece {index() + 1}</strong>
										<Show when={pieces().length > 1}>
											<Button
												type="button"
												variant="secondary"
												onClick={() => handleRemovePiece(index())}
											>
												Remove piece
											</Button>
										</Show>
									</div>

									<label class="field">
										<span>Title</span>
										<input
											type="text"
											value={piece.title}
											onInput={(e) =>
												updatePieceField(
													index(),
													"title",
													e.currentTarget.value,
												)
											}
											placeholder="e.g. Moonlight Sonata"
											required
										/>
										<Show when={touched() && validatePieceTitle(piece.title)}>
											<p class="field-error" role="alert">
												{validatePieceTitle(piece.title)}
											</p>
										</Show>
									</label>

									<label class="field">
										<span>Composer</span>
										<input
											type="text"
											value={piece.composer}
											onInput={(e) =>
												updatePieceField(
													index(),
													"composer",
													e.currentTarget.value,
												)
											}
											placeholder="e.g. Ludwig van Beethoven"
											required
										/>
										<Show
											when={touched() && validatePieceComposer(piece.composer)}
										>
											<p class="field-error" role="alert">
												{validatePieceComposer(piece.composer)}
											</p>
										</Show>
									</label>

									<label class="field">
										<span>Movement / Section (optional)</span>
										<input
											type="text"
											value={piece.movement}
											onInput={(e) =>
												updatePieceField(
													index(),
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
										<label class="field" style="flex: 1;">
											<span>Minutes</span>
											<input
												type="number"
												min="0"
												max="60"
												value={piece.durationMinutes}
												onInput={(e) =>
													updatePieceField(
														index(),
														"durationMinutes",
														Number(e.currentTarget.value),
													)
												}
											/>
										</label>
										<label class="field" style="flex: 1;">
											<span>Seconds</span>
											<input
												type="number"
												min="0"
												max="59"
												value={piece.durationSeconds}
												onInput={(e) =>
													updatePieceField(
														index(),
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
												piece.durationMinutes,
												piece.durationSeconds,
											)
										}
									>
										<p class="field-error" role="alert">
											{validatePieceDuration(
												piece.durationMinutes,
												piece.durationSeconds,
											)}
										</p>
									</Show>
								</div>
							)}
						</For>

						<Show when={pieces().length < props.maxPieces}>
							<Button
								type="button"
								variant="secondary"
								onClick={handleAddPiece}
							>
								+ Add another piece ({pieces().length}/{props.maxPieces})
							</Button>
						</Show>

						<div class="division-actions" style="margin-top: 1rem;">
							<Button type="submit">Save repertoire</Button>
							<Button type="button" variant="secondary" onClick={props.onClose}>
								Cancel
							</Button>
						</div>
					</form>
				</div>
			</div>
		</Show>
	);
}
