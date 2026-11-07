import type {
	AdminWaitlistRosterEntryDto,
	FestivalClassConfigurationDto,
} from "@festival/common";
import { createEffect, createSignal, For, Show } from "solid-js";
import { getClassWaitlistRoster } from "../lib/api.js";
import { formatWaitlistTimestamp } from "../pages/festivalAdminClassesHelpers.js";
import { Button } from "./Button.js";

export { formatWaitlistTimestamp };

export interface FestivalClassWaitlistModalProps {
	isOpen: boolean;
	slug: string;
	festivalSlug: string;
	classItem: FestivalClassConfigurationDto | null;
	idToken?: string | null;
	getIdToken?: () => Promise<string | null>;
	initialRoster?: AdminWaitlistRosterEntryDto[];
	onClose: () => void;
}

export function FestivalClassWaitlistModal(
	props: FestivalClassWaitlistModalProps,
) {
	const [roster, setRoster] = createSignal<AdminWaitlistRosterEntryDto[]>([]);
	const [isLoading, setIsLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	async function loadRoster() {
		if (!props.classItem) return;
		if (props.initialRoster && !props.idToken && !props.getIdToken) {
			setRoster(props.initialRoster);
			return;
		}
		setIsLoading(true);
		setError(null);
		try {
			const token =
				props.idToken ?? (props.getIdToken ? await props.getIdToken() : null);
			if (!token) throw new Error("Authentication required.");
			const result = await getClassWaitlistRoster(
				token,
				props.slug,
				props.festivalSlug,
				props.classItem.id,
			);
			setRoster(result.roster ?? []);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to load waitlist roster.",
			);
		} finally {
			setIsLoading(false);
		}
	}

	createEffect(() => {
		if (props.isOpen && props.classItem) {
			void loadRoster();
		} else {
			setRoster([]);
			setError(null);
		}
	});

	return (
		<Show when={props.isOpen && props.classItem}>
			<div class="modal-backdrop" role="presentation">
				<section
					class="modal-card panel flow-panel waitlist-modal-card"
					role="dialog"
					aria-modal="true"
					aria-labelledby="waitlist-modal-title"
				>
					<header class="admin-page-header">
						<div>
							<h3 id="waitlist-modal-title">
								Waitlist: {props.classItem?.displayName}
							</h3>
							<p class="muted">Class waitlist roster for administrators.</p>
						</div>
						<Button type="button" variant="secondary" onClick={props.onClose}>
							Close
						</Button>
					</header>

					<Show when={isLoading()}>
						<p class="muted">Loading waitlist roster...</p>
					</Show>

					<Show when={error()}>
						<div class="banner error-banner" role="alert">
							<p>{error()}</p>
							<Button
								type="button"
								variant="secondary"
								onClick={() => void loadRoster()}
							>
								Try again
							</Button>
						</div>
					</Show>

					<Show when={!isLoading() && !error() && roster().length === 0}>
						<div class="listing-table-empty">
							No waitlist entries found for this class.
						</div>
					</Show>

					<Show when={!isLoading() && !error() && roster().length > 0}>
						<div class="classes-table-scroll">
							<div class="listing-table waitlist-roster-table">
								<div class="listing-table-header">
									<span>Child</span>
									<span>Parent</span>
									<span>Email</span>
									<span>Phone</span>
									<span>Joined</span>
									<span>Status</span>
								</div>
								<For each={roster()}>
									{(entry) => (
										<div class="listing-table-row">
											<span>
												<strong>
													{entry.childName?.trim() || entry.childId}
												</strong>
											</span>
											<span>{entry.parentName}</span>
											<span>{entry.parentEmail}</span>
											<span>{entry.parentPhone}</span>
											<span>{formatWaitlistTimestamp(entry.joinedAt)}</span>
											<span class="listing-table-badges">
												<span
													class={`badge ${
														entry.status === "active"
															? "badge-active"
															: "badge-inactive"
													}`}
												>
													{entry.status}
												</span>
											</span>
										</div>
									)}
								</For>
							</div>
						</div>
					</Show>

					<div class="modal-actions">
						<Button type="button" variant="secondary" onClick={props.onClose}>
							Close
						</Button>
					</div>
				</section>
			</div>
		</Show>
	);
}
