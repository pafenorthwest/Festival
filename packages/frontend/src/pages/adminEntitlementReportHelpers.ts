import type {
	AdminReconciliationRunSummary,
	AdminUnresolvedValidationDecision,
	EntitlementClass,
	EntitlementLifecycleState,
	EntitlementReportEntry,
	EntitlementSummaryCounts,
} from "@festival/common";

export const EMPTY_ENTITLEMENT_SUMMARY_COUNTS: EntitlementSummaryCounts = {
	active: 0,
	scheduled: 0,
	expired: 0,
	revoked: 0,
};

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

export function canRevokeEntitlement(
	status: EntitlementLifecycleState,
): boolean {
	return status === "active" || status === "scheduled";
}

export function formatReconciliationRunStatus(
	status: AdminReconciliationRunSummary["status"],
): string {
	return status === "completed" ? "Completed" : "Failed";
}

export function reconciliationRunBadgeClass(
	status: AdminReconciliationRunSummary["status"],
): string {
	return status === "completed" ? "badge badge-active" : "badge badge-rejected";
}

export function formatReconciliationFailureCategory(
	category?: AdminReconciliationRunSummary["failureCategory"],
): string {
	if (!category) return "";
	switch (category) {
		case "upstream":
			return "Upstream error";
		case "persistence":
			return "Persistence error";
		case "invalid":
			return "Invalid order data";
	}
}

export function formatValidationDecisionStatus(
	status: AdminUnresolvedValidationDecision["status"],
): string {
	return status === "pending_validation"
		? "Pending validation"
		: "Needs review";
}

export function validationDecisionBadgeClass(
	status: AdminUnresolvedValidationDecision["status"],
): string {
	return status === "pending_validation"
		? "badge badge-processing"
		: "badge badge-rejected";
}

export function formatValidationDecisionReason(reasonCode?: string): string {
	if (!reasonCode?.trim()) return "Awaiting review";
	return reasonCode.replace(/_/g, " ");
}

export function formatValidationDecisionCustomer(
	decision: Pick<
		AdminUnresolvedValidationDecision,
		"customerName" | "customerEmail" | "customerId"
	>,
): { primary: string; secondary?: string } {
	const name = decision.customerName?.trim();
	const email = decision.customerEmail?.trim();
	if (name) return { primary: name, secondary: email || undefined };
	if (email) return { primary: email };
	return { primary: decision.customerId?.trim() || "Unknown customer" };
}
