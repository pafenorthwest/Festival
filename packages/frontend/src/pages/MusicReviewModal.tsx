import { Show } from "solid-js";
import { Button } from "../components/Button.js";
import { MusicReviewCanonicalColumn } from "../domains/catalog/MusicReviewCanonicalColumn.js";
import { MusicReviewFlagPanels } from "../domains/catalog/MusicReviewFlagPanels.js";
import { MusicReviewRawColumn } from "../domains/catalog/MusicReviewRawColumn.js";
import { useMusicReviewModalState } from "../domains/catalog/useMusicReviewModalState.js";
import type { RepertoireReviewItem } from "../lib/api.js";

export interface MusicReviewModalProps {
	isOpen: boolean;
	item: RepertoireReviewItem | null;
	slug: string;
	currentUserId?: string | null;
	onClose: () => void;
	onUpdated: (updatedItem: RepertoireReviewItem) => void;
}

function MusicReviewModalHeader(props: { onClose: () => void }) {
	return (
		<header class="music-review-modal-header">
			<div>
				<h3 id="review-modal-title">Repertoire Review</h3>
				<p class="muted">
					Review submitted piece metadata against canonical records.
				</p>
			</div>
			<button
				type="button"
				class="close-button"
				aria-label="Close dialog"
				onClick={() => props.onClose()}
			>
				&times;
			</button>
		</header>
	);
}

interface MusicReviewModalActionsProps {
	item: RepertoireReviewItem | null;
	isFlagging: boolean;
	isResolving: boolean;
	actionPending: boolean;
	onClaim: () => void;
	onUnclaim: () => void;
	onToggleFlag: () => void;
	onToggleResolve: () => void;
	onClose: () => void;
	onApprove: () => void;
}

function MusicReviewModalActions(props: MusicReviewModalActionsProps) {
	return (
		<footer class="music-review-modal-actions">
			<div class="left-actions">
				<Show
					when={!props.item?.claimedByUid}
					fallback={
						<Button
							type="button"
							variant="secondary"
							onClick={() => props.onUnclaim()}
							disabled={props.actionPending}
						>
							Release Claim
						</Button>
					}
				>
					<Button
						type="button"
						variant="secondary"
						onClick={() => props.onClaim()}
						disabled={props.actionPending}
					>
						Claim Review
					</Button>
				</Show>

				<Show
					when={props.item?.isFlagged || props.item?.status === "flagged"}
					fallback={
						<Button
							type="button"
							variant="secondary"
							onClick={() => props.onToggleFlag()}
							disabled={props.actionPending}
						>
							Flag
						</Button>
					}
				>
					<Button
						type="button"
						variant="secondary"
						onClick={() => props.onToggleResolve()}
						disabled={props.actionPending}
					>
						Resolve Flag
					</Button>
				</Show>
			</div>

			<div class="right-actions">
				<Button
					type="button"
					variant="secondary"
					onClick={() => props.onClose()}
					disabled={props.actionPending}
				>
					Close
				</Button>
				<Button
					type="button"
					onClick={() => props.onApprove()}
					disabled={props.actionPending}
				>
					{props.actionPending ? "Saving..." : "Normalize & Approve"}
				</Button>
			</div>
		</footer>
	);
}

export function MusicReviewModal(props: MusicReviewModalProps) {
	const state = useMusicReviewModalState(props);

	return (
		<Show when={props.isOpen && props.item}>
			<div class="modal-backdrop" role="presentation">
				<section
					class="modal-card panel flow-panel music-review-modal-card"
					role="dialog"
					aria-modal="true"
					aria-labelledby="review-modal-title"
				>
					<MusicReviewModalHeader onClose={() => props.onClose()} />
					<Show when={state.errorMessage()}>
						<div class="banner banner-error" role="alert">
							{state.errorMessage()}
						</div>
					</Show>
					<Show when={state.successMessage()}>
						<div class="banner banner-success" role="status">
							{state.successMessage()}
						</div>
					</Show>
					<div class="music-review-modal-grid">
						<MusicReviewRawColumn
							item={props.item}
							isClaimedByMe={state.isClaimedByMe()}
						/>
						<MusicReviewCanonicalColumn
							normalizedTitle={state.normalizedTitle()}
							onTitleInput={(value) => {
								state.setNormalizedTitle(value);
								state.setCanonicalWorkId(null);
								void state.handleCatalogSearch(value);
							}}
							normalizedComposer={state.normalizedComposer()}
							onComposerInput={(v) => state.setNormalizedComposer(v)}
							imslpUrl={state.imslpUrl()}
							onImslpUrlInput={(v) => state.setImslpUrl(v)}
							isValidUrl={state.isValidUrl}
							reviewerNotes={state.reviewerNotes()}
							onReviewerNotesInput={(v) => state.setReviewerNotes(v)}
							catalogSuggestions={state.catalogSuggestions()}
							isSearchingCatalog={state.isSearchingCatalog()}
							showCatalogDropdown={state.showCatalogDropdown()}
							onSearchCatalog={() =>
								void state.handleCatalogSearch(state.normalizedTitle())
							}
							onSelectCatalogWork={state.handleSelectCatalogWork}
						/>
					</div>
					<MusicReviewFlagPanels
						isFlagging={state.isFlagging()}
						flagReason={state.flagReason()}
						onFlagReasonChange={(r) => state.setFlagReason(r)}
						flagNotes={state.flagNotes()}
						onFlagNotesInput={(n) => state.setFlagNotes(n)}
						onCancelFlag={() => state.setIsFlagging(false)}
						onConfirmFlag={() => void state.handleConfirmFlag()}
						isResolving={state.isResolving()}
						resolutionNotes={state.resolutionNotes()}
						onResolutionNotesInput={(n) => state.setResolutionNotes(n)}
						onCancelResolve={() => state.setIsResolving(false)}
						onConfirmResolve={() => void state.handleConfirmResolve()}
						actionPending={state.actionPending()}
					/>
					<MusicReviewModalActions
						item={props.item}
						isFlagging={state.isFlagging()}
						isResolving={state.isResolving()}
						actionPending={state.actionPending()}
						onClaim={() => void state.handleClaim()}
						onUnclaim={() => void state.handleUnclaim()}
						onToggleFlag={() => {
							state.setIsFlagging(!state.isFlagging());
							state.setIsResolving(false);
						}}
						onToggleResolve={() => {
							state.setIsResolving(!state.isResolving());
							state.setIsFlagging(false);
						}}
						onClose={() => props.onClose()}
						onApprove={() => void state.handleNormalizeAndApprove()}
					/>
				</section>
			</div>
		</Show>
	);
}
