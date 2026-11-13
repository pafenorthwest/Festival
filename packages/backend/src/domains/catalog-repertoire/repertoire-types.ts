import type {
	CanonicalWork,
	RepertoireFlagReason,
	RepertoireReviewItem,
	RepertoireReviewQueueSummary,
	RepertoireReviewStatus,
} from "@festival/common";

export interface ReviewQueueFilter {
	status?: RepertoireReviewStatus | RepertoireReviewStatus[];
	claimedByUid?: string | null;
	flaggedOnly?: boolean;
	search?: string;
	limit?: number;
	offset?: number;
}

export interface RepertoireReviewQueueResult {
	items: RepertoireReviewItem[];
	summary: RepertoireReviewQueueSummary;
}

export interface ClaimReviewItemInput {
	organizationId: string;
	reviewItemId: string;
	claimedByUid: string;
	claimedByName?: string | null;
}

export type ClaimReviewOutcome =
	| { kind: "claimed"; item: RepertoireReviewItem }
	| {
			kind: "conflict";
			message: string;
			currentStatus: RepertoireReviewStatus;
			currentClaimantUid?: string | null;
			currentClaimantName?: string | null;
			item?: RepertoireReviewItem;
	  }
	| { kind: "not_found"; message: string };

export interface UnclaimReviewItemInput {
	organizationId: string;
	reviewItemId: string;
	claimedByUid?: string;
}

export interface NormalizeAndApproveInput {
	organizationId: string;
	reviewItemId: string;
	normalizedTitle: string;
	normalizedComposer: string;
	imslpUrl?: string | null;
	notes?: string | null;
	reviewerId?: string;
}

export interface FlagReviewItemInput {
	organizationId: string;
	reviewItemId: string;
	reason: RepertoireFlagReason | string;
	notes?: string | null;
	flaggedByUid?: string;
}

export interface ResolveFlagInput {
	organizationId: string;
	reviewItemId: string;
	resolutionNotes?: string | null;
	status?: RepertoireReviewStatus;
	resolvedByUid?: string;
}

export interface SearchCatalogWorksInput {
	organizationId: string;
	query: string;
	concertoOnly?: boolean;
	limit?: number;
}

export interface AddCatalogWorkInput {
	organizationId: string;
	title: string;
	composerName?: string;
	composer?: string;
	imslpUrl?: string | null;
	classifications?: string[];
}

export interface RawRepertoireSnapshot {
	id?: string;
	organizationId: string;
	registrationMetadataId?: string;
	registrationId?: string;
	title: string;
	composer: string;
	movement?: string | null;
	durationSeconds?: number;
	repertoireWorkId?: string | null;
}

export interface RepertoireCatalogRepository {
	searchCatalogWorks(input: SearchCatalogWorksInput): Promise<CanonicalWork[]>;
	getCatalogWorkById(
		organizationId: string,
		workId: string,
	): Promise<CanonicalWork | null>;
	addCatalogWork(input: AddCatalogWorkInput): Promise<CanonicalWork>;
}

export interface RepertoireSubmissionRepository {
	syncReviewQueue(organizationId: string): Promise<{ syncedCount: number }>;
	listReviewQueue(
		organizationId: string,
		filter?: ReviewQueueFilter,
	): Promise<RepertoireReviewQueueResult>;
	claimReviewItem(input: ClaimReviewItemInput): Promise<ClaimReviewOutcome>;
	unclaimReviewItem(
		input: UnclaimReviewItemInput,
	): Promise<RepertoireReviewItem | null>;
	normalizeAndApprove(
		input: NormalizeAndApproveInput,
	): Promise<RepertoireReviewItem>;
	flagReviewItem(input: FlagReviewItemInput): Promise<RepertoireReviewItem>;
	resolveFlag(input: ResolveFlagInput): Promise<RepertoireReviewItem>;
}

export interface RepertoireRepository
	extends RepertoireCatalogRepository,
		RepertoireSubmissionRepository {}

export function mapCanonicalWorkRow(
	row: Record<string, unknown>,
): CanonicalWork {
	const displayTitle = String(row.display_title);
	const rawClassifications = Array.isArray(row.classifications)
		? row.classifications
				.map((item) => String(item))
				.filter((item) => item.length > 0)
		: [];
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		title: displayTitle,
		displayTitle,
		normalizedTitle: String(row.normalized_title),
		composerId: row.composer_id ? String(row.composer_id) : null,
		composerName: row.composer_name ? String(row.composer_name) : null,
		imslpUrl: (row.imslp_url as string) || null,
		classifications: rawClassifications,
		isActive: Boolean(row.is_active ?? true),
		createdAtIso: toIsoValue(row.created_at),
		updatedAtIso: toIsoValue(row.updated_at),
	};
}

export function mapReviewItemRow(
	row: Record<string, unknown>,
): RepertoireReviewItem {
	const isFlagged = row.status === "flagged" || Boolean(row.flag_reason);
	const rawTitle = String(row.raw_title || "");
	const rawComposer = String(row.raw_composer || "");
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		registrationRepertoireItemId: String(row.registration_repertoire_item_id),
		registrationMetadataId: row.registration_metadata_id
			? String(row.registration_metadata_id)
			: undefined,
		registrationId: row.registration_metadata_id
			? String(row.registration_metadata_id)
			: undefined,
		rawTitle,
		rawComposer,
		rawMovement: (row.raw_movement as string) || null,
		submittedTitle: rawTitle,
		submittedComposer: rawComposer,
		durationSeconds:
			row.duration_seconds !== null && row.duration_seconds !== undefined
				? Number(row.duration_seconds)
				: null,
		normalizedTitle: (row.normalized_title as string) || null,
		normalizedComposer: (row.normalized_composer as string) || null,
		imslpUrl: (row.imslp_url as string) || null,
		canonicalWorkId: (row.resolved_work_id as string) || null,
		canonicalContributorId: (row.canonical_contributor_id as string) || null,
		resolvedWorkId: (row.resolved_work_id as string) || null,
		status: row.status as RepertoireReviewStatus,
		claimedByUid: (row.claimed_by_uid as string) || null,
		claimedByName: (row.claimed_by_name as string) || null,
		claimedAtIso: toOptionalIsoValue(row.claimed_at),
		assignedReviewerId: (row.claimed_by_uid as string) || null,
		assignedReviewerName: (row.claimed_by_name as string) || null,
		reviewedAtIso: toOptionalIsoValue(row.reviewed_at),
		isFlagged,
		flagReason: (row.flag_reason as string) || null,
		flagNotes: (row.flag_notes as string) || null,
		flaggedAtIso: isFlagged ? toOptionalIsoValue(row.updated_at) : null,
		reviewerNotes: (row.reviewer_notes as string) || null,
		createdAtIso: toIsoValue(row.created_at),
		updatedAtIso: toIsoValue(row.updated_at),
	};
}

export function normalizeClassifications(classifications?: string[]): string[] {
	if (!classifications) return [];
	const unique = new Map<string, string>();
	for (const entry of classifications) {
		const trimmed = entry.trim();
		if (trimmed.length === 0) continue;
		const key = trimmed.toLowerCase();
		if (!unique.has(key)) unique.set(key, trimmed);
	}
	return [...unique.values()];
}

function toIsoValue(value: unknown): string {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string" && value.length > 0) return value;
	return new Date().toISOString();
}

function toOptionalIsoValue(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string" && value.length > 0) return value;
	return null;
}
