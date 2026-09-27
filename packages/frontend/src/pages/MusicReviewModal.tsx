import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "../components/Button.js";
import {
	type CanonicalWork,
	claimRepertoireReview,
	flagRepertoireReview,
	normalizeRepertoireReview,
	type RepertoireFlagReason,
	type RepertoireReviewItem,
	resolveRepertoireFlag,
	searchRepertoireCatalog,
	unclaimRepertoireReview,
} from "../lib/api.js";
import {
	FLAG_REASON_OPTIONS,
	formatDuration,
	formatFlagReason,
	formatStatus,
	statusBadgeClass,
} from "./musicReviewHelpers.js";

interface MusicReviewModalProps {
	isOpen: boolean;
	item: RepertoireReviewItem | null;
	slug: string;
	currentUserId?: string | null;
	onClose: () => void;
	onUpdated: (updatedItem: RepertoireReviewItem) => void;
}

export function MusicReviewModal(props: MusicReviewModalProps) {
	const [normalizedTitle, setNormalizedTitle] = createSignal("");
	const [normalizedComposer, setNormalizedComposer] = createSignal("");
	const [imslpUrl, setImslpUrl] = createSignal("");
	const [reviewerNotes, setReviewerNotes] = createSignal("");
	const [canonicalWorkId, setCanonicalWorkId] = createSignal<string | null>(
		null,
	);
	const [catalogSuggestions, setCatalogSuggestions] = createSignal<
		CanonicalWork[]
	>([]);
	const [isSearchingCatalog, setIsSearchingCatalog] = createSignal(false);
	const [showCatalogDropdown, setShowCatalogDropdown] = createSignal(false);

	const [isFlagging, setIsFlagging] = createSignal(false);
	const [flagReason, setFlagReason] =
		createSignal<RepertoireFlagReason>("ambiguous_title");
	const [flagNotes, setFlagNotes] = createSignal("");

	const [isResolving, setIsResolving] = createSignal(false);
	const [resolutionNotes, setResolutionNotes] = createSignal("");

	const [actionPending, setActionPending] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
	const [successMessage, setSuccessMessage] = createSignal<string | null>(null);

	createEffect(() => {
		const item = props.item;
		if (item && props.isOpen) {
			setNormalizedTitle(
				item.normalizedTitle || item.rawTitle || item.submittedTitle || "",
			);
			setNormalizedComposer(
				item.normalizedComposer ||
					item.rawComposer ||
					item.submittedComposer ||
					"",
			);
			setImslpUrl(item.imslpUrl || "");
			setReviewerNotes(item.reviewerNotes || "");
			setCanonicalWorkId(item.canonicalWorkId || item.resolvedWorkId || null);
			setCatalogSuggestions([]);
			setShowCatalogDropdown(false);
			setIsFlagging(false);
			setIsResolving(false);
			setErrorMessage(null);
			setSuccessMessage(null);
		}
	});

	const isClaimedByMe = () => {
		const item = props.item;
		if (!item?.claimedByUid) return false;
		return item.claimedByUid === props.currentUserId;
	};

	const isValidUrl = (url: string) => {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	};

	async function handleCatalogSearch(query: string) {
		if (!query.trim() || query.length < 2) {
			setCatalogSuggestions([]);
			setShowCatalogDropdown(false);
			return;
		}
		setIsSearchingCatalog(true);
		try {
			const res = await searchRepertoireCatalog(props.slug, query.trim(), {
				limit: 5,
			});
			setCatalogSuggestions(res.works);
			setShowCatalogDropdown(res.works.length > 0);
		} catch {
			setCatalogSuggestions([]);
		} finally {
			setIsSearchingCatalog(false);
		}
	}

	function handleSelectCatalogWork(work: CanonicalWork) {
		setNormalizedTitle(work.title);
		if (work.composerName) {
			setNormalizedComposer(work.composerName);
		}
		if (work.imslpUrl) {
			setImslpUrl(work.imslpUrl);
		}
		setCanonicalWorkId(work.id);
		setShowCatalogDropdown(false);
	}

	async function handleClaim() {
		const item = props.item;
		if (!item) return;
		setActionPending(true);
		setErrorMessage(null);
		try {
			const res = await claimRepertoireReview(props.slug, item.id);
			setSuccessMessage("Review claimed successfully.");
			props.onUpdated(res.item);
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to claim review.",
			);
		} finally {
			setActionPending(false);
		}
	}

	async function handleUnclaim() {
		const item = props.item;
		if (!item) return;
		setActionPending(true);
		setErrorMessage(null);
		try {
			const res = await unclaimRepertoireReview(props.slug, item.id);
			setSuccessMessage("Review released.");
			props.onUpdated(res.item);
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to release review.",
			);
		} finally {
			setActionPending(false);
		}
	}

	async function handleNormalizeAndApprove() {
		const item = props.item;
		if (!item) return;
		if (!normalizedTitle().trim()) {
			setErrorMessage("Canonical title is required.");
			return;
		}
		if (!normalizedComposer().trim()) {
			setErrorMessage("Canonical composer is required.");
			return;
		}
		if (imslpUrl().trim() && !isValidUrl(imslpUrl().trim())) {
			setErrorMessage("IMSLP URL must be a valid HTTP or HTTPS URL.");
			return;
		}

		setActionPending(true);
		setErrorMessage(null);
		try {
			const res = await normalizeRepertoireReview(props.slug, item.id, {
				normalizedTitle: normalizedTitle().trim(),
				normalizedComposer: normalizedComposer().trim(),
				imslpUrl: imslpUrl().trim() || null,
				notes: reviewerNotes().trim() || null,
				canonicalWorkId: canonicalWorkId(),
				status: "approved",
			});
			setSuccessMessage("Repertoire normalized and approved.");
			props.onUpdated(res.item);
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to normalize review.",
			);
		} finally {
			setActionPending(false);
		}
	}

	async function handleConfirmFlag() {
		const item = props.item;
		if (!item) return;
		setActionPending(true);
		setErrorMessage(null);
		try {
			const res = await flagRepertoireReview(props.slug, item.id, {
				reason: flagReason(),
				notes: flagNotes().trim() || null,
			});
			setSuccessMessage("Review item flagged.");
			setIsFlagging(false);
			props.onUpdated(res.item);
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to flag review.",
			);
		} finally {
			setActionPending(false);
		}
	}

	async function handleConfirmResolve() {
		const item = props.item;
		if (!item) return;
		setActionPending(true);
		setErrorMessage(null);
		try {
			const res = await resolveRepertoireFlag(props.slug, item.id, {
				resolutionNotes: resolutionNotes().trim() || null,
				status: "in_review",
			});
			setSuccessMessage("Flag resolved.");
			setIsResolving(false);
			props.onUpdated(res.item);
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to resolve flag.",
			);
		} finally {
			setActionPending(false);
		}
	}

	return (
		<Show when={props.isOpen && props.item}>
			<div class="modal-backdrop" role="presentation">
				<section
					class="modal-card panel flow-panel music-review-modal-card"
					role="dialog"
					aria-modal="true"
					aria-labelledby="review-modal-title"
				>
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

					<Show when={errorMessage()}>
						<div class="banner banner-error" role="alert">
							{errorMessage()}
						</div>
					</Show>
					<Show when={successMessage()}>
						<div class="banner banner-success" role="status">
							{successMessage()}
						</div>
					</Show>

					<div class="music-review-modal-grid">
						{/* Left: Raw Submitted Data */}
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
										{props.item?.rawComposer ||
											props.item?.submittedComposer ||
											"—"}
									</span>
								</div>
								<div class="raw-field">
									<span class="raw-label">Movement</span>
									<span class="raw-value">
										{props.item?.rawMovement || "—"}
									</span>
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
											{isClaimedByMe()
												? "Claimed by you"
												: props.item?.claimedByName
													? `Claimed by ${props.item.claimedByName}`
													: props.item?.claimedByUid
														? "Claimed"
														: "Unclaimed"}
										</span>
									</div>
								</div>

								<Show
									when={
										props.item?.isFlagged || props.item?.status === "flagged"
									}
								>
									<div class="music-review-flag-card" role="alert">
										<strong>
											Flagged: {formatFlagReason(props.item?.flagReason)}
										</strong>
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

						{/* Right: Canonical Fields & Autocomplete */}
						<div class="music-review-canonical-column">
							<h4>Canonical Fields</h4>
							<div class="music-review-fields-card">
								<div class="field catalog-autocomplete-field">
									<label for="canonical-title">Canonical Title</label>
									<div class="input-with-button">
										<input
											id="canonical-title"
											type="text"
											value={normalizedTitle()}
											onInput={(e) => {
												setNormalizedTitle(e.currentTarget.value);
												setCanonicalWorkId(null);
												void handleCatalogSearch(e.currentTarget.value);
											}}
											placeholder="Search or enter canonical title..."
										/>
										<button
											type="button"
											class="button secondary compact-search-btn"
											onClick={() =>
												void handleCatalogSearch(normalizedTitle())
											}
											disabled={isSearchingCatalog()}
										>
											{isSearchingCatalog() ? "Searching..." : "Search"}
										</button>
									</div>

									<Show
										when={
											showCatalogDropdown() && catalogSuggestions().length > 0
										}
									>
										<ul class="catalog-suggestions-dropdown">
											<For each={catalogSuggestions()}>
												{(work) => (
													<li class="catalog-suggestion-item">
														<button
															type="button"
															class="catalog-suggestion-button"
															onClick={() => handleSelectCatalogWork(work)}
														>
															<strong>{work.title}</strong>
															<Show when={work.composerName}>
																<span class="suggestion-composer">
																	by {work.composerName}
																</span>
															</Show>
														</button>
													</li>
												)}
											</For>
										</ul>
									</Show>
								</div>

								<label class="field">
									<span>Canonical Composer</span>
									<input
										type="text"
										value={normalizedComposer()}
										onInput={(e) =>
											setNormalizedComposer(e.currentTarget.value)
										}
										placeholder="e.g. Johann Sebastian Bach"
									/>
								</label>

								<label class="field">
									<span>IMSLP Reference URL</span>
									<input
										type="url"
										value={imslpUrl()}
										onInput={(e) => setImslpUrl(e.currentTarget.value)}
										placeholder="https://imslp.org/wiki/..."
									/>
									<Show
										when={imslpUrl().trim() && isValidUrl(imslpUrl().trim())}
									>
										<div class="imslp-preview-container">
											<a
												href={imslpUrl().trim()}
												target="_blank"
												rel="noopener noreferrer"
												class="imslp-preview-link"
											>
												Open IMSLP Reference ↗
											</a>
										</div>
									</Show>
								</label>

								<label class="field">
									<span>Reviewer Notes</span>
									<textarea
										rows={3}
										value={reviewerNotes()}
										onInput={(e) => setReviewerNotes(e.currentTarget.value)}
										placeholder="Optional notes or catalog cross-reference..."
									/>
								</label>
							</div>
						</div>
					</div>

					{/* Flag Sub-Panel */}
					<Show when={isFlagging()}>
						<div class="music-review-subpanel flag-subpanel">
							<h4>Flag Item for Review</h4>
							<label class="field">
								<span>Flag Reason</span>
								<select
									value={flagReason()}
									onChange={(e) =>
										setFlagReason(e.currentTarget.value as RepertoireFlagReason)
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
									value={flagNotes()}
									onInput={(e) => setFlagNotes(e.currentTarget.value)}
									placeholder="Describe the discrepancy or query..."
								/>
							</label>
							<div class="subpanel-actions">
								<Button
									type="button"
									variant="secondary"
									onClick={() => setIsFlagging(false)}
									disabled={actionPending()}
								>
									Cancel
								</Button>
								<Button
									type="button"
									onClick={() => void handleConfirmFlag()}
									disabled={actionPending()}
								>
									Confirm Flag
								</Button>
							</div>
						</div>
					</Show>

					{/* Resolve Flag Sub-Panel */}
					<Show when={isResolving()}>
						<div class="music-review-subpanel resolve-subpanel">
							<h4>Resolve Flag</h4>
							<label class="field">
								<span>Resolution Notes</span>
								<textarea
									rows={2}
									value={resolutionNotes()}
									onInput={(e) => setResolutionNotes(e.currentTarget.value)}
									placeholder="Detail how the issue was resolved..."
								/>
							</label>
							<div class="subpanel-actions">
								<Button
									type="button"
									variant="secondary"
									onClick={() => setIsResolving(false)}
									disabled={actionPending()}
								>
									Cancel
								</Button>
								<Button
									type="button"
									onClick={() => void handleConfirmResolve()}
									disabled={actionPending()}
								>
									Confirm Resolution
								</Button>
							</div>
						</div>
					</Show>

					{/* Actions Footer */}
					<footer class="music-review-modal-actions">
						<div class="left-actions">
							<Show
								when={!props.item?.claimedByUid}
								fallback={
									<Button
										type="button"
										variant="secondary"
										onClick={() => void handleUnclaim()}
										disabled={actionPending()}
									>
										Release Claim
									</Button>
								}
							>
								<Button
									type="button"
									variant="secondary"
									onClick={() => void handleClaim()}
									disabled={actionPending()}
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
										onClick={() => {
											setIsFlagging(!isFlagging());
											setIsResolving(false);
										}}
										disabled={actionPending()}
									>
										Flag
									</Button>
								}
							>
								<Button
									type="button"
									variant="secondary"
									onClick={() => {
										setIsResolving(!isResolving());
										setIsFlagging(false);
									}}
									disabled={actionPending()}
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
								disabled={actionPending()}
							>
								Close
							</Button>
							<Button
								type="button"
								onClick={() => void handleNormalizeAndApprove()}
								disabled={actionPending()}
							>
								{actionPending() ? "Saving..." : "Normalize & Approve"}
							</Button>
						</div>
					</footer>
				</section>
			</div>
		</Show>
	);
}
