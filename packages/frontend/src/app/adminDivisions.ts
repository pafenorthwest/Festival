import { validateDivisionName } from "@festival/common";

export function divisionNameValidationError(value: unknown): string {
	try {
		validateDivisionName(value);
		return "";
	} catch (error) {
		return error instanceof Error
			? error.message
			: "Invalid division display name.";
	}
}

export function moveDivisionIds(
	divisionIds: string[],
	divisionId: string,
	direction: -1 | 1,
): string[] | null {
	const fromIndex = divisionIds.indexOf(divisionId);
	const toIndex = fromIndex + direction;
	if (fromIndex < 0 || toIndex < 0 || toIndex >= divisionIds.length) {
		return null;
	}
	const next = [...divisionIds];
	const fromId = next[fromIndex];
	const toId = next[toIndex];
	if (fromId === undefined || toId === undefined) return null;
	next[fromIndex] = toId;
	next[toIndex] = fromId;
	return next;
}

export function listIanaTimezones(currentTimezone?: string): string[] {
	const supportedValuesOf = (
		Intl as typeof Intl & {
			supportedValuesOf?: (key: "timeZone") => string[];
		}
	).supportedValuesOf;
	const supported = supportedValuesOf?.("timeZone") ?? [];
	return [
		...new Set([
			"UTC",
			...(currentTimezone ? [currentTimezone] : []),
			...supported,
		]),
	].sort((a, b) => a.localeCompare(b));
}
