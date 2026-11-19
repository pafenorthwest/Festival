import { createHash } from "node:crypto";
import {
	addCalendarDays,
	type CreateEntitlementGrantSnapshotInput,
	calendarDaysUntil,
	deriveEntitlementDates,
	type EntitlementGrantSnapshot,
	normalizeVerifiedShopifyIdentityEmail,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS,
} from "@festival/common";
import { lifecycleForEntitlementRead } from "../../infra/s11-infra.js";
import type { CheckoutIntentRecord } from "../class-checkout/index.js";
import {
	type MembershipValidationDecision,
	PaidLineConflictError,
} from "./order-projection-types.js";
import {
	ShopifyAdminApiError,
	ShopifyIntegrationError,
	ShopifyTransportError,
} from "./shopify-errors.js";
import type { ShopifyPaidOrder } from "./shopify-types.js";
import type { WebhookDeliveryFailureInput } from "./webhook-delivery-repository.js";

export type ProcessingResult = "processed" | "skipped" | "failed";

export const SHOPIFY_API_VERSION = "2026-07" as const;

export function nowIso(now: () => Date): string {
	return now().toISOString();
}

export function safeOrderHash(shopifyOrderGid: string): string {
	return createHash("sha256")
		.update(shopifyOrderGid)
		.digest("hex")
		.slice(0, 12);
}

export function reconciliationWebhookId(orderId: string): string {
	const digest = createHash("sha256")
		.update(orderId)
		.digest("hex")
		.slice(0, 32);
	return `reconcile:${digest}`;
}

export function reconciliationFailureCategory(
	error: unknown,
): "upstream" | "persistence" | "invalid" {
	if (
		error instanceof Error &&
		/invalid|mismatch|missing|unsupported/i.test(error.message)
	) {
		return "invalid";
	}
	return "upstream";
}

export function failureClassification(
	error: unknown,
	stage: WebhookDeliveryFailureInput["stage"],
): Omit<WebhookDeliveryFailureInput, "failedAtIso"> {
	if (error instanceof ShopifyTransportError) {
		return { category: "upstream", stage, code: "shopify_transport" };
	}
	if (error instanceof ShopifyIntegrationError) {
		const requestId =
			error.requestId &&
			/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(error.requestId)
				? error.requestId
				: undefined;
		return {
			category: "upstream",
			stage,
			code: "shopify_upstream",
			...(requestId ? { requestId } : {}),
		};
	}
	if (error instanceof PaidLineConflictError) {
		return { category: "persistence", stage, code: "paid_line_conflict" };
	}
	const category = reconciliationFailureCategory(error);
	return {
		category,
		stage,
		code:
			category === "invalid"
				? "invalid_data"
				: category === "persistence"
					? "persistence"
					: "unexpected",
	};
}

export function failureDiagnostic(error: unknown): string {
	if (
		error instanceof ShopifyAdminApiError ||
		error instanceof ShopifyIntegrationError
	) {
		return `${error.name}:${error.failureCategory}`;
	}
	if (error instanceof Error) {
		return error.name;
	}
	return "UnknownError";
}

function resolveMembershipDurationDays(intent: CheckoutIntentRecord): number {
	const days = intent.durationDays;
	if (!Number.isInteger(days) || !days || days < 1) {
		throw new Error("Membership checkout intent durationDays is invalid.");
	}
	return days;
}

export function deriveMembershipGrantDates(input: {
	fullyPaidAtIso?: string;
	timezone: string;
	durationDays: number;
	existingGrants: readonly EntitlementGrantSnapshot[];
}): { startsOn: string; endsOn: string; paidDate: string } {
	if (!input.fullyPaidAtIso) {
		throw new Error("Shopify payment timestamp is required.");
	}
	const baseDates = deriveEntitlementDates({
		fullyPaidAtIso: input.fullyPaidAtIso,
		organizationTimezone: input.timezone,
		durationDays: input.durationDays,
	});
	const paidDate = baseDates.startsOn;
	const previousActiveGrant = input.existingGrants
		.filter(
			(grant) =>
				grant.entitlementClass === TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS &&
				lifecycleForEntitlementRead(grant, paidDate) === "active" &&
				calendarDaysUntil(paidDate, grant.endsOn) <=
					TEACHER_MEMBERSHIP_RENEWAL_WINDOW_DAYS,
		)
		.sort((left, right) => right.endsOn.localeCompare(left.endsOn))[0];
	const effectiveStartDate =
		previousActiveGrant && previousActiveGrant.endsOn > paidDate
			? previousActiveGrant.endsOn
			: paidDate;
	const endsOn = addCalendarDays(effectiveStartDate, input.durationDays);
	return { startsOn: paidDate, endsOn, paidDate };
}

export function buildMembershipGrantInput(input: {
	organizationId: string;
	intent: CheckoutIntentRecord;
	order: ShopifyPaidOrder;
	timezone: string;
	existingGrants: readonly EntitlementGrantSnapshot[];
}): CreateEntitlementGrantSnapshotInput {
	const durationDays = resolveMembershipDurationDays(input.intent);
	const { startsOn, endsOn } = deriveMembershipGrantDates({
		fullyPaidAtIso: input.order.fullyPaidAtIso,
		timezone: input.timezone,
		durationDays,
		existingGrants: input.existingGrants,
	});
	const line = input.order.lineItems[0];
	return {
		organizationId: input.organizationId,
		customerId: input.intent.customerId,
		offeringId: input.intent.offeringId ?? "",
		durationDays,
		verifiedIdentityEmail: input.order.customerEmail
			? normalizeVerifiedShopifyIdentityEmail(input.order.customerEmail)
			: "",
		paidAmount: line?.paidAmount ?? input.intent.amount,
		paidCurrencyCode: line?.paidCurrencyCode ?? input.intent.currencyCode,
		checkoutIntentId: input.intent.id,
		shopifyOrderGid: input.order.id,
		shopifyOrderLineGid: line?.id ?? `${input.order.id}#line-0`,
		entitlementClass:
			input.intent.entitlementClass ?? TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
		startsOn,
		endsOn,
		status: "active",
		divisionId: input.intent.divisionId ?? "",
		divisionNameSnapshot: input.intent.divisionNameSnapshot ?? "",
	};
}

export function buildManualApprovalGrant(input: {
	organizationId: string;
	intent: CheckoutIntentRecord;
	order: ShopifyPaidOrder;
	decision: MembershipValidationDecision;
	timezone: string;
	existingGrants: readonly EntitlementGrantSnapshot[];
}): CreateEntitlementGrantSnapshotInput {
	const base = buildMembershipGrantInput(input);
	return {
		...base,
		shopifyOrderLineGid:
			input.decision.shopifyOrderLineGid ?? base.shopifyOrderLineGid,
	};
}
