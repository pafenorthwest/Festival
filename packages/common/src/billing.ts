export const BILLING_ADJUSTMENT_TYPES = [
	"refund",
	"credit_issue",
	"credit_apply",
	"manual_charge",
	"write_off",
] as const;

export type BillingAdjustmentType = (typeof BILLING_ADJUSTMENT_TYPES)[number];

export function isBillingAdjustmentType(
	value: unknown,
): value is BillingAdjustmentType {
	return (
		typeof value === "string" &&
		(BILLING_ADJUSTMENT_TYPES as readonly string[]).includes(value)
	);
}

export const BILLING_LEDGER_ENTRY_TYPES = [
	"credit",
	"debit",
	"adjustment",
] as const;

export type BillingLedgerEntryType =
	(typeof BILLING_LEDGER_ENTRY_TYPES)[number];

export function isBillingLedgerEntryType(
	value: unknown,
): value is BillingLedgerEntryType {
	return (
		typeof value === "string" &&
		(BILLING_LEDGER_ENTRY_TYPES as readonly string[]).includes(value)
	);
}

export const BILLING_LEDGER_DIRECTIONS = ["inflow", "outflow"] as const;

export type BillingLedgerDirection = (typeof BILLING_LEDGER_DIRECTIONS)[number];

export function isBillingLedgerDirection(
	value: unknown,
): value is BillingLedgerDirection {
	return (
		typeof value === "string" &&
		(BILLING_LEDGER_DIRECTIONS as readonly string[]).includes(value)
	);
}

export const BILLING_MISMATCH_TYPES = [
	"paid_unregistered",
	"registered_unpaid",
	"partial_payment",
	"overpayment",
	"duplicate_payment",
	"paid_not_registered",
	"registered_not_paid",
] as const;

export type BillingMismatchType = (typeof BILLING_MISMATCH_TYPES)[number];

export function isBillingMismatchType(
	value: unknown,
): value is BillingMismatchType {
	return (
		typeof value === "string" &&
		(BILLING_MISMATCH_TYPES as readonly string[]).includes(value)
	);
}

export interface CreditBalance {
	organizationId: string;
	customerId: string;
	balanceCents: number;
	currencyCode: string;
	updatedAt?: string | Date;
	updatedAtIso?: string;
}

export interface BillingAdjustment {
	id: string;
	organizationId: string;
	customerId: string;
	adminUserId: string;
	adjustmentType: BillingAdjustmentType;
	amountCents: number;
	currencyCode: string;
	reason: string;
	referenceType?: string | null;
	referenceId?: string | null;
	approvedDecisionId?: string | null;
	createdAt?: string | Date;
	createdAtIso?: string;
}

export interface BillingLedgerEntry {
	id: string;
	organizationId: string;
	customerId: string;
	entryType: BillingLedgerEntryType;
	amountCents: number;
	direction: BillingLedgerDirection;
	balanceAfterCents: number;
	currencyCode: string;
	adjustmentId?: string | null;
	notes?: string | null;
	createdAt?: string | Date;
	createdAtIso?: string;
}

export interface BillingMismatchRecord {
	id: string;
	organizationId: string;
	customerId: string;
	mismatchType: BillingMismatchType;
	description?: string | null;
	amountCents?: number | null;
	currencyCode?: string;
	shopifyOrderId?: string | null;
	registrationId?: string | null;
	entitlementId?: string | null;
	resolved?: boolean;
	resolutionNotes?: string | null;
	resolvedAt?: string | Date | null;
	resolvedByUserId?: string | null;
	createdAt?: string | Date;
	createdAtIso?: string;
	updatedAt?: string | Date;
	updatedAtIso?: string;
}

export interface CreateBillingAdjustmentInput {
	organizationId: string;
	customerId: string;
	adminUserId: string;
	adjustmentType: BillingAdjustmentType;
	amountCents: number;
	currencyCode?: string;
	reason: string;
	referenceType?: string | null;
	referenceId?: string | null;
	approvedDecisionId?: string | null;
}

export interface BillingAdjustmentValidationResult<
	T = CreateBillingAdjustmentInput,
> {
	valid: boolean;
	errors: string[];
	data?: T;
}

export function validateCreateBillingAdjustmentInput(
	payload: unknown,
): BillingAdjustmentValidationResult {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return {
			valid: false,
			errors: ["Billing adjustment input must be an object."],
		};
	}

	const body = payload as Record<string, unknown>;
	const errors: string[] = [];

	const organizationId =
		typeof body.organizationId === "string" ? body.organizationId.trim() : "";
	if (organizationId.length === 0) {
		errors.push("Organization ID is required.");
	}

	const customerId =
		typeof body.customerId === "string" ? body.customerId.trim() : "";
	if (customerId.length === 0) {
		errors.push("Customer ID is required.");
	}

	const adminUserId =
		typeof body.adminUserId === "string" ? body.adminUserId.trim() : "";
	if (adminUserId.length === 0) {
		errors.push("Admin user ID is required.");
	}

	const adjustmentType =
		typeof body.adjustmentType === "string" ? body.adjustmentType.trim() : "";
	if (!isBillingAdjustmentType(adjustmentType)) {
		errors.push(
			`Adjustment type must be one of: ${BILLING_ADJUSTMENT_TYPES.join(", ")}.`,
		);
	}

	const amountCents = body.amountCents;
	if (
		typeof amountCents !== "number" ||
		!Number.isInteger(amountCents) ||
		amountCents <= 0
	) {
		errors.push("Adjustment amount in cents must be a positive integer.");
	}

	const reason = typeof body.reason === "string" ? body.reason.trim() : "";
	if (reason.length === 0) {
		errors.push("Adjustment reason is required.");
	}

	let currencyCode = "USD";
	if (body.currencyCode !== undefined && body.currencyCode !== null) {
		if (
			typeof body.currencyCode !== "string" ||
			body.currencyCode.trim().length === 0
		) {
			errors.push("Currency code must be a non-empty string.");
		} else {
			currencyCode = body.currencyCode.trim().toUpperCase();
			if (!/^[A-Z]{3}$/.test(currencyCode)) {
				errors.push("Currency code must be a 3-letter ISO code.");
			}
		}
	}

	const referenceType =
		typeof body.referenceType === "string" &&
		body.referenceType.trim().length > 0
			? body.referenceType.trim()
			: null;

	const referenceId =
		typeof body.referenceId === "string" && body.referenceId.trim().length > 0
			? body.referenceId.trim()
			: null;

	const approvedDecisionId =
		typeof body.approvedDecisionId === "string" &&
		body.approvedDecisionId.trim().length > 0
			? body.approvedDecisionId.trim()
			: null;

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	return {
		valid: true,
		errors: [],
		data: {
			organizationId,
			customerId,
			adminUserId,
			adjustmentType: adjustmentType as BillingAdjustmentType,
			amountCents: amountCents as number,
			currencyCode,
			reason,
			referenceType,
			referenceId,
			approvedDecisionId,
		},
	};
}

export function assertValidCreateBillingAdjustmentInput(
	payload: unknown,
): asserts payload is CreateBillingAdjustmentInput {
	const result = validateCreateBillingAdjustmentInput(payload);
	if (!result.valid) {
		throw new Error(result.errors.join("; "));
	}
}
