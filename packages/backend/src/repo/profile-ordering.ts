/**
 * Deterministic orderings shared by profile repositories.
 *
 * Mirrors the Postgres clauses `ORDER BY lower(x) COLLATE "C", x COLLATE "C"`
 * so in-memory results match the database regardless of locale.
 */
export function compareCodePoint(a: string, b: string): number {
	if (a < b) {
		return -1;
	}
	return a > b ? 1 : 0;
}

export function compareCaseInsensitive(a: string, b: string): number {
	return (
		compareCodePoint(a.toLowerCase(), b.toLowerCase()) || compareCodePoint(a, b)
	);
}

export function compareProfilesByName(
	a: { display_name: string; id: string },
	b: { display_name: string; id: string },
): number {
	return (
		compareCaseInsensitive(a.display_name, b.display_name) ||
		compareCodePoint(a.id, b.id)
	);
}

export function compareDivisionsByName(
	a: { name: string; id: string },
	b: { name: string; id: string },
): number {
	return compareCaseInsensitive(a.name, b.name) || compareCodePoint(a.id, b.id);
}
