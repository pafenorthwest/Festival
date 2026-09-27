export function formatTimestamp(isoDate: string): string {
	if (!isoDate) return "N/A";
	const d = new Date(isoDate);
	if (Number.isNaN(d.getTime())) return isoDate;
	return d.toLocaleString("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function formatStateChanges(
	previousState: Record<string, unknown> | null | undefined,
	newState: Record<string, unknown> | null | undefined,
): string {
	const prev = previousState ?? {};
	const next = newState ?? {};
	const allKeys = Array.from(
		new Set([...Object.keys(prev), ...Object.keys(next)]),
	);

	const changes: string[] = [];
	for (const key of allKeys) {
		const valPrev = prev[key];
		const valNext = next[key];
		if (JSON.stringify(valPrev) !== JSON.stringify(valNext)) {
			const displayPrev =
				valPrev !== undefined && valPrev !== null
					? typeof valPrev === "object"
						? JSON.stringify(valPrev)
						: String(valPrev)
					: "none";
			const displayNext =
				valNext !== undefined && valNext !== null
					? typeof valNext === "object"
						? JSON.stringify(valNext)
						: String(valNext)
					: "none";
			changes.push(`${key}: ${displayPrev} → ${displayNext}`);
		}
	}

	return changes.length > 0 ? changes.join(", ") : "No state changes";
}
