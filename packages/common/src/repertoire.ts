export const MAX_CATALOG_WORK_TITLE_LENGTH = 300;

export function getRepertoireTitleLimit(catalogWorkId?: string | null): number {
	return catalogWorkId?.trim() ? MAX_CATALOG_WORK_TITLE_LENGTH : 200;
}

export const REPERTOIRE_REVIEW_STATUSES = [
	"pending",
	"claimed",
	"flagged",
	"approved",
] as const;

export type RepertoireReviewStatus =
	(typeof REPERTOIRE_REVIEW_STATUSES)[number];

export const REPERTOIRE_RESOLVE_FLAG_TARGET_STATUSES = [
	"pending",
	"claimed",
	"approved",
] as const;

export type RepertoireResolveFlagTargetStatus =
	(typeof REPERTOIRE_RESOLVE_FLAG_TARGET_STATUSES)[number];

export function isRepertoireReviewStatus(
	value: unknown,
): value is RepertoireReviewStatus {
	return (
		typeof value === "string" &&
		REPERTOIRE_REVIEW_STATUSES.includes(value as RepertoireReviewStatus)
	);
}

export function isRepertoireResolveFlagTargetStatus(
	value: unknown,
): value is RepertoireResolveFlagTargetStatus {
	return (
		typeof value === "string" &&
		REPERTOIRE_RESOLVE_FLAG_TARGET_STATUSES.includes(
			value as RepertoireResolveFlagTargetStatus,
		)
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

export type RepertoireCatalogWork = CanonicalWork;

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
	status?: "approved";
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
	status?: RepertoireResolveFlagTargetStatus;
	resolvedBy?: string;
	organizationId?: string;
}

export interface AddCatalogWorkInput {
	title: string;
	composer: string;
	imslpUrl?: string | null;
	classifications?: string[];
	organizationId?: string;
}

export interface ClassConcertoSubtypeInfo {
	displayName?: string | null;
	normalizedName?: string | null;
}

export interface ClassConcertoCheckInput {
	requiresConcerto?: boolean;
	classSubtypeName?: string | null;
	displayName?: string | null;
	subtype?: ClassConcertoSubtypeInfo | null;
}

export function isConcertoWorkClassification(classification: string): boolean {
	return classification.trim().toLowerCase() === "concerto";
}

export function isCatalogWorkClassifiedAsConcerto(
	work: Pick<CanonicalWork, "classifications" | "isActive"> | null | undefined,
): boolean {
	return Boolean(
		work &&
			work.isActive !== false &&
			Array.isArray(work.classifications) &&
			work.classifications.some(isConcertoWorkClassification),
	);
}

export function doesClassRequireConcerto(
	classInfo: ClassConcertoCheckInput | null | undefined,
	subtype?: ClassConcertoSubtypeInfo | null,
): boolean {
	if (!classInfo) return false;
	if (typeof classInfo.requiresConcerto === "boolean") {
		return classInfo.requiresConcerto;
	}
	const resolvedSubtype = subtype !== undefined ? subtype : classInfo.subtype;
	if (resolvedSubtype !== undefined) {
		return (
			resolvedSubtype?.normalizedName?.trim().toLowerCase() === "concerto" ||
			resolvedSubtype?.displayName?.trim().toLowerCase() === "concerto"
		);
	}
	if (classInfo.classSubtypeName != null) {
		return classInfo.classSubtypeName.trim().toLowerCase() === "concerto";
	}
	return /\bconcerto\b/i.test(classInfo.displayName ?? "");
}

const HTTP_URL_PATTERN = /^https?:\/\/.+/i;
const asTrimmed = (v: unknown): string =>
	typeof v === "string" ? v.trim() : "";
const asObject = (p: unknown): Record<string, unknown> | null =>
	p && typeof p === "object" && !Array.isArray(p)
		? (p as Record<string, unknown>)
		: null;

function parseImslpUrl(value: unknown, errors: string[]): string | null {
	const trimmed = asTrimmed(value);
	if (!trimmed) return null;
	if (!HTTP_URL_PATTERN.test(trimmed)) {
		errors.push("IMSLP URL must be a valid HTTP or HTTPS URL.");
		return null;
	}
	return trimmed;
}

function checkBounded(
	v: string,
	spec: [string, number],
	errors: string[],
): string {
	if (!v) errors.push(`${spec[0]} is required.`);
	else if (v.length > spec[1]) {
		errors.push(`${spec[0]} must be ${spec[1]} characters or less.`);
	}
	return v;
}

const okResult = <T>(data: T): RepertoireValidationResult<T> => ({
	valid: true,
	errors: [],
	data,
	request: data,
});
const errResult = <T>(message: string): RepertoireValidationResult<T> => ({
	valid: false,
	errors: [message],
});
const orgField = (b: Record<string, unknown>) => {
	const organizationId = asTrimmed(b.organizationId);
	return organizationId ? { organizationId } : {};
};
const optNotes = (raw: string, label: string, errors: string[]) => {
	if (raw.length > 2000)
		errors.push(`${label} must be 2000 characters or less.`);
	return raw || null;
};
const reqId = (b: Record<string, unknown>, errors: string[]) => {
	const id = asTrimmed(b.reviewItemId) || asTrimmed(b.id);
	if (!id) errors.push("Review item ID is required.");
	return id;
};

export function validateClaimReviewInput(
	payload: unknown,
): RepertoireValidationResult<ClaimReviewInput> {
	const body = asObject(payload);
	if (!body) return errResult("Claim review input must be an object.");
	const errors: string[] = [];
	const reviewItemId = reqId(body, errors);
	const reviewerId =
		asTrimmed(body.reviewerId) ||
		asTrimmed(body.assignedReviewerId) ||
		asTrimmed(body.claimedByUid);
	if (!reviewerId) errors.push("Reviewer ID is required.");
	if (errors.length > 0) return { valid: false, errors };
	const reviewerName =
		asTrimmed(body.reviewerName) || asTrimmed(body.claimedByName);
	return okResult({
		reviewItemId,
		reviewerId,
		...(reviewerName ? { reviewerName } : {}),
		...orgField(body),
	});
}

export function validateNormalizeReviewInput(
	payload: unknown,
): RepertoireValidationResult<NormalizeReviewInput> {
	const body = asObject(payload);
	if (!body) return errResult("Normalize review input must be an object.");
	const errors: string[] = [];
	const reviewItemId = reqId(body, errors);
	const t = asTrimmed(body.normalizedTitle) || asTrimmed(body.title);
	const c = asTrimmed(body.normalizedComposer) || asTrimmed(body.composer);
	const normalizedTitle = checkBounded(t, ["Normalized title", 300], errors);
	const normalizedComposer = checkBounded(
		c,
		["Normalized composer", 200],
		errors,
	);
	const imslpUrl = parseImslpUrl(body.imslpUrl, errors);
	if (body.status != null && body.status !== "approved") {
		errors.push(`Invalid review status: "${String(body.status)}".`);
	}
	if (errors.length > 0) return { valid: false, errors };
	const reviewerId = asTrimmed(body.reviewerId);
	return okResult({
		reviewItemId,
		normalizedTitle,
		normalizedComposer,
		imslpUrl,
		...(body.status === "approved" ? { status: "approved" } : {}),
		canonicalWorkId:
			asTrimmed(body.canonicalWorkId) || asTrimmed(body.resolvedWorkId) || null,
		canonicalContributorId: asTrimmed(body.canonicalContributorId) || null,
		notes: asTrimmed(body.notes) || asTrimmed(body.reviewerNotes) || null,
		...(reviewerId ? { reviewerId } : {}),
		...orgField(body),
	});
}

export function validateFlagReviewInput(
	payload: unknown,
): RepertoireValidationResult<FlagReviewInput> {
	const body = asObject(payload);
	if (!body) return errResult("Flag review input must be an object.");
	const errors: string[] = [];
	const reviewItemId = reqId(body, errors);
	const rawReason = asTrimmed(body.reason) || asTrimmed(body.flagReason);
	const reason = checkBounded(rawReason, ["Flag reason", 200], errors);
	const rawNotes = asTrimmed(body.notes) || asTrimmed(body.flagNotes);
	const notes = optNotes(rawNotes, "Notes", errors);
	if (errors.length > 0) return { valid: false, errors };
	const flaggedBy = asTrimmed(body.flaggedBy);
	return okResult({
		reviewItemId,
		reason,
		notes,
		...(flaggedBy ? { flaggedBy } : {}),
		...orgField(body),
	});
}

export function validateResolveFlagInput(
	payload: unknown,
): RepertoireValidationResult<ResolveFlagInput> {
	const body = asObject(payload);
	if (!body) return errResult("Resolve flag input must be an object.");
	const errors: string[] = [];
	const reviewItemId = asTrimmed(body.reviewItemId) || asTrimmed(body.id);
	const flagId = asTrimmed(body.flagId);
	if (!reviewItemId && !flagId) errors.push("Review item ID is required.");
	const rawNotes =
		asTrimmed(body.resolutionNotes) ||
		asTrimmed(body.notes) ||
		asTrimmed(body.reviewerNotes);
	const resolutionNotes = optNotes(rawNotes, "Resolution notes", errors);
	let status: RepertoireResolveFlagTargetStatus = "pending";
	if (body.status != null) {
		if (isRepertoireResolveFlagTargetStatus(body.status)) status = body.status;
		else errors.push(`Invalid review status: "${String(body.status)}".`);
	}
	if (errors.length > 0) return { valid: false, errors };
	const resolvedBy = asTrimmed(body.resolvedBy);
	return okResult({
		reviewItemId: reviewItemId || flagId,
		...(flagId ? { flagId } : {}),
		resolutionNotes,
		status,
		...(resolvedBy ? { resolvedBy } : {}),
		...orgField(body),
	});
}

export function validateAddCatalogWorkInput(
	payload: unknown,
): RepertoireValidationResult<AddCatalogWorkInput> {
	const body = asObject(payload);
	if (!body) return errResult("Add catalog work input must be an object.");
	const errors: string[] = [];
	const titleSpec: [string, number] = ["Title", MAX_CATALOG_WORK_TITLE_LENGTH];
	const title = checkBounded(asTrimmed(body.title), titleSpec, errors);
	const rawComp = asTrimmed(body.composer) || asTrimmed(body.composerName);
	const composer = checkBounded(rawComp, ["Composer", 200], errors);
	const imslpUrl = parseImslpUrl(body.imslpUrl, errors);
	let classifications: string[] | undefined;
	if (body.classifications != null) {
		const list = body.classifications;
		if (
			!Array.isArray(list) ||
			!list.every((c) => typeof c === "string" && c.trim().length > 0)
		) {
			errors.push("Classifications must be an array of non-empty strings.");
		} else {
			classifications = [
				...new Set(list.map((c) => c.trim().toLowerCase()).filter(Boolean)),
			];
		}
	}
	if (errors.length > 0) return { valid: false, errors };
	return okResult({
		title,
		composer,
		imslpUrl,
		...(classifications !== undefined ? { classifications } : {}),
		...orgField(body),
	});
}

export function calculateRepertoireReviewQueueSummary(
	items: readonly RepertoireReviewItem[],
): RepertoireReviewQueueSummary {
	let pending = 0;
	let inReview = 0;
	let flagged = 0;
	let approved = 0;
	for (const item of items) {
		if (item.isFlagged || item.status === "flagged") flagged++;
		if (item.status === "pending") pending++;
		else if (item.status === "claimed") inReview++;
		else if (item.status === "approved") approved++;
	}
	return {
		total: items.length,
		pending,
		inReview,
		reviewed: 0,
		flagged,
		needsFollowUp: 0,
		approved,
		completed: approved,
	};
}
