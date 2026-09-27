import type {
	RepertoireFlagReason,
	RepertoireReviewStatus,
} from "../lib/api.js";

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
		case "in_review":
			return "In Review";
		case "reviewed":
			return "Reviewed";
		case "flagged":
			return "Flagged";
		case "needs_follow_up":
			return "Needs Follow-Up";
		case "approved":
			return "Approved";
		case "approved_for_publication":
			return "Approved (Published)";
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
		case "approved_for_publication":
		case "reviewed":
			return "badge-active";
		case "claimed":
		case "in_review":
			return "badge-processing";
		case "flagged":
		case "needs_follow_up":
			return "badge-rejected";
		case "pending":
			return "badge-review";
		default:
			return "badge-neutral";
	}
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
