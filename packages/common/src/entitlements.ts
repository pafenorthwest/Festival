import { isValidIanaTimezone } from "./organization.js";

export const TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS =
	"teacher_membership" as const;
export const ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS =
	"accompanist_membership" as const;
export const ENTITLEMENT_CLASSES = [
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
] as const;
export type EntitlementClass = (typeof ENTITLEMENT_CLASSES)[number];

export const INITIAL_TEACHER_MEMBERSHIP_DURATION_DAYS = 365;
export const INITIAL_ACCOMPANIST_MEMBERSHIP_DURATION_DAYS = 365;
export const MAX_ENTITLEMENT_DURATION_DAYS = 36_500;

export const MEMBERSHIP_DIVISION_SELECTION_POLICIES = [
	"exactly_one",
	"one_to_two",
	"one_to_all",
] as const;
export type MembershipDivisionSelectionPolicy =
	(typeof MEMBERSHIP_DIVISION_SELECTION_POLICIES)[number];
/** @deprecated Membership policy applies equally to every entitlement class. */
export type AccompanistDivisionSelectionPolicy =
	MembershipDivisionSelectionPolicy;

export function isAccompanistDivisionSelectionPolicy(
	value: unknown,
): value is MembershipDivisionSelectionPolicy {
	return MEMBERSHIP_DIVISION_SELECTION_POLICIES.includes(
		value as MembershipDivisionSelectionPolicy,
	);
}

export function validateMembershipDivisionSelection(
	policy: MembershipDivisionSelectionPolicy,
	selectedDivisionIds: readonly string[],
	activeDivisionCount: number,
): void {
	if (new Set(selectedDivisionIds).size !== selectedDivisionIds.length) {
		throw new Error("Each membership division may be selected only once.");
	}
	const count = selectedDivisionIds.length;
	if (
		(policy === "exactly_one" && count !== 1) ||
		(policy === "one_to_two" && (count < 1 || count > 2)) ||
		(policy === "one_to_all" && (count < 1 || count > activeDivisionCount))
	) {
		throw new Error("Selected divisions do not satisfy the membership policy.");
	}
}

/** @deprecated Use validateMembershipDivisionSelection. */
export const validateAccompanistDivisionSelection =
	validateMembershipDivisionSelection;

export const ENTITLEMENT_GRANT_STATUSES = [
	"scheduled",
	"active",
	"expired",
	"revoked",
] as const;
export type EntitlementGrantStatus =
	(typeof ENTITLEMENT_GRANT_STATUSES)[number];

export interface TeacherMembershipOffering {
	id: string;
	organizationId: string;
	entitlementClass: EntitlementClass;
	displayName: string;
	durationDays: number;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	isActive: boolean;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface EntitlementGrantSnapshot {
	readonly id: string;
	readonly organizationId: string;
	readonly customerId: string;
	readonly entitlementClass: EntitlementClass;
	readonly offeringId: string;
	readonly durationDays: number;
	readonly divisionId: string;
	readonly divisionNameSnapshot: string;
	readonly paidAmount: string;
	readonly paidCurrencyCode: string;
	readonly checkoutIntentId: string;
	readonly shopifyOrderGid: string;
	readonly shopifyOrderLineGid: string;
	readonly startsOn: string;
	readonly endsOn: string;
	readonly status: EntitlementGrantStatus;
	readonly createdAtIso: string;
}

export const ENTITLEMENT_LIFECYCLES = [
	"scheduled",
	"active",
	"expired",
	"revoked",
] as const;
export type EntitlementLifecycleState = (typeof ENTITLEMENT_LIFECYCLES)[number];

/** Minimal immutable data needed to derive an entitlement's lifecycle. */
export interface EntitlementLifecycleInput {
	readonly startsOn: string;
	readonly endsOn: string;
	readonly revokedAtIso?: string;
}

/** Canonical clean-slate lifecycle record. State is intentionally derived. */
export interface MembershipEntitlement extends EntitlementLifecycleInput {
	readonly id: string;
	readonly organizationId: string;
	readonly customerId: string;
	readonly entitlementClass: EntitlementClass;
	readonly source: "teacher_checkout" | "accompanist_form";
	readonly offeringId: string;
	readonly revokedReason?: string;
	readonly createdAtIso: string;
}

export function deriveEntitlementLifecycle(
	entitlement: EntitlementLifecycleInput,
	today: string,
): EntitlementLifecycleState {
	parseCalendarDate(today);
	if (entitlement.revokedAtIso) return "revoked";
	if (today < entitlement.startsOn) return "scheduled";
	if (today >= entitlement.endsOn) return "expired";
	return "active";
}

export type CreateEntitlementGrantSnapshotInput = Omit<
	EntitlementGrantSnapshot,
	"id" | "createdAtIso"
> & { verifiedIdentityEmail: string };

/** Normalizes an email already verified by Shopify before it binds entitlement ownership. */
export function normalizeVerifiedShopifyIdentityEmail(value: string): string {
	const normalized = value.trim().toLowerCase();
	if ((normalized.match(/[a-z0-9]/gi) ?? []).length < 8) {
		throw new Error("Verified Shopify identity email is required.");
	}
	return normalized;
}

export function isEntitlementClass(value: unknown): value is EntitlementClass {
	return ENTITLEMENT_CLASSES.includes(value as EntitlementClass);
}

export function isEntitlementGrantStatus(
	value: unknown,
): value is EntitlementGrantStatus {
	return ENTITLEMENT_GRANT_STATUSES.includes(value as EntitlementGrantStatus);
}

export function isValidEntitlementDurationDays(
	value: unknown,
): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= MAX_ENTITLEMENT_DURATION_DAYS
	);
}

