import type {
	BillingAdjustmentType,
	BillingLedgerDirection,
	BillingLedgerEntryType,
	BillingMismatchType,
} from "@festival/common";

export function formatCents(
	cents: number | null | undefined,
	currency = "USD",
): string {
	if (cents === null || cents === undefined || Number.isNaN(cents)) {
		return "—";
	}
	const absCents = Math.abs(cents);
	const formatted = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
	}).format(absCents / 100);
	return cents < 0 ? `-${formatted}` : formatted;
}

export function formatMismatchType(type: BillingMismatchType | string): string {
	switch (type) {
		case "paid_unregistered":
		case "paid_not_registered":
			return "Paid, Unregistered";
		case "registered_unpaid":
		case "registered_not_paid":
			return "Registered, Unpaid";
		case "partial_payment":
			return "Partial Payment";
		case "overpayment":
			return "Overpayment";
		case "duplicate_payment":
			return "Duplicate Payment";
		default:
			return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
	}
}

export function formatAdjustmentType(
	type: BillingAdjustmentType | string,
): string {
	switch (type) {
		case "refund":
			return "Refund";
		case "credit_issue":
			return "Issue Credit";
		case "credit_apply":
			return "Apply Credit";
		case "manual_charge":
			return "Manual Charge";
		case "write_off":
			return "Write Off";
		default:
			return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
	}
}

export function formatLedgerEntryType(
	type: BillingLedgerEntryType | string,
): string {
	switch (type) {
		case "credit":
			return "Credit";
		case "debit":
			return "Debit";
		case "adjustment":
			return "Adjustment";
		default:
			return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
	}
}

export function formatLedgerDirection(
	direction: BillingLedgerDirection | string,
): string {
	switch (direction) {
		case "inflow":
			return "Inflow";
		case "outflow":
			return "Outflow";
		default:
			return direction;
	}
}

export function mismatchBadgeClass(type: BillingMismatchType | string): string {
	switch (type) {
		case "overpayment":
		case "paid_unregistered":
		case "paid_not_registered":
			return "badge badge-review";
		case "registered_unpaid":
		case "registered_not_paid":
		case "duplicate_payment":
			return "badge badge-rejected";
		case "partial_payment":
			return "badge badge-processing";
		default:
			return "badge badge-neutral";
	}
}

export function ledgerDirectionBadgeClass(
	direction: BillingLedgerDirection | string,
): string {
	switch (direction) {
		case "inflow":
			return "badge badge-active";
		case "outflow":
			return "badge badge-rejected";
		default:
			return "badge badge-neutral";
	}
}

export function formatDateTime(date: string | Date | null | undefined): string {
	if (!date) return "—";
	try {
		const parsed = typeof date === "string" ? new Date(date) : date;
		if (Number.isNaN(parsed.getTime())) return "—";
		return parsed.toLocaleString("en-US", {
			dateStyle: "medium",
			timeStyle: "short",
		});
	} catch {
		return "—";
	}
}
