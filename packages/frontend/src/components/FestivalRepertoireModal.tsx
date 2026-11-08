import {
	type CanonicalWork,
	isCatalogWorkClassifiedAsConcerto,
	type RepertoireCatalogWork,
	type RepertoirePiece,
} from "@festival/common";
import { createEffect, createSignal, For, Index, Show } from "solid-js";
import {
	applyCatalogWorkSelection,
	arePiecesValid,
	createEmptyPieceDraft,
	pieceDraftToRepertoirePiece,
	type RepertoirePieceDraft,
	repertoirePieceToDraft,
	validatePieceCatalogWork,
	validatePieceComposer,
	validatePieceDuration,
	validatePieceTitle,
} from "../pages/festivalRegistrationHelpers.js";
import { Button } from "./Button.js";

interface FestivalRepertoireModalProps {
	isOpen: boolean;
	maxPieces: 1 | 2 | 3;
	initialPieces: RepertoirePiece[];
	requiresConcerto?: boolean;
	catalogSearch?: {
		query: () => string;
		setQuery: (value: string) => void;
		results: () => readonly CanonicalWork[];
		loading: () => boolean;
		error: () => string | undefined;
		retry: () => void;
	};
	catalogWorks?: readonly (CanonicalWork | RepertoireCatalogWork)[];
	onSave: (pieces: RepertoirePiece[]) => void;
	onClose: () => void;
}

export function FestivalRepertoireModal(props: FestivalRepertoireModalProps) {
	const [pieces, setPieces] = createSignal<RepertoirePieceDraft[]>(
		props.initialPieces.length > 0
			? props.initialPieces.map(repertoirePieceToDraft)
			: [createEmptyPieceDraft()],
	);
	const [activePieceIndex, setActivePieceIndex] = createSignal(0);
	const [touched, setTouched] = createSignal(false);

	createEffect(() => {
		if (props.isOpen) {
			setActivePieceIndex(0);
		}
	});

	const concertoCatalogWorks = (selectedId?: string | null) =>
		(props.catalogWorks ?? []).filter(
			(work) =>
				(work.id === selectedId ||
					!props.catalogSearch ||
					props.catalogSearch
						.results()
						.some((result) => result.id === work.id)) &&
				isCatalogWorkClassifiedAsConcerto(work),
		);

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

	function handleSelectCatalogWork(index: number, workId: string) {
		setPieces((current) =>
			current.map((item, i) =>
				i === index
					? applyCatalogWorkSelection(item, workId, props.catalogWorks)
					: item,
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
			setPieces((current) => {
				const next = current.filter((_, i) => i !== index);
				setActivePieceIndex((prev) => {
					if (prev >= next.length) {
						return next.length - 1;
					}
					if (prev > index) {
						return prev - 1;
					}
					return prev;
				});
				return next;
			});
		}
	}

	function handleSave(event: Event) {
		event.preventDefault();
		setTouched(true);
		if (
			!arePiecesValid(pieces(), {
				requiresConcerto: props.requiresConcerto,
				catalogWorks: props.catalogWorks,
			})
		) {
			const invalidIndex = pieces().findIndex(
				(p) =>
					(props.requiresConcerto &&
						validatePieceCatalogWork(p, true, props.catalogWorks)) ||
					validatePieceTitle(p.title) ||
					validatePieceComposer(p.composer) ||
					validatePieceDuration(p.durationMinutes, p.durationSeconds),
			);
			if (invalidIndex !== -1) setActivePieceIndex(invalidIndex);
			return;
		}
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
							<h3 id="modal-repertoire-title" data-testid="modal-repertoire-title">Repertoire Details</h3>
							<p class="muted">
								Enter between 1 and {props.maxPieces} pieces performed for this
								class.
							</p>
						</div>
					</header>

					<form class="flow-panel" onSubmit={handleSave}>
						<Show when={props.requiresConcerto && props.catalogSearch}>
							{(search) => (
								<>
									<label class="field">
										<span>Search the concerto catalog</span>
										<input
											type="search"
											placeholder="Work title or composer"
											value={search().query()}
											onInput={(event) =>
												search().setQuery(event.currentTarget.value)
											}
											onKeyDown={(event) => {
												if (event.key === "Enter") event.preventDefault();
											}}
										/>
									</label>
									<div aria-live="polite">
										<Show when={search().loading()}>
											<p>Searching the catalog…</p>
										</Show>
										<Show when={search().error()}>
											<p>{search().error()}</p>
											<Button
												type="button"
												variant="secondary"
												onClick={search().retry}
											>
												Retry search
											</Button>
										</Show>
										<Show
											when={
												!search().loading() &&
												!search().error() &&
												search().results().length === 0
											}
										>
											<p>No concertos match this search.</p>
										</Show>
									</div>
								</>
							)}
						</Show>

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

										<Show when={props.requiresConcerto}>
											<label
												class="field"
												for={`repertoire-piece-${index}-catalog-work`}
											>
												<span>Concerto Catalog Work</span>
												<select
													id={`repertoire-piece-${index}-catalog-work`}
													name={`repertoire-piece-${index}-catalog-work`}
													onChange={(e) =>
														handleSelectCatalogWork(index, e.currentTarget.value)
													}
												>
													<option value="" selected={!piece().catalogWorkId}>
														Select a concerto work…
													</option>
													<For each={concertoCatalogWorks(piece().catalogWorkId)}>
														{(work) => (
															<option
																value={work.id}
																selected={piece().catalogWorkId === work.id}
															>
																{work.composerName
																	? `${work.title} — ${work.composerName}`
																	: work.title}
															</option>
														)}
													</For>
												</select>
												<Show
													when={
														touched() &&
														validatePieceCatalogWork(
															piece(),
															true,
															props.catalogWorks,
														)
													}
												>
													<p class="field-error" role="alert">
														{validatePieceCatalogWork(
															piece(),
															true,
															props.catalogWorks,
														)}
													</p>
												</Show>
											</label>
										</Show>

										<label class="field" for={`repertoire-piece-${index}-title`}>
											<span>Title</span>
											<input
												id={`repertoire-piece-${index}-title`}
												name={`repertoire-piece-${index}-title`}
												data-testid={`input-piece-title-${index}`}
												type="text"
												value={piece().title}
												onInput={(e) =>
													updatePieceField(index, "title", e.currentTarget.value)
												}
												placeholder="e.g. Moonlight Sonata"
												required
											/>
											<Show when={touched() && validatePieceTitle(piece().title)}>
												<p class="field-error" role="alert">
													{validatePieceTitle(piece().title)}
												</p>
											</Show>
										</label>

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
												onInput={(e) => updatePieceField(index, "composer", e.currentTarget.value)}
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
												onInput={(e) => updatePieceField(index, "movement", e.currentTarget.value)}
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
													onInput={(e) => updatePieceField(index, "durationMinutes", Number(e.currentTarget.value))}
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
													onInput={(e) => updatePieceField(index, "durationSeconds", Number(e.currentTarget.value))}
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

						<div class="division-actions" style="margin-top: 1rem;">
							<Button type="submit" data-testid="btn-save-repertoire">
								Save repertoire
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
					</form>
				</div>
			</div>
		</Show>
	);
}
