import * as v from "valibot";
import type {
	CreateFestivalClassInput,
	FestivalClassConfigurationDto,
	UpdateFestivalClassInput,
} from "./catalog.js";
import type {
	ClassEntitlement,
	ClassEntitlementStatus,
	RegistrationEligibleClass,
} from "./entitlements.js";
import {
	type ClassEligibilityResult,
	ELIGIBILITY_REASON_CODES,
	type ProposedPurchaseLineItem,
} from "./purchase-eligibility.js";
import {
	assertValidDropRegistrationInput,
	assertValidTransferRegistrationInput,
	validateDropRegistrationInput,
	validateRepertoirePiece,
	validateTransferRegistrationInput,
} from "./registration-validation.js";
import { nonEmptyText } from "./schema-utils.js";

export type {
	CreateFestivalClassInput,
	FestivalClassConfigurationDto,
	RegistrationEligibleClass,
	UpdateFestivalClassInput,
};
export {
	assertValidDropRegistrationInput,
	assertValidTransferRegistrationInput,
	validateDropRegistrationInput,
	validateRepertoirePiece,
	validateTransferRegistrationInput,
};

export const RepertoirePieceSchema = v.object({
	title: nonEmptyText("Title", 300),
	composer: nonEmptyText("Composer", 300),
	movement: v.optional(v.nullable(v.string())),
	durationSeconds: v.pipe(
		v.number("Duration must be a number."),
		v.integer("Duration must be a whole number of seconds."),
		v.minValue(1, "Duration must be a positive integer."),
	),
	durationMinutes: v.optional(v.number()),
	catalogWorkId: v.optional(v.nullable(v.string())),
});

export interface RepertoirePiece {
	title: string;
	composer: string;
	movement?: string | null;
	/** Positive whole seconds. */
	durationSeconds: number;
	durationMinutes?: number;
	catalogWorkId?: string | null;
}

/** Roles supported by an organization-owned repertoire catalog. */
export type RepertoireContributorRole =
	| "Composer"
	| "Copyist"
	| "Editor"
	| "Arranger"
	| "Transcriber"
	| "Realizer"
	| "Orchestrator";

/**
 * An immutable name-and-role snapshot. catalogContributorId may be absent for
 * a free-text contributor that has not been added to the organization's catalog.
 */
export interface RegistrationRepertoireItemContributor {
	id: string;
	displayOrder: 1 | 2 | 3;
	role: RepertoireContributorRole;
	displayNameSnapshot: string;
	catalogContributorId: string | null;
}

/**
 * One performed work submitted with a registration. Display fields are copied
 * at submission time so catalog edits never rewrite historical registrations.
 */
export interface RegistrationRepertoireItem {
	id: string;
	registrationMetadataId: string;
	organizationId: string;
	displayOrder: number;
	catalogWorkId: string | null;
	titleSnapshot: string;
	performedMovementText: string | null;
	/** Positive whole seconds. */
	durationSeconds: number;
	contributors: RegistrationRepertoireItemContributor[];
}

export interface ClassRegistrationRequest {
	childId: string;
	divisionId: string;
	festivalClassId: string;
	teacherId: string;
	accompanistId?: string;
	pieces: RepertoirePiece[];
	buyerAccessToken: string;
}

/** Original validated selection. Later registration edits never replace this record. */
export interface ClassRegistrationSnapshot {
	version: 1;
	capturedAtIso: string;
	class: {
		id: string;
		festivalId: string;
		displayName: string;
		classSubtypeId: string;
		classSubtypeName: string | null;
		minimumAge: number;
		maximumAge: number;
		price: string;
		currencyCode: string;
		maximumPerformancePieces: 1 | 2 | 3;
		performanceMinutes: number;
		capacity: number;
	};
	division: { id: string; name: string | null };
	instrument: { id: string; name: string } | "unknown";
	teacher: { customerId: string; membershipId: string; name: string | null };
	accompanist: {
		customerId: string;
		membershipId: string;
		name: string | null;
	} | null;
	repertoire: RepertoirePiece[];
}