export function assertValidEntitlementDurationDays(value: unknown): number {
	if (!isValidEntitlementDurationDays(value)) {
		throw new Error(
			`Entitlement duration must be a positive integer no greater than ${MAX_ENTITLEMENT_DURATION_DAYS} days.`,
		);
	}
	return value;
}

function parseCalendarDate(value: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error("Entitlement calendar date must use YYYY-MM-DD.");
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (
		Number.isNaN(parsed.valueOf()) ||
		parsed.toISOString().slice(0, 10) !== value
	) {
		throw new Error("Entitlement calendar date is invalid.");
	}
	return parsed;
}

export function assertValidEntitlementGrantSnapshotInput(
	input: Omit<CreateEntitlementGrantSnapshotInput, "verifiedIdentityEmail">,
): void {
	if (!isEntitlementClass(input.entitlementClass)) {
		throw new Error("Entitlement class is invalid.");
	}
	assertValidEntitlementDurationDays(input.durationDays);
	for (const [label, value] of [
		["Organization", input.organizationId],
		["Customer", input.customerId],
		["Offering", input.offeringId],
		["Division", input.divisionId],
		["Division name snapshot", input.divisionNameSnapshot],
		["Checkout intent", input.checkoutIntentId],
		["Shopify order", input.shopifyOrderGid],
		["Shopify order line", input.shopifyOrderLineGid],
	] as const) {
		if (!value.trim())
			throw new Error(`${label} is required for an entitlement grant.`);
	}
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(input.paidAmount)) {
		throw new Error("Paid order-line amount must be a non-negative decimal.");
	}
	if (!/^[A-Z]{3}$/.test(input.paidCurrencyCode)) {
		throw new Error("Paid order-line currency must be a three-letter code.");
	}
	if (!isEntitlementGrantStatus(input.status)) {
		throw new Error("Entitlement grant status is invalid.");
	}
	parseCalendarDate(input.endsOn);
	const expectedEndsOn = addCalendarDays(input.startsOn, input.durationDays);
	if (input.endsOn !== expectedEndsOn) {
		throw new Error(
			"Entitlement endsOn must equal startsOn plus durationDays calendar days.",
		);
	}
}

export function addCalendarDays(
	startDate: string,
	durationDays: number,
): string {
	const parsed = parseCalendarDate(startDate);
	parsed.setUTCDate(
		parsed.getUTCDate() + assertValidEntitlementDurationDays(durationDays),
	);
	return parsed.toISOString().slice(0, 10);
}

export function calendarDateInTimezone(
	instantIso: string,
	timezone: string,
): string {
	if (!isValidIanaTimezone(timezone)) {
		throw new Error("Organization timezone must be a valid IANA timezone.");
	}
	if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(instantIso)) {
		throw new Error(
			"Shopify fully-paid timestamp must include Z or an explicit numeric UTC offset.",
		);
	}
	const instant = new Date(instantIso);
	if (Number.isNaN(instant.valueOf())) {
		throw new Error("Shopify fully-paid timestamp must be a valid instant.");
	}
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(instant);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((candidate) => candidate.type === type)?.value;
	const year = part("year");
	const month = part("month");
	const day = part("day");
	if (!year || !month || !day) {
		throw new Error(
			"Unable to derive the paid date in the Organization timezone.",
		);
	}
	return `${year}-${month}-${day}`;
}

export function deriveEntitlementDates(input: {
	fullyPaidAtIso: string;
	organizationTimezone: string;
	durationDays: number;
}): { startsOn: string; endsOn: string } {
	const startsOn = calendarDateInTimezone(
		input.fullyPaidAtIso,
		input.organizationTimezone,
	);
	return {
		startsOn,
		endsOn: addCalendarDays(startsOn, input.durationDays),
	};
}
