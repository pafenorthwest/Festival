import type { RepertoirePiece } from "@festival/common";
import { createEffect, createSignal, Show } from "solid-js";
import {
	validatePieceComposer,
	validatePieceDuration,
	validatePieceTitle,
} from "../pages/festivalRegistrationHelpers.js";

export { validatePieceDuration };

export interface FestivalSequentialRepertoireEditorProps {
	maxPieces: number;
	maxMinutes?: number;
	pieces: RepertoirePiece[];
	onChangePieces: (pieces: RepertoirePiece[]) => void;
	onDirtyChange?: (isDirty: boolean) => void;
	requiresConcerto?: boolean;
}

function parseDurationPart(value: string): number {
	const trimmed = value.trim();
	return trimmed === "" ? 0 : Number(trimmed);
}

function formatDuration(totalSec: number): string {
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m} min ${s.toString().padStart(2, "0")} sec`;
}

export function FestivalSequentialRepertoireEditor(
	props: FestivalSequentialRepertoireEditorProps,
) {
	const piece1 = () => props.pieces[0] as RepertoirePiece | undefined;
	const piece2 = () => props.pieces[1] as RepertoirePiece | undefined;

	const [isEditing1, setIsEditing1] = createSignal(!piece1());
	const [isEditing2, setIsEditing2] = createSignal(false);

	const [title1, setTitle1] = createSignal("");
	const [composer1, setComposer1] = createSignal("");
	const [movement1, setMovement1] = createSignal("");
	const [minutes1, setMinutes1] = createSignal("3");
	const [seconds1, setSeconds1] = createSignal("0");
	const [error1, setError1] = createSignal<string | null>(null);

	const [title2, setTitle2] = createSignal("");
	const [composer2, setComposer2] = createSignal("");
	const [movement2, setMovement2] = createSignal("");
	const [minutes2, setMinutes2] = createSignal("0");
	const [seconds2, setSeconds2] = createSignal("0");
	const [error2, setError2] = createSignal<string | null>(null);

	createEffect(() => {
		const p1 = piece1();
		if (p1 && !isEditing1()) {
			setTitle1(p1.title);
			setComposer1(p1.composer);
			setMovement1(p1.movement ?? "");
			setMinutes1(Math.floor(p1.durationSeconds / 60).toString());
			setSeconds1((p1.durationSeconds % 60).toString());
		} else if (!p1) {
			setIsEditing1(true);
		}
	});

	createEffect(() => {
		const p2 = piece2();
		if (p2 && !isEditing2()) {
			setTitle2(p2.title);
			setComposer2(p2.composer);
			setMovement2(p2.movement ?? "");
			setMinutes2(Math.floor(p2.durationSeconds / 60).toString());
			setSeconds2((p2.durationSeconds % 60).toString());
		}
	});

	const isDirty1 = () => {
		const p1 = piece1();
		if (!p1) {
			return Boolean(
				title1().trim() || composer1().trim() || movement1().trim(),
			);
		}
		if (isEditing1()) {
			return (
				title1().trim() !== p1.title ||
				composer1().trim() !== p1.composer ||
				movement1().trim() !== (p1.movement ?? "")
			);
		}
		return false;
	};

	const isDirty2 = () => {
		const p2 = piece2();
		if (!p2) {
			return Boolean(
				title2().trim() || composer2().trim() || movement2().trim(),
			);
		}
		if (isEditing2()) {
			return (
				title2().trim() !== p2.title ||
				composer2().trim() !== p2.composer ||
				movement2().trim() !== (p2.movement ?? "")
			);
		}
		return false;
	};

	createEffect(() => {
		const dirty = isDirty1() || isDirty2();
		props.onDirtyChange?.(dirty);
	});

	function handleSavePiece1(e: Event) {
		e.preventDefault();
		const tErr = validatePieceTitle(title1());
		const cErr = validatePieceComposer(composer1());
		const mins = parseDurationPart(minutes1());
		const secs = parseDurationPart(seconds1());
		const dErr = validatePieceDuration(mins, secs);

		if (tErr || cErr || dErr) {
			setError1(tErr || cErr || dErr);
			return;
		}
		setError1(null);

		const updated1: RepertoirePiece = {
			title: title1().trim(),
			composer: composer1().trim(),
			movement: movement1().trim() ? movement1().trim() : null,
			durationSeconds: Math.max(1, mins * 60 + secs),
		};

		const nextPieces = [...props.pieces];
		nextPieces[0] = updated1;
		props.onChangePieces(nextPieces);
		setIsEditing1(false);
	}

	function handleSavePiece2(e: Event) {
		e.preventDefault();
		const tErr = validatePieceTitle(title2());
		const cErr = validatePieceComposer(composer2());
		const mins = parseDurationPart(minutes2());
		const secs = parseDurationPart(seconds2());
		const dErr = validatePieceDuration(mins, secs);

		if (tErr || cErr || dErr) {
			setError2(tErr || cErr || dErr);
			return;
		}
		setError2(null);

		const updated2: RepertoirePiece = {
			title: title2().trim(),
			composer: composer2().trim(),
			movement: movement2().trim() ? movement2().trim() : null,
			durationSeconds: Math.max(1, mins * 60 + secs),
		};

		const p1 = props.pieces[0];
		const nextPieces = p1 ? [p1, updated2] : [updated2];
		props.onChangePieces(nextPieces);
		setIsEditing2(false);
	}

	function handleRemovePiece2() {
		const p1 = props.pieces[0];
		if (props.pieces.length > 1 && p1) {
			props.onChangePieces([p1]);
			setTitle2("");
			setComposer2("");
			setMovement2("");
			setMinutes2("0");
			setSeconds2("0");
			setIsEditing2(false);
		}
	}

	return (
		<div class="stack">
			{/* Piece 1 */}
			<Show
				when={piece1() && !isEditing1()}
				fallback={
					<section class="panel">
						<div class="panel-heading">
							<div>
								<p class="eyebrow">
									PIECE 1 {props.maxPieces > 1 ? `OF ${props.maxPieces}` : ""}
								</p>
								<h2>Required repertoire piece</h2>
							</div>
						</div>
						<form data-preview-form="piece" onSubmit={handleSavePiece1}>
							<div class="stack">
								<div class="field">
									<label for="piece-title">Title</label>
									<input
										id="piece-title"
										name="title"
										autocomplete="off"
										placeholder="Enter the title of the work"
										value={title1()}
										onInput={(e) => setTitle1(e.currentTarget.value)}
										required
									/>
								</div>
								<div class="field">
									<label for="piece-composer">Composer</label>
									<input
										id="piece-composer"
										name="composer"
										autocomplete="off"
										placeholder="Full composer name"
										value={composer1()}
										onInput={(e) => setComposer1(e.currentTarget.value)}
										required
									/>
								</div>
								<div class="field">
									<label for="piece-movement">
										Movement <span class="muted">(if applicable)</span>
									</label>
									<input
										id="piece-movement"
										name="movement"
										autocomplete="off"
										placeholder="e.g., I. Allegro"
										value={movement1()}
										onInput={(e) => setMovement1(e.currentTarget.value)}
									/>
								</div>
								<fieldset class="duration-field">
									<legend>Performance duration</legend>
									<div class="field-grid two-columns">
										<div class="field">
											<label for="piece-minutes">Minutes</label>
											<input
												id="piece-minutes"
												name="minutes"
												type="number"
												min="0"
												max={props.maxMinutes ?? 8}
												placeholder="0"
												inputmode="numeric"
												value={minutes1()}
												onInput={(e) => setMinutes1(e.currentTarget.value)}
											/>
										</div>
										<div class="field">
											<label for="piece-seconds">Seconds</label>
											<input
												id="piece-seconds"
												name="seconds"
												type="number"
												min="0"
												max="59"
												placeholder="00"
												inputmode="numeric"
												value={seconds1()}
												onInput={(e) => setSeconds1(e.currentTarget.value)}
											/>
										</div>
									</div>
								</fieldset>
								<Show when={error1()}>
									<p class="field-error" role="alert">
										{error1()}
									</p>
								</Show>
							</div>
							<div
								class="form-actions"
								style="margin-top: 1rem; display: flex; gap: 0.5rem;"
							>
								<button
									class="button"
									type="submit"
									data-preview-action="save-piece"
								>
									{piece1() ? "Update piece" : "Save piece"}
								</button>
								<Show when={piece1()}>
									<button
										class="button secondary"
										type="button"
										onClick={() => setIsEditing1(false)}
									>
										Cancel
									</button>
								</Show>
							</div>
						</form>
					</section>
				}
			>
				<section class="panel piece-summary">
					<div class="panel-heading">
						<div>
							<p class="eyebrow">PIECE 1</p>
							<h2>{piece1()?.title}</h2>
						</div>
						<span class="badge status-available">Saved</span>
					</div>
					<p>
						{piece1()?.composer}
						{piece1()?.movement ? ` · ${piece1()?.movement}` : ""}
					</p>
					<div class="inline">
						<span class="muted">
							{formatDuration(piece1()?.durationSeconds ?? 0)}
						</span>
						<button
							class="text-link"
							type="button"
							data-preview-action="edit-saved-piece"
							onClick={() => setIsEditing1(true)}
						>
							Edit piece
						</button>
					</div>
				</section>
			</Show>

			{/* Piece 2 (Optional, if maxPieces > 1 and piece 1 is saved) */}
			<Show when={piece1() && props.maxPieces > 1}>
				<Show
					when={piece2() && !isEditing2()}
					fallback={
						<section class="panel">
							<div class="panel-heading">
								<div>
									<p class="eyebrow">PIECE 2 OF {props.maxPieces} · OPTIONAL</p>
									<h2>
										{piece2() ? "Edit second piece" : "Add another piece"}
									</h2>
								</div>
							</div>
							<p class="muted">
								Your first piece is saved. Complete this form to add another, or
								finish with one piece.
							</p>
							<form data-preview-form="piece" onSubmit={handleSavePiece2}>
								<div class="stack">
									<div class="field">
										<label for="piece-2-title">Title</label>
										<input
											id="piece-2-title"
											name="title"
											autocomplete="off"
											placeholder="Enter the title of the work"
											value={title2()}
											onInput={(e) => setTitle2(e.currentTarget.value)}
										/>
									</div>
									<div class="field">
										<label for="piece-2-composer">Composer</label>
										<input
											id="piece-2-composer"
											name="composer"
											autocomplete="off"
											placeholder="Full composer name"
											value={composer2()}
											onInput={(e) => setComposer2(e.currentTarget.value)}
										/>
									</div>
									<div class="field">
										<label for="piece-2-movement">
											Movement <span class="muted">(if applicable)</span>
										</label>
										<input
											id="piece-2-movement"
											name="movement"
											autocomplete="off"
											placeholder="e.g., I. Allegro"
											value={movement2()}
											onInput={(e) => setMovement2(e.currentTarget.value)}
										/>
									</div>
									<fieldset class="duration-field">
										<legend>Performance duration</legend>
										<div class="field-grid two-columns">
											<div class="field">
												<label for="piece-2-minutes">Minutes</label>
												<input
													id="piece-2-minutes"
													name="minutes"
													type="number"
													min="0"
													max={props.maxMinutes ?? 8}
													placeholder="0"
													inputmode="numeric"
													value={minutes2()}
													onInput={(e) => setMinutes2(e.currentTarget.value)}
												/>
											</div>
											<div class="field">
												<label for="piece-2-seconds">Seconds</label>
												<input
													id="piece-2-seconds"
													name="seconds"
													type="number"
													min="0"
													max="59"
													placeholder="00"
													inputmode="numeric"
													value={seconds2()}
													onInput={(e) => setSeconds2(e.currentTarget.value)}
												/>
											</div>
										</div>
									</fieldset>
									<Show when={error2()}>
										<p class="field-error" role="alert">
											{error2()}
										</p>
									</Show>
								</div>
								<div
									class="form-actions"
									style="margin-top: 1rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;"
								>
									<button
										class="button secondary"
										type="submit"
										data-preview-action="save-piece"
									>
										{piece2() ? "Update second piece" : "Save second piece"}
									</button>
									<Show when={piece2()}>
										<button
											class="button secondary"
											type="button"
											onClick={() => setIsEditing2(false)}
										>
											Cancel
										</button>
									</Show>
									<span class="muted">
										No more than {props.maxPieces} pieces or{" "}
										{props.maxMinutes ?? 8} minutes total.
									</span>
								</div>
							</form>
						</section>
					}
				>
					<section class="panel piece-summary">
						<div class="panel-heading">
							<div>
								<p class="eyebrow">PIECE 2 OF {props.maxPieces}</p>
								<h2>{piece2()?.title}</h2>
							</div>
							<span class="badge status-available">Saved</span>
						</div>
						<p>
							{piece2()?.composer}
							{piece2()?.movement ? ` · ${piece2()?.movement}` : ""}
						</p>
						<div class="inline">
							<span class="muted">
								{formatDuration(piece2()?.durationSeconds ?? 0)}
							</span>
							<button
								class="text-link"
								type="button"
								onClick={() => setIsEditing2(true)}
							>
								Edit piece
							</button>
							<button
								class="text-link"
								type="button"
								onClick={handleRemovePiece2}
							>
								Remove piece
							</button>
						</div>
					</section>
				</Show>
			</Show>
		</div>
	);
}