/** Normalize older stored selections without inventing an absent historical snapshot. */
export function normalizeClassRegistrationSnapshot(
	snapshot: ClassRegistrationSnapshot | null | undefined,
): ClassRegistrationSnapshot | null {
	return snapshot
		? { ...snapshot, instrument: snapshot.instrument ?? "unknown" }
		: null;
}

export interface ClassRegistrationMetadata {
	id: string;
	organizationId: string;
	festivalId: string;
	checkoutIntentId: string;
	checkoutIntentLineId?: string | null;
	classEntitlementId: string | null;
	teacherMembershipId: string;
	accompanistMembershipId: string | null;
	/** Legacy raw submission retained during the relational-repertoire transition. */
	repertoireJson: RepertoirePiece[];
	repertoireItems: RegistrationRepertoireItem[];
	/** Null/absent on historical checkouts whose original selection was not captured. */
	registrationSnapshot?: ClassRegistrationSnapshot | null;
	createdAt: Date;
}

export const REGISTRATION_CHANGE_ACTIONS = [
	"drop",
	"transfer",
	"waitlist_promote",
	"revert",
] as const;
export type RegistrationChangeAction =
	(typeof REGISTRATION_CHANGE_ACTIONS)[number];

export function isRegistrationChangeAction(
	value: unknown,
): value is RegistrationChangeAction {
	return (
		typeof value === "string" &&
		REGISTRATION_CHANGE_ACTIONS.includes(value as RegistrationChangeAction)
	);
}

export const REGISTRATION_ACTOR_ROLES = [
	"customer",
	"admin",
	"system",
] as const;
export type RegistrationActorRole = (typeof REGISTRATION_ACTOR_ROLES)[number];

export function isRegistrationActorRole(
	value: unknown,
): value is RegistrationActorRole {
	return (
		typeof value === "string" &&
		REGISTRATION_ACTOR_ROLES.includes(value as RegistrationActorRole)
	);
}

export interface RegistrationChangeLog {
	id: string;
	organizationId: string;
	festivalId?: string | null;
	classEntitlementId: string;
	action: RegistrationChangeAction;
	actorUid: string;
	actorRole: RegistrationActorRole;
	previousState: Record<string, unknown>;
	newState: Record<string, unknown>;
	reason?: string | null;
	createdAt: string;
}

export const REFUND_EVENT_STATUSES = [
	"pending",
	"completed",
	"failed",
] as const;
export type RefundEventStatus = (typeof REFUND_EVENT_STATUSES)[number];

export function isRefundEventStatus(
	value: unknown,
): value is RefundEventStatus {
	return (
		typeof value === "string" &&
		REFUND_EVENT_STATUSES.includes(value as RefundEventStatus)
	);
}

