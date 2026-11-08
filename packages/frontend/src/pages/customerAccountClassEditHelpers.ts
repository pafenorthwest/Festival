import type { RepertoirePiece } from "@festival/common";

export interface PieceDraft {
	title: string;
	composer: string;
	movement: string;
	minutes: number;
	seconds: number;
}

export function formatPieceTime(minutes: number, seconds: number): string {
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatCutoffFull(
	date: Date,
	timezone = "America/Los_Angeles",
): string {
	const tzName =
		timezone.includes("Los_Angeles") || timezone.includes("Pacific")
			? "Pacific"
			: "";
	const datePart = new Intl.DateTimeFormat("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: timezone,
	}).format(date);
	const timePart = new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
		timeZone: timezone,
	})
		.format(date)
		.toLowerCase();
	return `${datePart} at ${timePart}${tzName ? ` ${tzName}` : ""}`;
}

export function mapRepertoireToDrafts(pieces: RepertoirePiece[]): PieceDraft[] {
	if (!pieces || pieces.length === 0) {
		return [{ title: "", composer: "", movement: "", minutes: 0, seconds: 0 }];
	}
	return pieces.map((p) => ({
		title: p.title ?? "",
		composer: p.composer ?? "",
		movement: p.movement ?? "",
		minutes: p.durationMinutes ?? Math.floor((p.durationSeconds ?? 0) / 60),
		seconds: (p.durationSeconds ?? 0) % 60,
	}));
}

export function isPieceDurationValid(
	minutes: number,
	seconds: number,
): boolean {
	return (
		minutes >= 0 &&
		Number.isInteger(minutes) &&
		seconds >= 0 &&
		seconds < 60 &&
		Number.isInteger(seconds) &&
		minutes * 60 + seconds > 0
	);
}

export function isValidPieceDraft(p: PieceDraft): boolean {
	return (
		p.title.trim().length > 0 &&
		p.composer.trim().length > 0 &&
		isPieceDurationValid(p.minutes, p.seconds)
	);
}

