export const REPERTOIRE_REVIEW_STATUSES = [
	"pending",
	"claimed",
	"in_review",
	"reviewed",
	"flagged",
	"needs_follow_up",
	"approved",
	"approved_for_publication",
] as const;

export type RepertoireReviewStatus =
	(typeof REPERTOIRE_REVIEW_STATUSES)[number];

export function isRepertoireReviewStatus(
	value: unknown,
): value is RepertoireReviewStatus {
	return (
		typeof value === "string" &&
		REPERTOIRE_REVIEW_STATUSES.includes(value as RepertoireReviewStatus)
	);
}

export const REPERTOIRE_FLAG_REASONS = [
	"ambiguous_title",
	"missing_composer",
	"spelling_issue",
	"duplicate_work",
	"uncertain_work_identification",
	"other",
] as const;

export type RepertoireFlagReason = (typeof REPERTOIRE_FLAG_REASONS)[number];

export interface CanonicalContributor {
	id: string;
	organizationId?: string;
	name: string;
	displayName?: string;
	normalizedName?: string;
	imslpUrl?: string | null;
	isActive?: boolean;
	createdAtIso?: string;
	updatedAtIso?: string;
}

export interface CanonicalWork {
	id: string;
	organizationId?: string;
	title: string;
	displayTitle?: string;
	normalizedTitle?: string;
	composerId?: string | null;
	composerName?: string | null;
	imslpUrl?: string | null;
	classifications?: string[];
	isActive?: boolean;
	createdAtIso?: string;
	updatedAtIso?: string;
}

export interface RepertoireReviewItem {
	id: string;
	organizationId: string;
	registrationRepertoireItemId?: string;
	registrationMetadataId?: string;
	registrationId?: string;
	performerName?: string | null;
	classType?: string | null;
	divisionId?: string | null;
	divisionName?: string | null;
	rawTitle: string;
	rawComposer: string;
	rawMovement?: string | null;
	submittedTitle?: string;
	submittedComposer?: string;
	durationSeconds?: number | null;
	normalizedTitle?: string | null;
	normalizedComposer?: string | null;
	imslpUrl?: string | null;
	canonicalWorkId?: string | null;
	canonicalContributorId?: string | null;
	resolvedWorkId?: string | null;
	status: RepertoireReviewStatus;
	claimedByUid?: string | null;
	claimedByName?: string | null;
	claimedAtIso?: string | null;
	assignedReviewerId?: string | null;
	assignedReviewerName?: string | null;
	reviewedBy?: string | null;
	reviewedAtIso?: string | null;
	isFlagged?: boolean;
	flagReason?: string | null;
	flagNotes?: string | null;
	flaggedBy?: string | null;
	flaggedAtIso?: string | null;
	reviewerNotes?: string | null;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface RepertoireReviewQueueFilter {
	organizationId?: string;
	classType?: string;
	divisionId?: string;
	status?: RepertoireReviewStatus | RepertoireReviewStatus[];
	assignedReviewerId?: string | null;
	searchQuery?: string;
	search?: string;
	isFlagged?: boolean;
	page?: number;
	limit?: number;
}

export interface RepertoireReviewQueueSummary {
	total: number;
	pending: number;
	inReview: number;
	reviewed: number;
	flagged: number;
	needsFollowUp?: number;
	approved?: number;
	completed?: number;
	byStatus?: Partial<Record<RepertoireReviewStatus, number>>;
	byReviewer?: Record<string, number>;
}

export interface RepertoireValidationResult<T> {
	valid: boolean;
	errors: string[];
	data?: T;
	request?: T;
}

export interface ClaimReviewInput {
	reviewItemId: string;
	reviewerId: string;
	reviewerName?: string;
	organizationId?: string;
}

export interface NormalizeReviewInput {
	reviewItemId: string;
	normalizedTitle: string;
	normalizedComposer: string;
	imslpUrl?: string | null;
	status?: RepertoireReviewStatus;
	canonicalWorkId?: string | null;
	canonicalContributorId?: string | null;
	notes?: string | null;
	reviewerId?: string;
	organizationId?: string;
}

export interface FlagReviewInput {
	reviewItemId: string;
	reason: string;
	notes?: string | null;
	flaggedBy?: string;
	organizationId?: string;
}

export interface ResolveFlagInput {
	reviewItemId: string;
	flagId?: string;
	resolutionNotes?: string | null;
	status?: RepertoireReviewStatus;
	resolvedBy?: string;
	organizationId?: string;
}

export interface AddCatalogWorkInput {
	title: string;
	composer: string;
	imslpUrl?: string | null;
	organizationId?: string;
}

const HTTP_URL_PATTERN = /^https?:\/\/.+/i;

function asTrimmed(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asObject(payload: unknown): Record<string, unknown> | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	return payload as Record<string, unknown>;
}

function parseImslpUrl(value: unknown, errors: string[]): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	if (!HTTP_URL_PATTERN.test(trimmed)) {
		errors.push("IMSLP URL must be a valid HTTP or HTTPS URL.");
		return null;
	}
	return trimmed;
}

