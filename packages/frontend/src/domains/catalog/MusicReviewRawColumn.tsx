import { Show } from "solid-js";
import type { RepertoireReviewItem } from "../../lib/api.js";
import {
	formatDuration,
	formatFlagReason,
	formatStatus,
	statusBadgeClass,
} from "../../pages/musicReviewHelpers.js";

export interface MusicReviewRawColumnProps {
	item: RepertoireReviewItem | null | undefined;
	isClaimedByMe: boolean;
}

export function MusicReviewRawColumn(props: MusicReviewRawColumnProps) {
	return (
		<div class="music-review-raw-column">
			<h4>Submitted Snapshot</h4>
			<div class="music-review-raw-card">
				<div class="raw-field">
					<span class="raw-label">Title</span>
					<strong class="raw-value">
						{props.item?.rawTitle || props.item?.submittedTitle || "—"}
					</strong>
				</div>
				<div class="raw-field">
					<span class="raw-label">Composer</span>
					<span class="raw-value">
						{props.item?.rawComposer || props.item?.submittedComposer || "—"}
					</span>
				</div>
				<div class="raw-field">
					<span class="raw-label">Movement</span>
					<span class="raw-value">{props.item?.rawMovement || "—"}</span>
				</div>
				<div class="raw-field">
					<span class="raw-label">Duration</span>
					<span class="raw-value">
						{formatDuration(props.item?.durationSeconds)}
					</span>
				</div>
				<Show when={props.item?.performerName}>
					<div class="raw-field">
						<span class="raw-label">Performer</span>
						<span class="raw-value">{props.item?.performerName}</span>
					</div>
				</Show>
				<Show when={props.item?.divisionName || props.item?.classType}>
					<div class="raw-field">
						<span class="raw-label">Division / Class</span>
						<span class="raw-value">
							{[props.item?.divisionName, props.item?.classType]
								.filter(Boolean)
								.join(" · ")}
						</span>
					</div>
				</Show>
				<div class="raw-field">
					<span class="raw-label">Status</span>
					<div class="raw-status-row">
						<span
							class={`badge ${statusBadgeClass(props.item?.status ?? "pending")}`}
						>
							{formatStatus(props.item?.status ?? "pending")}
						</span>
						<span class="claimed-label">
							{props.isClaimedByMe
								? "Claimed by you"
								: props.item?.claimedByName
									? `Claimed by ${props.item.claimedByName}`
									: props.item?.claimedByUid
										? "Claimed"
										: "Unclaimed"}
						</span>
					</div>
				</div>

				<Show when={props.item?.isFlagged || props.item?.status === "flagged"}>
					<div class="music-review-flag-card" role="alert">
						<strong>Flagged: {formatFlagReason(props.item?.flagReason)}</strong>
						<Show when={props.item?.flagNotes}>
							<p>{props.item?.flagNotes}</p>
						</Show>
						<Show when={props.item?.flaggedBy}>
							<span class="muted text-small">
								By reviewer: {props.item?.flaggedBy}
							</span>
						</Show>
					</div>
				</Show>
			</div>
		</div>
	);
}