export interface RefundEvent {
	id: string;
	organizationId: string;
	registrationChangeLogId?: string | null;
	classEntitlementId?: string | null;
	shopifyOrderId?: string | null;
	/** Shopify order-line GID whose historical allocation this event refunds. */
	shopifyOrderLineId?: string | null;
	shopifyRefundId?: string | null;
	amountCents: number;
	currency: string;
	status: RefundEventStatus;
	failureReason?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface DropRegistrationInput {
	classEntitlementId: string;
	organizationId?: string;
	festivalId?: string;
	actorUid?: string;
	actorRole?: RegistrationActorRole;
	reason?: string | null;
	requestRefund?: boolean;
	issueRefund?: boolean;
	refundAmountCents?: number | null;
	refundReason?: string | null;
}

export interface DropRegistrationResult {
	success: boolean;
	classEntitlementId: string;
	classEntitlement?: ClassEntitlement;
	changeLog?: RegistrationChangeLog;
	refundEvent?: RefundEvent | null;
	promotedWaitlistEntitlements?: WaitlistPromotionResult[];
	message?: string;
}

export interface TransferRegistrationInput {
	classEntitlementId: string;
	targetFestivalClassId: string;
	sourceFestivalClassId?: string;
	organizationId?: string;
	festivalId?: string;
	actorUid?: string;
	actorRole?: RegistrationActorRole;
	reason?: string | null;
	pieces?: RepertoirePiece[];
	priceDifferenceCents?: number | null;
}

export interface TransferRegistrationResult {
	success: boolean;
	classEntitlementId: string;
	targetFestivalClassId: string;
	previousFestivalClassId?: string;
	classEntitlement?: ClassEntitlement;
	changeLog?: RegistrationChangeLog;
	refundEvent?: RefundEvent | null;
	promotedWaitlistEntitlements?: WaitlistPromotionResult[];
	message?: string;
}

export interface WaitlistPromotionResult {
	classEntitlementId: string;
	festivalClassId: string;
	promoted: boolean;
	previousStatus?: ClassEntitlementStatus;
	newStatus?: ClassEntitlementStatus;
	changeLog?: RegistrationChangeLog;
	message?: string;
}

export interface RegistrationValidationResult<T> {
	valid: boolean;
	errors: string[];
	data?: T;
	request?: T;
}

export type DropRegistrationValidationResult =
	RegistrationValidationResult<DropRegistrationInput>;
export type TransferRegistrationValidationResult =
	RegistrationValidationResult<TransferRegistrationInput>;

export const ProposedPurchaseLineItemSchema = v.object({
	id: v.optional(v.string()),
	childId: nonEmptyText("Child ID", 200),
	festivalClassId: nonEmptyText("Festival class ID", 200),
	teacherId: v.optional(v.string()),
	accompanistId: v.optional(v.nullable(v.string())),
	pieces: v.optional(v.array(RepertoirePieceSchema)),
	isCandidate: v.optional(v.boolean()),
});

export const EvaluateRegistrationEligibilityInputSchema = v.object({
	items: v.pipe(
		v.array(ProposedPurchaseLineItemSchema),
		v.minLength(1, "At least one item is required."),
	),
	csrfToken: v.optional(v.string()),
});

export interface EvaluateRegistrationEligibilityInput {
	items: ProposedPurchaseLineItem[];
	csrfToken?: string;
}

const SubtypeDependencyDescriptorSchema = v.object({
	requiredSubtypeId: v.string(),
	requiredSubtypeName: v.optional(v.string()),
	divisionId: v.optional(v.string()),
	minimumAge: v.optional(v.number()),
	maximumAge: v.optional(v.number()),
	classSubtypeId: v.optional(v.string()),
	festivalClassId: v.optional(v.string()),
	satisfiedBy: v.optional(v.picklist(["entitlement", "proposed_item"])),
	sourceFestivalClassId: v.optional(v.string()),
	sourceLineItemId: v.optional(v.string()),
});

export const ClassEligibilityResultSchema = v.object({
	childId: v.string(),
	festivalClassId: v.string(),
	eligible: v.boolean(),
	isEligible: v.boolean(),
	reasonCode: v.picklist(ELIGIBILITY_REASON_CODES),
	message: v.optional(v.string()),
	availability: v.optional(v.picklist(["open", "waitlist"])),
	capacity: v.optional(v.number()),
	placedCount: v.optional(v.number()),
	dependencyDescriptor: v.optional(SubtypeDependencyDescriptorSchema),
	missingPrerequisite: v.optional(SubtypeDependencyDescriptorSchema),
	satisfiedPrerequisites: v.optional(
		v.array(SubtypeDependencyDescriptorSchema),
	),
	lineItemId: v.optional(v.string()),
});

export const EvaluateRegistrationEligibilityResponseSchema = v.object({
	results: v.array(ClassEligibilityResultSchema),
});

export interface EvaluateRegistrationEligibilityResponse {
	results: ClassEligibilityResult[];
}

const StartClassCheckoutLineItemSchema = v.object({
	id: v.optional(v.string()),
	childId: nonEmptyText("Child ID", 200),
	festivalClassId: nonEmptyText("Festival class ID", 200),
	classId: v.optional(v.string()),
	divisionId: v.optional(v.string()),
	teacherId: v.optional(v.string()),
	instrumentId: v.optional(v.string()),
	accompanistId: v.optional(v.nullable(v.string())),
	accompanistOption: v.optional(v.string()),
	pieces: v.optional(v.array(RepertoirePieceSchema)),
	isCandidate: v.optional(v.boolean()),
});

export const StartClassCheckoutInputSchema = v.object({
	festivalClassId: v.optional(v.string()),
	childId: v.optional(v.string()),
	teacherId: v.optional(v.string()),
	instrumentId: v.optional(v.string()),
	pieces: v.optional(v.array(RepertoirePieceSchema)),
	divisionId: v.optional(v.string()),
	accompanistId: v.optional(v.string()),
	festivalId: v.optional(v.string()),
	festivalShortName: v.optional(v.string()),
	currency: v.optional(v.string()),
	currencyCode: v.optional(v.string()),
	lineItems: v.optional(v.array(StartClassCheckoutLineItemSchema)),
	items: v.optional(v.array(StartClassCheckoutLineItemSchema)),
});

export type StartClassCheckoutInput = v.InferOutput<
	typeof StartClassCheckoutInputSchema
>;

export const StartClassCheckoutResponseSchema = v.object({
	checkoutUrl: v.string(),
	correlationId: v.string(),
});
export type StartClassCheckoutResponse = v.InferOutput<
	typeof StartClassCheckoutResponseSchema
>;

export const UpdateRegistrationMetadataInputSchema = v.objectWithRest(
	{
		pieces: v.optional(v.array(RepertoirePieceSchema)),
		accompanistId: v.optional(v.nullable(v.string())),
	},
	v.unknown(),
);
export type UpdateRegistrationMetadataInput = v.InferOutput<
	typeof UpdateRegistrationMetadataInputSchema
>;

export const ClassCheckoutRecoveryReferenceInputSchema = v.strictObject({
	recoveryReference: v.pipe(
		v.string("Checkout reference is required."),
		v.uuid("Checkout reference must be a valid UUID."),
	),
});

export const JoinWaitlistBodySchema = v.object({
	childId: nonEmptyText("Child ID", 200),
	parentName: nonEmptyText("Parent name", 255),
	parentEmail: nonEmptyText("Parent email", 320),
	parentPhone: nonEmptyText("Parent phone", 60),
	staffAccessConsent: v.boolean("Staff access consent is required."),
	festivalClassId: v.optional(v.string()),
});

export const WithdrawWaitlistBodySchema = v.pipe(
	v.object({
		waitlistEntryId: v.optional(nonEmptyText("Waitlist entry ID", 200)),
		id: v.optional(nonEmptyText("Waitlist entry ID", 200)),
		childId: v.optional(nonEmptyText("Child ID", 200)),
		festivalClassId: v.optional(v.string()),
	}),
	v.check(
		(input) => Boolean(input.waitlistEntryId || input.id || input.childId),
		"Either waitlistEntryId or childId is required.",
	),
);

export const DropRegistrationBodySchema = v.object({
	reason: v.optional(v.nullable(v.string())),
	requestRefund: v.optional(v.boolean()),
	issueRefund: v.optional(v.boolean()),
	refund: v.optional(v.boolean()),
	refundAmountCents: v.optional(v.number()),
	amountCents: v.optional(v.number()),
	refundReason: v.optional(v.nullable(v.string())),
});
export const TransferRegistrationBodySchema = v.pipe(
	v.object({
		targetFestivalClassId: v.optional(v.string()),
		targetClassId: v.optional(v.string()),
		destinationFestivalClassId: v.optional(v.string()),
		reason: v.optional(v.nullable(v.string())),
	}),
	v.check(
		(i) =>
			Boolean(
				i.targetFestivalClassId?.trim() ||
					i.targetClassId?.trim() ||
					i.destinationFestivalClassId?.trim(),
			),
		"Target festival class ID is required.",
	),
);
export const PromoteWaitlistBodySchema = v.object({
	reason: v.optional(v.nullable(v.string())),
});
