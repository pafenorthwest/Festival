import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	listRepertoireReviewQueue,
	type RepertoireReviewItem,
	type RepertoireReviewQueueSummary,
} from "../lib/api.js";
import { MusicReviewModal } from "./MusicReviewModal.js";
import {
	formatDuration,
	formatStatus,
	statusBadgeClass,
} from "./musicReviewHelpers.js";

interface MusicReviewPageProps {
	app: FestivalAppController;
	slug?: string;
}

export type QueueStatusFilter =
	| "all"
	| "pending"
	| "claimed"
	| "approved"
	| "flagged";

export function MusicReviewPage(props: MusicReviewPageProps) {
	const orgSlug = () =>
		props.slug ||
		props.app.organization()?.slug ||
		(props.app.route() as { slug?: string }).slug ||
		"";

	const currentUserId = () => props.app.firebaseUser()?.uid ?? null;

	const [items, setItems] = createSignal<RepertoireReviewItem[]>([]);
	const [summary, setSummary] = createSignal<RepertoireReviewQueueSummary>({
		total: 0,
		pending: 0,
		inReview: 0,
		reviewed: 0,
		flagged: 0,
		approved: 0,
	});
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);

	// Filters
	const [statusFilter, setStatusFilter] =
		createSignal<QueueStatusFilter>("all");
	const [myClaimsOnly, setMyClaimsOnly] = createSignal(false);
	const [flaggedOnly, setFlaggedOnly] = createSignal(false);
	const [searchQuery, setSearchQuery] = createSignal("");

	// Selected item for review modal
	const [selectedItem, setSelectedItem] =
		createSignal<RepertoireReviewItem | null>(null);

	async function loadQueue() {
		const slug = orgSlug();
		if (!slug) return;
		setLoading(true);
		setError(null);
		try {
			const res = await listRepertoireReviewQueue(slug, {
				sync: true,
			});
			setItems(res.items);
			setSummary(res.summary);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Failed to load repertoire review queue.",
			);
		} finally {
			setLoading(false);
		}
	}

	onMount(() => {
		void loadQueue();
	});

	createEffect(() => {
		const slug = orgSlug();
		if (slug) {
			void loadQueue();
		}
	});

	function handleItemUpdated(updated: RepertoireReviewItem) {
		setItems((prev) =>
			prev.map((item) => (item.id === updated.id ? updated : item)),
		);
		setSelectedItem(updated);

		// Recalculate local summary metrics
		const currentItems = items();
		let pending = 0;
		let inReview = 0;
		let reviewed = 0;
		let flagged = 0;
		let approved = 0;

		for (const item of currentItems) {
			if (item.isFlagged || item.status === "flagged") {
				flagged++;
			}
			if (item.status === "pending") pending++;
			else if (item.status === "claimed" || item.status === "in_review")
				inReview++;
			else if (item.status === "reviewed") reviewed++;
			else if (
				item.status === "approved" ||
				item.status === "approved_for_publication"
			)
				approved++;
		}

		setSummary({
			total: currentItems.length,
			pending,
			inReview,
			reviewed,
			flagged,
			approved,
		});
	}

	const filteredItems = createMemo(() => {
		let list = items();
		const currentStatus = statusFilter();
		if (currentStatus !== "all") {
			if (currentStatus === "claimed") {
				list = list.filter(
					(i) => i.status === "claimed" || i.status === "in_review",
				);
			} else if (currentStatus === "approved") {
				list = list.filter(
					(i) =>
						i.status === "approved" ||
						i.status === "approved_for_publication" ||
						i.status === "reviewed",
				);
			} else {
				list = list.filter((i) => i.status === currentStatus);
			}
		}

		if (myClaimsOnly()) {
			const uid = currentUserId();
			list = list.filter((i) => i.claimedByUid === uid);
		}

		if (flaggedOnly()) {
			list = list.filter((i) => i.isFlagged || i.status === "flagged");
		}

		const query = searchQuery().trim().toLowerCase();
		if (query) {
			list = list.filter((i) => {
				const title = (i.rawTitle || i.submittedTitle || "").toLowerCase();
				const composer = (
					i.rawComposer ||
					i.submittedComposer ||
					""
				).toLowerCase();
				const movement = (i.rawMovement || "").toLowerCase();
				return (
					title.includes(query) ||
					composer.includes(query) ||
					movement.includes(query)
				);
			});
		}

		return list;
	});

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only administrative members can access the music review queue." />
			}
		>
			<section class="panel flow-panel music-review-page-shell">
				<header class="music-review-header">
					<div>
						<h2>Music Review Queue</h2>
						<p class="muted">
							Review and normalize repertoire submissions before festival
							publication.
						</p>
					</div>
					<Button
						type="button"
						variant="secondary"
						onClick={() => void loadQueue()}
						disabled={loading()}
					>
						{loading() ? "Refreshing..." : "Refresh Queue"}
					</Button>
				</header>

				{/* Summary Metrics Cards */}
				<div class="music-review-metrics-grid">
					<div class="metric-card">
						<span class="metric-label">Total</span>
						<strong class="metric-value">{summary().total}</strong>
					</div>
					<div class="metric-card metric-pending">
						<span class="metric-label">Pending</span>
						<strong class="metric-value">{summary().pending}</strong>
					</div>
					<div class="metric-card metric-claimed">
						<span class="metric-label">Claimed</span>
						<strong class="metric-value">{summary().inReview}</strong>
					</div>
					<div class="metric-card metric-approved">
						<span class="metric-label">Approved</span>
						<strong class="metric-value">{summary().approved ?? 0}</strong>
					</div>
					<div class="metric-card metric-flagged">
						<span class="metric-label">Flagged</span>
						<strong class="metric-value">{summary().flagged}</strong>
					</div>
				</div>

				{/* Filter & Search Bar */}
				<div class="music-review-filter-bar">
					<nav
						class="music-review-status-tabs"
						aria-label="Filter by review status"
					>
						<For
							each={
								[
									{ id: "all", label: "All" },
									{ id: "pending", label: "Pending" },
									{ id: "claimed", label: "Claimed" },
									{ id: "approved", label: "Approved" },
									{ id: "flagged", label: "Flagged" },
								] as const
							}
						>
							{(tab) => (
								<button
									type="button"
									class={`button ${statusFilter() === tab.id ? "primary" : "secondary"}`}
									aria-pressed={statusFilter() === tab.id}
									onClick={() => setStatusFilter(tab.id)}
								>
									{tab.label}
								</button>
							)}
						</For>
					</nav>

					<div class="music-review-filter-options">
						<label class="filter-toggle-label">
							<input
								type="checkbox"
								checked={myClaimsOnly()}
								onChange={(e) => setMyClaimsOnly(e.currentTarget.checked)}
							/>
							<span>My Claims</span>
						</label>

						<label class="filter-toggle-label">
							<input
								type="checkbox"
								checked={flaggedOnly()}
								onChange={(e) => setFlaggedOnly(e.currentTarget.checked)}
							/>
							<span>Flagged only</span>
						</label>

						<div class="queue-search-field">
							<input
								type="search"
								placeholder="Filter queue by title or composer..."
								value={searchQuery()}
								onInput={(e) => setSearchQuery(e.currentTarget.value)}
								aria-label="Filter queue"
							/>
						</div>
					</div>
				</div>

				<Show when={error()}>
					<div class="banner banner-error" role="alert">
						{error()}
					</div>
				</Show>

				{/* Queue Table */}
				<div class="listing-table music-review-table">
					<div class="listing-table-header">
						<span>Title</span>
						<span>Composer</span>
						<span>Movement</span>
						<span>Duration</span>
						<span>Status</span>
						<span>Claimed By</span>
						<span>Action</span>
					</div>

					<Show when={loading() && items().length === 0}>
						<div class="listing-table-empty">Loading review queue...</div>
					</Show>

					<Show when={!loading() && filteredItems().length === 0}>
						<div class="listing-table-empty">
							No repertoire items match current filters.
						</div>
					</Show>

					<For each={filteredItems()}>
						{(item) => (
							<div class="listing-table-row">
								<span class="cell-title">
									<strong>{item.rawTitle || item.submittedTitle || "—"}</strong>
								</span>
								<span class="cell-composer">
									{item.rawComposer || item.submittedComposer || "—"}
								</span>
								<span class="cell-movement">{item.rawMovement || "—"}</span>
								<span class="cell-duration">
									{formatDuration(item.durationSeconds)}
								</span>
								<span class="listing-table-badges">
									<span class={`badge ${statusBadgeClass(item.status)}`}>
										{formatStatus(item.status)}
									</span>
									<Show when={item.isFlagged}>
										<span class="badge badge-rejected">Flagged</span>
									</Show>
								</span>
								<span class="cell-claimed">
									{item.claimedByName ||
										(item.claimedByUid ? "Claimed" : "Unclaimed")}
								</span>
								<span class="listing-table-actions">
									<button
										type="button"
										class="button secondary compact-button"
										onClick={() => setSelectedItem(item)}
									>
										Review
									</button>
								</span>
							</div>
						)}
					</For>
				</div>
			</section>

			{/* Review/Normalization Modal */}
			<MusicReviewModal
				isOpen={selectedItem() !== null}
				item={selectedItem()}
				slug={orgSlug()}
				currentUserId={currentUserId()}
				onClose={() => setSelectedItem(null)}
				onUpdated={handleItemUpdated}
			/>
		</Show>
	);
}
