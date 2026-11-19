import type {
	ClassEntitlement,
	CreateClassEntitlementInput,
	CreateEntitlementGrantSnapshotInput,
	EntitlementGrantSnapshot,
} from "@festival/common";

export const MEMBERSHIP_DECISION_STATUSES = [
	"pending_validation",
	"approved",
	"rejected",
	"needs_review",
] as const;

export type MembershipDecisionStatus =
	(typeof MEMBERSHIP_DECISION_STATUSES)[number];

export const MEMBERSHIP_REASON_CODES = [
	"correlation_missing",
	"correlation_invalid",
	"intent_expired",
	"order_not_paid",
	"payment_incomplete",
	"payment_mismatch",
	"customer_mismatch",
	"offering_mismatch",
	"division_invalid",
	"duplicate_purchase",
	"policy_mismatch",
	"upstream_invalid",
] as const;

export type MembershipReasonCode = (typeof MEMBERSHIP_REASON_CODES)[number];

export class PaidLineConflictError extends Error {
	constructor(
		message = "Class entitlement paid-line conflict: the paid order line already maps to another association.",
	) {
		super(message);
		this.name = "PaidLineConflictError";
	}
}

export interface ShopifyOrderProjection {
	organizationId: string;
	shopifyOrderGid: string;
	shopifyCustomerGid?: string;
	correlationId?: string;
	fullyPaidAtIso?: string;
	currencyCode?: string;
	createdAtIso: string;
	updatedAtIso: string;
}

export type ShopifyOrderProjectionInput = Omit<
	ShopifyOrderProjection,
	"createdAtIso" | "updatedAtIso"
> & {
	updatedAtIso: string;
};

export interface MembershipValidationDecision {
	id: string;
	organizationId: string;
	customerId?: string;
	checkoutIntentId?: string;
	shopifyOrderGid: string;
	shopifyOrderLineGid?: string;
	status: MembershipDecisionStatus;
	reasonCode?: MembershipReasonCode;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface MembershipReconciliationRun {
	id: string;
	organizationId: string;
	status: "completed" | "failed";
	discoveredCount: number;
	processedCount: number;
	startedAtIso: string;
	finishedAtIso: string;
	failureCategory?: "upstream" | "persistence" | "invalid";
}

export interface MembershipDecisionAuditRecord {
	id: string;
	organizationId: string;
	decisionId: string;
	priorStatus: "pending_validation" | "needs_review";
	finalStatus: "approved" | "rejected";
	actorUserId: string;
	note: string;
	resolvedAtIso: string;
}

export interface ResolveDecisionManuallyInput {
	organizationId: string;
	decisionId: string;
	finalStatus: "approved" | "rejected";
	actorUserId: string;
	note: string;
	resolvedAtIso: string;
	customerId?: string;
	checkoutIntentId?: string;
	shopifyOrderLineGid?: string;
	projection?: ShopifyOrderProjectionInput;
	grant?: CreateEntitlementGrantSnapshotInput;
}

export interface FinalizeDecisionInput {
	deliveryId: string;
	decision: Omit<
		MembershipValidationDecision,
		"id" | "createdAtIso" | "updatedAtIso"
	> & {
		updatedAtIso: string;
	};
	projection?: ShopifyOrderProjectionInput;
	grant?: CreateEntitlementGrantSnapshotInput;
	classEntitlement?: CreateClassEntitlementInput;
	classEntitlements?: CreateClassEntitlementInput[];
}

export interface FinalizeDecisionResult {
	decision: MembershipValidationDecision;
	grant?: EntitlementGrantSnapshot;
	classEntitlement?: ClassEntitlement;
	classEntitlements?: ClassEntitlement[];
	existing: boolean;
}

export interface ResolveDecisionManuallyResult {
	decision: MembershipValidationDecision;
	grant?: EntitlementGrantSnapshot;
	audit: MembershipDecisionAuditRecord;
}

export function decisionFromRow(
	row: Record<string, unknown>,
): MembershipValidationDecision {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		customerId: row.customer_id === null ? undefined : String(row.customer_id),
		checkoutIntentId:
			row.checkout_intent_id === null
				? undefined
				: String(row.checkout_intent_id),
		shopifyOrderGid: String(row.shopify_order_gid),
		shopifyOrderLineGid:
			row.shopify_order_line_gid === null
				? undefined
				: String(row.shopify_order_line_gid),
		status: row.status as MembershipDecisionStatus,
		reasonCode:
			row.reason_code === null
				? undefined
				: (row.reason_code as MembershipReasonCode),
		createdAtIso: String(row.created_at),
		updatedAtIso: String(row.updated_at),
	};
}

export function reconciliationRunFromRow(
	row: Record<string, unknown>,
): MembershipReconciliationRun {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		status: row.status as MembershipReconciliationRun["status"],
		discoveredCount: Number(row.discovered_count),
		processedCount: Number(row.processed_count),
		startedAtIso: String(row.started_at),
		finishedAtIso: String(row.finished_at),
		failureCategory:
			row.failure_category === null
				? undefined
				: (row.failure_category as MembershipReconciliationRun["failureCategory"]),
	};
}

export function orderProjectionFromRow(
	row: Record<string, unknown>,
): ShopifyOrderProjection {
	return {
		organizationId: String(row.organization_id),
		shopifyOrderGid: String(row.shopify_order_gid),
		shopifyCustomerGid:
			row.shopify_customer_gid === null
				? undefined
				: String(row.shopify_customer_gid),
		correlationId:
			row.correlation_id === null ? undefined : String(row.correlation_id),
		fullyPaidAtIso:
			row.fully_paid_at === null ? undefined : String(row.fully_paid_at),
		currencyCode:
			row.currency_code === null ? undefined : String(row.currency_code),
		createdAtIso: String(row.created_at),
		updatedAtIso: String(row.updated_at),
	};
}

export function assertMatchingClassEntitlementReplay(
	existing: ClassEntitlement,
	input: CreateClassEntitlementInput,
): void {
	const matches =
		existing.organizationId === input.organizationId &&
		existing.festivalId === input.festivalId &&
		existing.festivalClassId === input.festivalClassId &&
		existing.parentCustomerId === input.parentCustomerId &&
		existing.childId === input.childId &&
		existing.checkoutIntentId === input.checkoutIntentId &&
		existing.checkoutIntentLineId === (input.checkoutIntentLineId ?? null) &&
		existing.shopifyOrderGid === input.shopifyOrderGid &&
		existing.shopifyOrderLineGid === input.shopifyOrderLineGid &&
		existing.paidAmountCents === input.paidAmountCents &&
		existing.paidCurrencyCode === input.paidCurrencyCode &&
		existing.status === (input.status ?? "confirmed");
	if (!matches) {
		throw new PaidLineConflictError();
	}
}
