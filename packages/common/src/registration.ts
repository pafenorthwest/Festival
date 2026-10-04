import type {
	ClassEntitlement,
	ClassEntitlementStatus,
} from "./entitlements.js";

export interface RepertoirePiece {
	title: string;
	composer: string;
	movement?: string | null;
	/** Positive whole seconds. */
	durationSeconds: number;
	durationMinutes?: number;
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
	createdAt: Date;
}

export interface FestivalClassConfigurationDto {
	id: string;
	organizationId: string;
	festivalId: string;
	displayName: string;
	classSubtypeId: string;
	divisionId: string;
	minimumAge: number;
	maximumAge: number;
	price: string;
	maximumPerformancePieces: 1 | 2 | 3;
	performanceMinutes: number;
	capacity: number;
	isActive: boolean;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateFestivalClassInput {
	displayName: string;
	classSubtypeId: string;
	divisionId: string;
	minimumAge: number;
	maximumAge: number;
	price: string;
	maximumPerformancePieces?: 1 | 2 | 3;
	performanceMinutes: number;
	capacity?: number;
	isActive?: boolean;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
}

export interface UpdateFestivalClassInput {
	displayName?: string;
	minimumAge?: number;
	maximumAge?: number;
	price?: string;
	maximumPerformancePieces?: 1 | 2 | 3;
	performanceMinutes?: number;
	capacity?: number;
	isActive?: boolean;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
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

function asTrimmed(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asObject(payload: unknown): Record<string, unknown> | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	return payload as Record<string, unknown>;
}

function parseOptionalActorRole(
	value: unknown,
	errors: string[],
): RegistrationActorRole | undefined {
	if (value === undefined || value === null) return undefined;
	if (isRegistrationActorRole(value)) return value;
	errors.push(`Invalid actor role: "${String(value)}".`);
	return undefined;
}

function parseOptionalBoundedText(
	value: unknown,
	fieldName: string,
	maxLength: number,
	errors: string[],
): string | null | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length > maxLength) {
			errors.push(`${fieldName} must be ${maxLength} characters or less.`);
		}
		return trimmed.length > 0 ? trimmed : null;
	}
	if (value === null) return null;
	return undefined;
}

function parseInteger(
	value: unknown,
	fieldName: string,
	errors: string[],
	nonNegative = false,
): number | null | undefined {
	if (value === undefined || value === null) return undefined;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		(nonNegative && value < 0)
	) {
		errors.push(
			`${fieldName} must be ${nonNegative ? "a non-negative integer" : "an integer"}.`,
		);
		return undefined;
	}
	return value;
}

function validateRepertoirePiece(
	item: unknown,
	index: number,
	errors: string[],
): RepertoirePiece | null {
	const piece = asObject(item);
	if (!piece) {
		errors.push(`Piece at index ${index} must be an object.`);
		return null;
	}
	const title = asTrimmed(piece.title);
	const composer = asTrimmed(piece.composer);
	const movement = asTrimmed(piece.movement) || null;
	const durationSeconds = piece.durationSeconds;

	if (!title) errors.push(`Piece at index ${index} requires a title.`);
	if (!composer) errors.push(`Piece at index ${index} requires a composer.`);
	if (
		typeof durationSeconds !== "number" ||
		!Number.isInteger(durationSeconds) ||
		durationSeconds <= 0
	) {
		errors.push(
			`Piece at index ${index} durationSeconds must be a positive integer.`,
		);
	}

	if (errors.length > 0) return null;
	return {
		title,
		composer,
		...(movement ? { movement } : {}),
		durationSeconds: durationSeconds as number,
	};
}

function parseOptionalPieces(
	value: unknown,
	errors: string[],
): RepertoirePiece[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) {
		errors.push("Repertoire pieces must be an array.");
		return undefined;
	}
	const pieces: RepertoirePiece[] = [];
	for (let i = 0; i < value.length; i++) {
		const piece = validateRepertoirePiece(value[i], i, errors);
		if (piece) pieces.push(piece);
	}
	return pieces;
}

