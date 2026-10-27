import {
	ENTITLEMENT_CLASSES,
	ENTITLEMENT_LIFECYCLES,
	type EntitlementClass,
	type EntitlementLifecycleState,
} from "./entitlements.js";

export type EntitlementReportSource = "teacher_checkout" | "accompanist_form";

export interface EntitlementReportEntry {
	id: string;
	entitlementClass: EntitlementClass;
	customerName?: string;
	customerEmail?: string;
	offeringName: string;
	divisions: Array<{ divisionId: string; divisionName: string }>;
	startsOn: string;
	endsOn: string;
	source: EntitlementReportSource;
	status: EntitlementLifecycleState;
}

export interface EntitlementReportFilters {
	search?: string;
	entitlementClass?: EntitlementClass;
	status?: EntitlementLifecycleState;
	divisionId?: string;
}

export interface EntitlementReportPageRequest {
	page: number;
	pageSize: number;
}

export interface EntitlementReportDivisionOption {
	divisionId: string;
	divisionName: string;
}

export interface EntitlementReportResponse {
	entries: EntitlementReportEntry[];
	/** Number of entries matching the filters, across all pages. */
	total: number;
	/** The page actually returned (clamped to the last page). */
	page: number;
	pageSize: number;
	totalPages: number;
	/** Every division held by any entitlement, ignoring the active filters. */
	divisions: EntitlementReportDivisionOption[];
}

export const ENTITLEMENT_REPORT_DEFAULT_PAGE_SIZE = 25;
export const ENTITLEMENT_REPORT_MAX_PAGE_SIZE = 100;

const MAX_SEARCH_LENGTH = 200;
const MAX_DIVISION_ID_LENGTH = 200;

function normalizeQueryValue(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function parseEntitlementReportFilters(query: {
	search?: string;
	entitlementClass?: string;
	status?: string;
	divisionId?: string;
}): EntitlementReportFilters {
	const filters: EntitlementReportFilters = {};
	const search = normalizeQueryValue(query.search);
	if (search !== undefined) {
		if (search.length > MAX_SEARCH_LENGTH) {
			throw new Error("Search text is too long.");
		}
		filters.search = search;
	}
	const entitlementClass = normalizeQueryValue(query.entitlementClass);
	if (entitlementClass !== undefined) {
		if (!ENTITLEMENT_CLASSES.includes(entitlementClass as EntitlementClass)) {
			throw new Error("Entitlement class filter is invalid.");
		}
		filters.entitlementClass = entitlementClass as EntitlementClass;
	}
	const status = normalizeQueryValue(query.status);
	if (status !== undefined) {
		if (!ENTITLEMENT_LIFECYCLES.includes(status as EntitlementLifecycleState)) {
			throw new Error("Status filter is invalid.");
		}
		filters.status = status as EntitlementLifecycleState;
	}
	const divisionId = normalizeQueryValue(query.divisionId);
	if (divisionId !== undefined) {
		if (divisionId.length > MAX_DIVISION_ID_LENGTH) {
			throw new Error("Division filter is invalid.");
		}
		filters.divisionId = divisionId;
	}
	return filters;
}

function parsePositiveInteger(
	value: string | undefined,
	fallback: number,
	message: string,
): number {
	const normalized = normalizeQueryValue(value);
	if (normalized === undefined) return fallback;
	if (!/^\d+$/.test(normalized)) throw new Error(message);
	const parsed = Number(normalized);
	if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(message);
	return parsed;
}

export function parseEntitlementReportPage(query: {
	page?: string;
	pageSize?: string;
}): EntitlementReportPageRequest {
	const pageSize = parsePositiveInteger(
		query.pageSize,
		ENTITLEMENT_REPORT_DEFAULT_PAGE_SIZE,
		"Page size is invalid.",
	);
	if (pageSize > ENTITLEMENT_REPORT_MAX_PAGE_SIZE) {
		throw new Error("Page size is invalid.");
	}
	return {
		page: parsePositiveInteger(query.page, 1, "Page is invalid."),
		pageSize,
	};
}

export function filterEntitlementReportEntries(
	entries: readonly EntitlementReportEntry[],
	filters: EntitlementReportFilters,
): EntitlementReportEntry[] {
	const needle = filters.search?.toLowerCase();
	return entries.filter((entry) => {
		if (
			filters.entitlementClass &&
			entry.entitlementClass !== filters.entitlementClass
		) {
			return false;
		}
		if (filters.status && entry.status !== filters.status) return false;
		if (
			filters.divisionId &&
			!entry.divisions.some(
				(division) => division.divisionId === filters.divisionId,
			)
		) {
			return false;
		}
		if (needle) {
			const haystack = `${entry.customerName ?? ""}\n${entry.customerEmail ?? ""}`;
			if (!haystack.toLowerCase().includes(needle)) return false;
		}
		return true;
	});
}

export function listEntitlementReportDivisions(
	entries: readonly EntitlementReportEntry[],
): EntitlementReportDivisionOption[] {
	const byId = new Map<string, EntitlementReportDivisionOption>();
	for (const entry of entries) {
		for (const division of entry.divisions) {
			if (!byId.has(division.divisionId)) {
				byId.set(division.divisionId, {
					divisionId: division.divisionId,
					divisionName: division.divisionName,
				});
			}
		}
	}
	return [...byId.values()].sort(
		(a, b) =>
			a.divisionName.localeCompare(b.divisionName) ||
			a.divisionId.localeCompare(b.divisionId),
	);
}

export function paginateEntitlementReportEntries(
	entries: readonly EntitlementReportEntry[],
	request: EntitlementReportPageRequest,
): Pick<
	EntitlementReportResponse,
	"entries" | "total" | "page" | "pageSize" | "totalPages"
> {
	const total = entries.length;
	const totalPages = Math.max(1, Math.ceil(total / request.pageSize));
	const page = Math.min(request.page, totalPages);
	const start = (page - 1) * request.pageSize;
	return {
		entries: entries.slice(start, start + request.pageSize),
		total,
		page,
		pageSize: request.pageSize,
		totalPages,
	};
}
