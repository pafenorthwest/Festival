import { For, Show } from "solid-js";
import type { CanonicalWork } from "../../lib/api.js";

export interface MusicReviewCanonicalColumnProps {
	normalizedTitle: string;
	onTitleInput: (value: string) => void;
	normalizedComposer: string;
	onComposerInput: (value: string) => void;
	imslpUrl: string;
	onImslpUrlInput: (value: string) => void;
	isValidUrl: (url: string) => boolean;
	reviewerNotes: string;
	onReviewerNotesInput: (value: string) => void;
	catalogSuggestions: CanonicalWork[];
	isSearchingCatalog: boolean;
	showCatalogDropdown: boolean;
	onSearchCatalog: () => void;
	onSelectCatalogWork: (work: CanonicalWork) => void;
}

export function MusicReviewCanonicalColumn(
	props: MusicReviewCanonicalColumnProps,
) {
	return (
		<div class="music-review-canonical-column">
			<h4>Canonical Fields</h4>
			<div class="music-review-fields-card">
				<div class="field catalog-autocomplete-field">
					<label for="canonical-title">Canonical Title</label>
					<div class="input-with-button">
						<input
							id="canonical-title"
							type="text"
							value={props.normalizedTitle}
							onInput={(e) => props.onTitleInput(e.currentTarget.value)}
							placeholder="Search or enter canonical title..."
						/>
						<button
							type="button"
							class="button secondary compact-search-btn"
							onClick={() => props.onSearchCatalog()}
							disabled={props.isSearchingCatalog}
						>
							{props.isSearchingCatalog ? "Searching..." : "Search"}
						</button>
					</div>

					<Show
						when={
							props.showCatalogDropdown && props.catalogSuggestions.length > 0
						}
					>
						<ul class="catalog-suggestions-dropdown">
							<For each={props.catalogSuggestions}>
								{(work) => (
									<li class="catalog-suggestion-item">
										<button
											type="button"
											class="catalog-suggestion-button"
											onClick={() => props.onSelectCatalogWork(work)}
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
						value={props.normalizedComposer}
						onInput={(e) => props.onComposerInput(e.currentTarget.value)}
						placeholder="e.g. Johann Sebastian Bach"
					/>
				</label>

				<label class="field">
					<span>IMSLP Reference URL</span>
					<input
						type="url"
						value={props.imslpUrl}
						onInput={(e) => props.onImslpUrlInput(e.currentTarget.value)}
						placeholder="https://imslp.org/wiki/..."
					/>
					<Show
						when={
							props.imslpUrl.trim() && props.isValidUrl(props.imslpUrl.trim())
						}
					>
						<div class="imslp-preview-container">
							<a
								href={props.imslpUrl.trim()}
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
						value={props.reviewerNotes}
						onInput={(e) => props.onReviewerNotesInput(e.currentTarget.value)}
						placeholder="Optional notes or catalog cross-reference..."
					/>
				</label>
			</div>
		</div>
	);
}
