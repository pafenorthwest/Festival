import type { RepertoirePiece } from "@festival/common";

export interface RepertoirePieceDraft {
	title: string;
	composer: string;
	movement: string;
	durationMinutes: number;
	durationSeconds: number;
}

export function createEmptyPieceDraft(): RepertoirePieceDraft {
	return {
		title: "",
		composer: "",
		movement: "",
		durationMinutes: 3,
		durationSeconds: 0,
	};
}

export function validatePieceTitle(title: string): string | null {
	if (!title?.trim()) return "Title is required.";
	return null;
}

export function validatePieceComposer(composer: string): string | null {
	if (!composer?.trim()) return "Composer is required.";
	return null;
}

export function validatePieceDuration(
	minutes: number,
	seconds: number,
): string | null {
	const total = minutes * 60 + seconds;
	if (!Number.isFinite(total) || total <= 0) {
		return "Duration must be greater than 0 seconds.";
	}
	return null;
}

export function pieceDraftToRepertoirePiece(
	draft: RepertoirePieceDraft,
): RepertoirePiece {
	return {
		title: draft.title.trim(),
		composer: draft.composer.trim(),
		movement: draft.movement.trim() ? draft.movement.trim() : null,
		durationSeconds: Math.max(
			1,
			Math.floor(draft.durationMinutes * 60 + draft.durationSeconds),
		),
	};
}

export function repertoirePieceToDraft(
	piece: RepertoirePiece,
): RepertoirePieceDraft {
	const total = Math.max(1, piece.durationSeconds);
	return {
		title: piece.title,
		composer: piece.composer,
		movement: piece.movement ?? "",
		durationMinutes: Math.floor(total / 60),
		durationSeconds: total % 60,
	};
}

export function arePiecesValid(pieces: RepertoirePieceDraft[]): boolean {
	if (pieces.length === 0) return false;
	return pieces.every(
		(p) =>
			!validatePieceTitle(p.title) &&
			!validatePieceComposer(p.composer) &&
			!validatePieceDuration(p.durationMinutes, p.durationSeconds),
	);
}

export function formatTotalDuration(pieces: RepertoirePiece[]): string {
	const totalSecs = pieces.reduce((sum, p) => sum + p.durationSeconds, 0);
	const mins = Math.floor(totalSecs / 60);
	const secs = totalSecs % 60;
	if (secs === 0) return `${mins} min`;
	return `${mins}m ${secs}s`;
}
