import type {
	CustomerClassRegistrationItem,
	RepertoirePiece,
} from "@festival/common";

export interface PerformerRegistrationGroup {
	performerName: string;
	childId: string;
	registrations: CustomerClassRegistrationItem[];
}

export function groupRegistrationsByPerformer(
	registrations: CustomerClassRegistrationItem[],
): PerformerRegistrationGroup[] {
	const map = new Map<string, PerformerRegistrationGroup>();

	for (const reg of registrations) {
		const performerName = reg.child?.name ?? "Performer";
		const key = reg.child?.id ?? performerName;
		let group = map.get(key);
		if (!group) {
			group = {
				performerName,
				childId: reg.child?.id ?? "",
				registrations: [],
			};
			map.set(key, group);
		}
		group.registrations.push(reg);
	}

	return Array.from(map.values());
}

export function formatPiecesSummary(pieces?: RepertoirePiece[]): string {
	if (!pieces || pieces.length === 0) return "No repertoire entered";
	return pieces
		.map((p) => {
			const parts: string[] = [];
			if (p.title) parts.push(p.title);
			if (p.composer) parts.push(p.composer);
			if (p.movement) parts.push(p.movement);
			const mins =
				p.durationMinutes ?? Math.floor((p.durationSeconds ?? 0) / 60);
			const secs = (p.durationSeconds ?? 0) % 60;
			if (mins > 0 || secs > 0) {
				parts.push(`${mins}:${String(secs).padStart(2, "0")}`);
			}
			return parts.join(" · ");
		})
		.join("; ");
}

export function formatCutoffShort(
	date: Date,
	timezone = "America/Los_Angeles",
): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "long",
		day: "numeric",
		timeZone: timezone,
	}).format(date);
}

export function formatCutoffWithYear(
	date: Date,
	timezone = "America/Los_Angeles",
): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: timezone,
	}).format(date);
}

export function formatCutoffDateTime(
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
