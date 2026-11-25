import type {
	RepertoireFlagReason,
	RepertoireReviewItem,
	RepertoireReviewQueueSummary,
	RepertoireReviewStatus,
} from "../lib/api.js";

export type QueueStatusFilter = "all" | RepertoireReviewStatus;

export interface ReviewQueueFilterOptions {
	statusFilter: QueueStatusFilter;
	myClaimsOnly?: boolean;
	currentUserId?: string | null;
	flaggedOnly?: boolean;
	searchQuery?: string;
}

export function formatDuration(seconds?: number | null): string {
	if (seconds === undefined || seconds === null || seconds < 0) {
		return "—";
	}
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatStatus(status: RepertoireReviewStatus): string {
	switch (status) {
		case "pending":
			return "Pending";
		case "claimed":
			return "Claimed";
		case "flagged":
			return "Flagged";
		case "approved":
			return "Approved";
		default:
			return status;
	}
}

export function formatFlagReason(reason?: string | null): string {
	switch (reason) {
		case "ambiguous_title":
			return "Ambiguous Title";
		case "missing_composer":
			return "Missing Composer";
		case "spelling_issue":
			return "Spelling Issue";
		case "duplicate_work":
			return "Duplicate Work";
		case "uncertain_work_identification":
			return "Uncertain Work Identification";
		case "other":
			return "Other";
		default:
			return reason ?? "Flagged";
	}
}

export function statusBadgeClass(status: RepertoireReviewStatus): string {
	switch (status) {
		case "approved":
			return "badge-active";
		case "claimed":
			return "badge-processing";
		case "flagged":
			return "badge-rejected";
		case "pending":
			return "badge-review";
		default:
			return "badge-neutral";
	}
}

function matchesSearchQuery(
	item: RepertoireReviewItem,
	query: string,
): boolean {
	const title = (item.rawTitle || item.submittedTitle || "").toLowerCase();
	const composer = (
		item.rawComposer ||
		item.submittedComposer ||
		""
	).toLowerCase();
	const movement = (item.rawMovement || "").toLowerCase();
	return (
		title.includes(query) ||
		composer.includes(query) ||
		movement.includes(query)
	);
}

export function filterReviewQueueItems(
	items: readonly RepertoireReviewItem[],
	options: ReviewQueueFilterOptions,
): RepertoireReviewItem[] {
	let list =
		options.statusFilter === "all"
			? [...items]
			: items.filter((i) => i.status === options.statusFilter);
	if (options.myClaimsOnly) {
		list = list.filter(
			(i) => i.claimedByUid === (options.currentUserId ?? null),
		);
	}
	if (options.flaggedOnly) {
		list = list.filter((i) => i.isFlagged || i.status === "flagged");
	}
	const query = (options.searchQuery ?? "").trim().toLowerCase();
	return query ? list.filter((i) => matchesSearchQuery(i, query)) : list;
}

export function summarizeReviewQueueItems(
	items: readonly RepertoireReviewItem[],
): RepertoireReviewQueueSummary {
	let pending = 0;
	let inReview = 0;
	let flagged = 0;
	let approved = 0;

	for (const item of items) {
		if (item.isFlagged || item.status === "flagged") {
			flagged++;
		}
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
		approved,
	};
}

export const FLAG_REASON_OPTIONS: {
	value: RepertoireFlagReason;
	label: string;
}[] = [
	{ value: "ambiguous_title", label: "Ambiguous Title" },
	{ value: "missing_composer", label: "Missing Composer" },
	{ value: "spelling_issue", label: "Spelling Issue" },
	{ value: "duplicate_work", label: "Duplicate Work" },
	{
		value: "uncertain_work_identification",
		label: "Uncertain Work Identification",
	},
	{ value: "other", label: "Other" },
];
