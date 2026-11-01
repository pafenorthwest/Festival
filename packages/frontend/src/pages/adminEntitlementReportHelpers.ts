import type {
	EntitlementClass,
	EntitlementLifecycleState,
	EntitlementReportEntry,
} from "@festival/common";

export const ENTITLEMENT_CLASS_FILTER_OPTIONS: ReadonlyArray<{
	value: EntitlementClass;
	label: string;
}> = [
	{ value: "teacher_membership", label: "Teacher" },
	{ value: "accompanist_membership", label: "Accompanist" },
];

export const ENTITLEMENT_STATUS_FILTER_OPTIONS: ReadonlyArray<{
	value: EntitlementLifecycleState;
	label: string;
}> = [
	{ value: "active", label: "Active" },
	{ value: "scheduled", label: "Scheduled" },
	{ value: "expired", label: "Expired" },
	{ value: "revoked", label: "Revoked" },
];

export function formatEntitlementClass(value: EntitlementClass): string {
	return value === "teacher_membership" ? "Teacher" : "Accompanist";
}

export function formatEntitlementSource(
	value: EntitlementReportEntry["source"],
): string {
	return value === "teacher_checkout" ? "Shopify checkout" : "Accompanist form";
}

export function formatEntitlementStatus(
	value: EntitlementLifecycleState,
): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

export function entitlementStatusBadgeClass(
	value: EntitlementLifecycleState,
): string {
	switch (value) {
		case "active":
			return "badge badge-active";
		case "scheduled":
			return "badge badge-processing";
		case "revoked":
			return "badge badge-rejected";
		default:
			return "badge badge-inactive";
	}
}

export function formatEntitlementCustomer(
	entry: Pick<EntitlementReportEntry, "customerName" | "customerEmail">,
): { primary: string; secondary?: string } {
	const name = entry.customerName?.trim();
	const email = entry.customerEmail?.trim();
	if (name) return { primary: name, secondary: email || undefined };
	return { primary: email || "Unknown customer" };
}

export function formatEntitlementDivisions(
	divisions: EntitlementReportEntry["divisions"],
): string {
	return divisions.length > 0
		? divisions.map((division) => division.divisionName).join(", ")
		: "—";
}

export function formatEntitlementPageRange(report: {
	total: number;
	page: number;
	pageSize: number;
	entries: readonly unknown[];
}): string {
	if (report.total === 0) return "0 entitlements";
	const first = (report.page - 1) * report.pageSize + 1;
	const last = first + report.entries.length - 1;
	return `Showing ${first}\u2013${last} of ${report.total}`;
}

/** Page buttons to render: first, last, and the current page with its neighbours; "gap" marks skipped runs. */
export function entitlementPageNumbers(
	page: number,
	totalPages: number,
): Array<number | "gap"> {
	const wanted = new Set<number>([1, totalPages, page - 1, page, page + 1]);
	const numbers = [...wanted]
		.filter((n) => n >= 1 && n <= totalPages)
		.sort((a, b) => a - b);
	const result: Array<number | "gap"> = [];
	for (const [index, n] of numbers.entries()) {
		const previous = numbers[index - 1];
		if (previous !== undefined && n - previous > 1) {
			// A single skipped page is shown rather than replaced by a gap.
			result.push(n - previous === 2 ? n - 1 : "gap");
		}
		result.push(n);
	}
	return result;
}
