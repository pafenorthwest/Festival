import type {
	DropRegistrationInput,
	RegistrationValidationResult,
	RepertoirePiece,
	TransferRegistrationInput,
} from "./registration.js";
import {
	isRegistrationActorRole,
	type RegistrationActorRole,
} from "./registration.js";

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

interface BoundedTextParseOptions {
	value: unknown;
	fieldName: string;
	maxLength: number;
	errors: string[];
}

function parseOptionalBoundedText({
	value,
	fieldName,
	maxLength,
	errors,
}: BoundedTextParseOptions): string | null | undefined {
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

interface IntegerParseOptions {
	value: unknown;
	fieldName: string;
	errors: string[];
	nonNegative?: boolean;
}

function parseInteger({
	value,
	fieldName,
	errors,
	nonNegative = false,
}: IntegerParseOptions): number | null | undefined {
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

export function validateRepertoirePiece(
	item: unknown,
	index = 0,
	errors: string[] = [],
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
	let catalogWorkId: string | undefined;

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
	if (piece.catalogWorkId !== undefined && piece.catalogWorkId !== null) {
		if (
			typeof piece.catalogWorkId !== "string" ||
			piece.catalogWorkId.trim().length === 0
		) {
			errors.push("Each repertoire piece must have a valid catalog work ID.");
		} else {
			catalogWorkId = piece.catalogWorkId.trim();
		}
	}

	if (errors.length > 0) return null;
	return {
		title,
		composer,
		...(movement ? { movement } : {}),
		durationSeconds: durationSeconds as number,
		...(catalogWorkId ? { catalogWorkId } : {}),
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

function parseCommonActorFields(
	body: Record<string, unknown>,
	errors: string[],
) {
	const organizationId = asTrimmed(body.organizationId) || undefined;
	const festivalId = asTrimmed(body.festivalId) || undefined;
	const actorUid = asTrimmed(body.actorUid) || undefined;
	const actorRole = parseOptionalActorRole(body.actorRole, errors);
	const reason = parseOptionalBoundedText({
		value: body.reason,
		fieldName: "Reason",
		maxLength: 500,
		errors,
	});
	return { organizationId, festivalId, actorUid, actorRole, reason };
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
	const common = parseCommonActorFields(body, errors);
	const requestRefund =
		body.requestRefund === true || body.issueRefund === true || undefined;
	const refundAmountCents = parseInteger({
		value: body.refundAmountCents,
		fieldName: "Refund amount in cents",
		errors,
		nonNegative: true,
	});
	const refundReason = parseOptionalBoundedText({
		value: body.refundReason,
		fieldName: "Refund reason",
		maxLength: 500,
		errors,
	});
	if (errors.length > 0) return { valid: false, errors };
	const data: DropRegistrationInput = {
		classEntitlementId,
		...(common.organizationId ? { organizationId: common.organizationId } : {}),
		...(common.festivalId ? { festivalId: common.festivalId } : {}),
		...(common.actorUid ? { actorUid: common.actorUid } : {}),
		...(common.actorRole ? { actorRole: common.actorRole } : {}),
		...(common.reason !== undefined ? { reason: common.reason } : {}),
		...(requestRefund !== undefined
			? { requestRefund, issueRefund: requestRefund }
			: {}),
		...(refundAmountCents !== undefined ? { refundAmountCents } : {}),
		...(refundReason !== undefined ? { refundReason } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}

function readTargetFestivalClassId(body: Record<string, unknown>): string {
	return (
		asTrimmed(body.targetFestivalClassId) ||
		asTrimmed(body.destinationFestivalClassId) ||
		asTrimmed(body.targetClassId) ||
		asTrimmed(body.toFestivalClassId)
	);
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
	const targetFestivalClassId = readTargetFestivalClassId(body);
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
	const common = parseCommonActorFields(body, errors);
	const pieces = parseOptionalPieces(body.pieces, errors);
	const priceDifferenceCents = parseInteger({
		value: body.priceDifferenceCents,
		fieldName: "Price difference in cents",
		errors,
	});
	if (errors.length > 0) return { valid: false, errors };
	const data: TransferRegistrationInput = {
		classEntitlementId,
		targetFestivalClassId,
		...(sourceFestivalClassId ? { sourceFestivalClassId } : {}),
		...(common.organizationId ? { organizationId: common.organizationId } : {}),
		...(common.festivalId ? { festivalId: common.festivalId } : {}),
		...(common.actorUid ? { actorUid: common.actorUid } : {}),
		...(common.actorRole ? { actorRole: common.actorRole } : {}),
		...(common.reason !== undefined ? { reason: common.reason } : {}),
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