export function validateDropRegistrationInput(
	payload: unknown,
): RegistrationValidationResult<DropRegistrationInput> {
	const body = asObject(payload);
	if (!body) {
		return {
			valid: false,
			errors: ["Drop registration input must be an object."],
		};
	}
	const errors: string[] = [];

	const classEntitlementId =
		asTrimmed(body.classEntitlementId) || asTrimmed(body.id);
	if (classEntitlementId.length === 0) {
		errors.push("Class entitlement ID is required.");
	}

	const organizationId = asTrimmed(body.organizationId) || undefined;
	const festivalId = asTrimmed(body.festivalId) || undefined;
	const actorUid = asTrimmed(body.actorUid) || undefined;
	const actorRole = parseOptionalActorRole(body.actorRole, errors);
	const reason = parseOptionalBoundedText(body.reason, "Reason", 500, errors);

	const requestRefund =
		body.requestRefund === true || body.issueRefund === true || undefined;
	const refundAmountCents = parseInteger(
		body.refundAmountCents,
		"Refund amount in cents",
		errors,
		true,
	);
	const refundReason = parseOptionalBoundedText(
		body.refundReason,
		"Refund reason",
		500,
		errors,
	);

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: DropRegistrationInput = {
		classEntitlementId,
		...(organizationId ? { organizationId } : {}),
		...(festivalId ? { festivalId } : {}),
		...(actorUid ? { actorUid } : {}),
		...(actorRole ? { actorRole } : {}),
		...(reason !== undefined ? { reason } : {}),
		...(requestRefund !== undefined
			? { requestRefund, issueRefund: requestRefund }
			: {}),
		...(refundAmountCents !== undefined ? { refundAmountCents } : {}),
		...(refundReason !== undefined ? { refundReason } : {}),
	};

	return { valid: true, errors: [], data, request: data };
}

export function validateTransferRegistrationInput(
	payload: unknown,
): RegistrationValidationResult<TransferRegistrationInput> {
	const body = asObject(payload);
	if (!body) {
		return {
			valid: false,
			errors: ["Transfer registration input must be an object."],
		};
	}
	const errors: string[] = [];

	const classEntitlementId =
		asTrimmed(body.classEntitlementId) || asTrimmed(body.id);
	if (classEntitlementId.length === 0) {
		errors.push("Class entitlement ID is required.");
	}

	const targetFestivalClassId =
		asTrimmed(body.targetFestivalClassId) ||
		asTrimmed(body.destinationFestivalClassId) ||
		asTrimmed(body.targetClassId) ||
		asTrimmed(body.toFestivalClassId);
	if (targetFestivalClassId.length === 0) {
		errors.push("Target festival class ID is required.");
	}

	const sourceFestivalClassId =
		asTrimmed(body.sourceFestivalClassId) ||
		asTrimmed(body.fromFestivalClassId) ||
		undefined;

	if (
		sourceFestivalClassId &&
		targetFestivalClassId &&
		sourceFestivalClassId === targetFestivalClassId
	) {
		errors.push(
			"Target festival class must be different from source festival class.",
		);
	}

	const organizationId = asTrimmed(body.organizationId) || undefined;
	const festivalId = asTrimmed(body.festivalId) || undefined;
	const actorUid = asTrimmed(body.actorUid) || undefined;
	const actorRole = parseOptionalActorRole(body.actorRole, errors);
	const reason = parseOptionalBoundedText(body.reason, "Reason", 500, errors);
	const pieces = parseOptionalPieces(body.pieces, errors);
	const priceDifferenceCents = parseInteger(
		body.priceDifferenceCents,
		"Price difference in cents",
		errors,
	);

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: TransferRegistrationInput = {
		classEntitlementId,
		targetFestivalClassId,
		...(sourceFestivalClassId ? { sourceFestivalClassId } : {}),
		...(organizationId ? { organizationId } : {}),
		...(festivalId ? { festivalId } : {}),
		...(actorUid ? { actorUid } : {}),
		...(actorRole ? { actorRole } : {}),
		...(reason !== undefined ? { reason } : {}),
		...(pieces !== undefined ? { pieces } : {}),
		...(priceDifferenceCents !== undefined ? { priceDifferenceCents } : {}),
	};

	return { valid: true, errors: [], data, request: data };
}

export function assertValidDropRegistrationInput(
	payload: unknown,
): DropRegistrationInput {
	const result = validateDropRegistrationInput(payload);
	if (!result.valid || !result.data) {
		throw new Error(result.errors.join("; "));
	}
	return result.data;
}

export function assertValidTransferRegistrationInput(
	payload: unknown,
): TransferRegistrationInput {
	const result = validateTransferRegistrationInput(payload);
	if (!result.valid || !result.data) {
		throw new Error(result.errors.join("; "));
	}
	return result.data;
}