function parseOptionalStatus(
	value: unknown,
	errors: string[],
): RepertoireReviewStatus | undefined {
	if (value === undefined || value === null) return undefined;
	if (isRepertoireReviewStatus(value)) return value;
	errors.push(`Invalid review status: "${String(value)}".`);
	return undefined;
}

export function validateClaimReviewInput(
	payload: unknown,
): RepertoireValidationResult<ClaimReviewInput> {
	const body = asObject(payload);
	if (!body) {
		return { valid: false, errors: ["Claim review input must be an object."] };
	}
	const errors: string[] = [];

	const reviewItemId = asTrimmed(body.reviewItemId) || asTrimmed(body.id);
	if (reviewItemId.length === 0) {
		errors.push("Review item ID is required.");
	}

	const reviewerId =
		asTrimmed(body.reviewerId) ||
		asTrimmed(body.assignedReviewerId) ||
		asTrimmed(body.claimedByUid);
	if (reviewerId.length === 0) {
		errors.push("Reviewer ID is required.");
	}

	const reviewerName =
		asTrimmed(body.reviewerName) || asTrimmed(body.claimedByName) || undefined;
	const organizationId = asTrimmed(body.organizationId) || undefined;

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: ClaimReviewInput = {
		reviewItemId,
		reviewerId,
		...(reviewerName ? { reviewerName } : {}),
		...(organizationId ? { organizationId } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateNormalizeReviewInput(
	payload: unknown,
): RepertoireValidationResult<NormalizeReviewInput> {
	const body = asObject(payload);
	if (!body) {
		return {
			valid: false,
			errors: ["Normalize review input must be an object."],
		};
	}
	const errors: string[] = [];

	const reviewItemId = asTrimmed(body.reviewItemId) || asTrimmed(body.id);
	if (reviewItemId.length === 0) {
		errors.push("Review item ID is required.");
	}

	const normalizedTitle =
		asTrimmed(body.normalizedTitle) || asTrimmed(body.title);
	if (normalizedTitle.length === 0) {
		errors.push("Normalized title is required.");
	} else if (normalizedTitle.length > 300) {
		errors.push("Normalized title must be 300 characters or less.");
	}

	const normalizedComposer =
		asTrimmed(body.normalizedComposer) || asTrimmed(body.composer);
	if (normalizedComposer.length === 0) {
		errors.push("Normalized composer is required.");
	} else if (normalizedComposer.length > 200) {
		errors.push("Normalized composer must be 200 characters or less.");
	}

	const imslpUrl = parseImslpUrl(body.imslpUrl, errors);
	const status = parseOptionalStatus(body.status, errors);

	const canonicalWorkId =
		asTrimmed(body.canonicalWorkId) || asTrimmed(body.resolvedWorkId) || null;
	const canonicalContributorId = asTrimmed(body.canonicalContributorId) || null;
	const notes = asTrimmed(body.notes) || asTrimmed(body.reviewerNotes) || null;
	const reviewerId = asTrimmed(body.reviewerId) || undefined;
	const organizationId = asTrimmed(body.organizationId) || undefined;

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: NormalizeReviewInput = {
		reviewItemId,
		normalizedTitle,
		normalizedComposer,
		imslpUrl,
		...(status ? { status } : {}),
		canonicalWorkId,
		canonicalContributorId,
		notes,
		...(reviewerId ? { reviewerId } : {}),
		...(organizationId ? { organizationId } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateFlagReviewInput(
	payload: unknown,
): RepertoireValidationResult<FlagReviewInput> {
	const body = asObject(payload);
	if (!body) {
		return { valid: false, errors: ["Flag review input must be an object."] };
	}
	const errors: string[] = [];

	const reviewItemId = asTrimmed(body.reviewItemId) || asTrimmed(body.id);
	if (reviewItemId.length === 0) {
		errors.push("Review item ID is required.");
	}

	const reason = asTrimmed(body.reason) || asTrimmed(body.flagReason);
	if (reason.length === 0) {
		errors.push("Flag reason is required.");
	} else if (reason.length > 200) {
		errors.push("Flag reason must be 200 characters or less.");
	}

	const notesRaw = asTrimmed(body.notes) || asTrimmed(body.flagNotes);
	if (notesRaw.length > 2000) {
		errors.push("Notes must be 2000 characters or less.");
	}
	const notes = notesRaw.length > 0 ? notesRaw : null;

	const flaggedBy = asTrimmed(body.flaggedBy) || undefined;
	const organizationId = asTrimmed(body.organizationId) || undefined;

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: FlagReviewInput = {
		reviewItemId,
		reason,
		notes,
		...(flaggedBy ? { flaggedBy } : {}),
		...(organizationId ? { organizationId } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateResolveFlagInput(
	payload: unknown,
): RepertoireValidationResult<ResolveFlagInput> {
	const body = asObject(payload);
	if (!body) {
		return {
			valid: false,
			errors: ["Resolve flag input must be an object."],
		};
	}
	const errors: string[] = [];

	const reviewItemId = asTrimmed(body.reviewItemId) || asTrimmed(body.id);
	const flagId = asTrimmed(body.flagId) || undefined;

	if (reviewItemId.length === 0 && !flagId) {
		errors.push("Review item ID is required.");
	}

	const notesRaw =
		asTrimmed(body.resolutionNotes) ||
		asTrimmed(body.notes) ||
		asTrimmed(body.reviewerNotes);
	if (notesRaw.length > 2000) {
		errors.push("Resolution notes must be 2000 characters or less.");
	}
	const resolutionNotes = notesRaw.length > 0 ? notesRaw : null;
	const status = parseOptionalStatus(body.status, errors);

	const resolvedBy = asTrimmed(body.resolvedBy) || undefined;
	const organizationId = asTrimmed(body.organizationId) || undefined;

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: ResolveFlagInput = {
		reviewItemId: reviewItemId.length > 0 ? reviewItemId : (flagId as string),
		...(flagId ? { flagId } : {}),
		resolutionNotes,
		...(status ? { status } : {}),
		...(resolvedBy ? { resolvedBy } : {}),
		...(organizationId ? { organizationId } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}

export function validateAddCatalogWorkInput(
	payload: unknown,
): RepertoireValidationResult<AddCatalogWorkInput> {
	const body = asObject(payload);
	if (!body) {
		return {
			valid: false,
			errors: ["Add catalog work input must be an object."],
		};
	}
	const errors: string[] = [];

	const title = asTrimmed(body.title);
	if (title.length === 0) {
		errors.push("Title is required.");
	} else if (title.length > 300) {
		errors.push("Title must be 300 characters or less.");
	}

	const composer = asTrimmed(body.composer) || asTrimmed(body.composerName);
	if (composer.length === 0) {
		errors.push("Composer is required.");
	} else if (composer.length > 200) {
		errors.push("Composer must be 200 characters or less.");
	}

	const imslpUrl = parseImslpUrl(body.imslpUrl, errors);
	const organizationId = asTrimmed(body.organizationId) || undefined;

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const data: AddCatalogWorkInput = {
		title,
		composer,
		imslpUrl,
		...(organizationId ? { organizationId } : {}),
	};
	return { valid: true, errors: [], data, request: data };
}

export function calculateRepertoireReviewQueueSummary(
	items: readonly RepertoireReviewItem[],
): RepertoireReviewQueueSummary {
	let pending = 0;
	let inReview = 0;
	let reviewed = 0;
	let flagged = 0;
	let needsFollowUp = 0;
	let approved = 0;

	for (const item of items) {
		if (item.isFlagged || item.status === "flagged") {
			flagged++;
		}
		switch (item.status) {
			case "pending":
				pending++;
				break;
			case "claimed":
			case "in_review":
				inReview++;
				break;
			case "reviewed":
				reviewed++;
				break;
			case "needs_follow_up":
				needsFollowUp++;
				break;
			case "approved":
			case "approved_for_publication":
				approved++;
				break;
		}
	}

	return {
		total: items.length,
		pending,
		inReview,
		reviewed,
		flagged,
		needsFollowUp,
		approved,
		completed: reviewed + approved,
	};
}
