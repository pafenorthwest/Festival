import { For, Show } from "solid-js";
import { Button } from "../../components/Button.js";
import type { RepertoireFlagReason } from "../../lib/api.js";
import { FLAG_REASON_OPTIONS } from "../../pages/musicReviewHelpers.js";

export interface MusicReviewFlagPanelsProps {
	isFlagging: boolean;
	flagReason: RepertoireFlagReason;
	onFlagReasonChange: (reason: RepertoireFlagReason) => void;
	flagNotes: string;
	onFlagNotesInput: (notes: string) => void;
	onCancelFlag: () => void;
	onConfirmFlag: () => void;
	isResolving: boolean;
	resolutionNotes: string;
	onResolutionNotesInput: (notes: string) => void;
	onCancelResolve: () => void;
	onConfirmResolve: () => void;
	actionPending: boolean;
}

export function MusicReviewFlagPanels(props: MusicReviewFlagPanelsProps) {
	return (
		<>
			<Show when={props.isFlagging}>
				<div class="music-review-subpanel flag-subpanel">
					<h4>Flag Item for Review</h4>
					<label class="field">
						<span>Flag Reason</span>
						<select
							value={props.flagReason}
							onChange={(e) =>
								props.onFlagReasonChange(
									e.currentTarget.value as RepertoireFlagReason,
								)
							}
						>
							<For each={FLAG_REASON_OPTIONS}>
								{(opt) => <option value={opt.value}>{opt.label}</option>}
							</For>
						</select>
					</label>
					<label class="field">
						<span>Notes / Explanation</span>
						<textarea
							rows={2}
							value={props.flagNotes}
							onInput={(e) => props.onFlagNotesInput(e.currentTarget.value)}
							placeholder="Describe the discrepancy or query..."
						/>
					</label>
					<div class="subpanel-actions">
						<Button
							type="button"
							variant="secondary"
							onClick={() => props.onCancelFlag()}
							disabled={props.actionPending}
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={() => props.onConfirmFlag()}
							disabled={props.actionPending}
						>
							Confirm Flag
						</Button>
					</div>
				</div>
			</Show>

			<Show when={props.isResolving}>
				<div class="music-review-subpanel resolve-subpanel">
					<h4>Resolve Flag</h4>
					<label class="field">
						<span>Resolution Notes</span>
						<textarea
							rows={2}
							value={props.resolutionNotes}
							onInput={(e) =>
								props.onResolutionNotesInput(e.currentTarget.value)
							}
							placeholder="Detail how the issue was resolved..."
						/>
					</label>
					<div class="subpanel-actions">
						<Button
							type="button"
							variant="secondary"
							onClick={() => props.onCancelResolve()}
							disabled={props.actionPending}
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={() => props.onConfirmResolve()}
							disabled={props.actionPending}
						>
							Confirm Resolution
						</Button>
					</div>
				</div>
			</Show>
		</>
	);
}
