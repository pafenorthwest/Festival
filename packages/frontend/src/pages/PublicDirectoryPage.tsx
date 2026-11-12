import type { PublicDirectoryProfileDto } from "@festival/common";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { getPublicDirectoryProfiles } from "../lib/api.js";
import {
	collectDirectoryDivisions,
	filterDirectoryProfiles,
	partitionDirectoryProfiles,
	readReadyProfiles,
} from "./publicDirectoryHelpers.js";

export function DirectoryProfileCard(props: {
	profile: PublicDirectoryProfileDto;
}) {
	const profile = () => props.profile;
	const divisions = () => profile().approvedDivisions ?? [];
	return (
		<article class="directory-profile-card">
			<div class="directory-profile-header">
				<Show when={profile().teacherColor}>
					<span
						class="directory-profile-color-indicator"
						style={{ "background-color": profile().teacherColor }}
						aria-hidden="true"
					/>
				</Show>
				<h3 class="directory-profile-name">{profile().displayName}</h3>
				<span class="badge directory-profile-role">{profile().role}</span>
				<span
					class={`directory-status-tag ${profile().isActiveMember ? "badge-active" : "badge-inactive"}`}
				>
					{profile().isActiveMember ? "Active Member" : "Inactive Member"}
				</span>
			</div>
			<Show when={divisions().length > 0}>
				<div class="directory-profile-divisions">
					<For each={divisions()}>
						{(division) => (
							<span class="directory-division-tag">{division.name}</span>
						)}
					</For>
				</div>
			</Show>
		</article>
	);
}

function DirectoryLoadingState() {
	return (
		<div class="directory-loading" aria-busy="true" aria-live="polite">
			<span class="button-spinner" aria-hidden="true" />
			<p>Loading directory...</p>
		</div>
	);
}

function DirectoryErrorState(props: { onRetry: () => void }) {
	return (
		<div class="banner error-banner directory-error" role="alert">
			<p>Failed to load directory profiles.</p>
			<button
				type="button"
				class="button secondary-button"
				onClick={() => props.onRetry()}
			>
				Retry
			</button>
		</div>
	);
}

function DirectoryFiltersBar(props: { model: PublicDirectoryModel }) {
	const m = props.model;
	return (
		<section class="directory-filters" aria-label="Directory filters">
			<label class="field">
				<span>Search</span>
				<input
					type="search"
					placeholder="Search by name or division"
					value={m.searchQuery()}
					onInput={(e) => m.setSearchQuery(e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Division</span>
				<select
					value={m.selectedDivisionId()}
					onChange={(e) => m.setSelectedDivisionId(e.currentTarget.value)}
				>
					<option value="">All divisions</option>
					<For each={m.availableDivisions()}>
						{(division) => <option value={division.id}>{division.name}</option>}
					</For>
				</select>
			</label>
			<Show when={m.hasActiveFilters()}>
				<button
					type="button"
					class="button secondary-button"
					onClick={m.clearFilters}
				>
					Clear filters
				</button>
			</Show>
		</section>
	);
}

function DirectorySection(props: {
	title: string;
	roleClass: string;
	profiles: PublicDirectoryProfileDto[];
	emptyText: string;
}) {
	return (
		<section class={`directory-section ${props.roleClass}`}>
			<h2>{props.title}</h2>
			<Show
				when={props.profiles.length > 0}
				fallback={<p class="empty-state">{props.emptyText}</p>}
			>
				<div class="directory-grid">
					<For each={props.profiles}>
						{(profile) => <DirectoryProfileCard profile={profile} />}
					</For>
				</div>
			</Show>
		</section>
	);
}

function createPublicDirectoryModel(slug: () => string) {
	const [searchQuery, setSearchQuery] = createSignal("");
	const [selectedDivisionId, setSelectedDivisionId] = createSignal("");
	const [profiles, { refetch }] = createResource(
		slug,
		getPublicDirectoryProfiles,
	);
	const readyProfiles = createMemo(() => readReadyProfiles(profiles));
	const availableDivisions = createMemo(() =>
		collectDirectoryDivisions(readyProfiles()),
	);
	const directory = createMemo(() =>
		partitionDirectoryProfiles(
			filterDirectoryProfiles(readyProfiles(), {
				query: searchQuery(),
				divisionId: selectedDivisionId(),
			}),
		),
	);
	const hasActiveFilters = () =>
		searchQuery().trim().length > 0 || selectedDivisionId().length > 0;
	const isFilteredEmpty = () =>
		hasActiveFilters() &&
		directory().teachers.length === 0 &&
		directory().accompanists.length === 0;
	const clearFilters = () => {
		setSearchQuery("");
		setSelectedDivisionId("");
	};
	return {
		profiles,
		refetch,
		readyProfiles,
		availableDivisions,
		directory,
		searchQuery,
		setSearchQuery,
		selectedDivisionId,
		setSelectedDivisionId,
		hasActiveFilters,
		isFilteredEmpty,
		clearFilters,
	};
}
type PublicDirectoryModel = ReturnType<typeof createPublicDirectoryModel>;

export function PublicDirectoryPage(props: { slug: string }) {
	const m = createPublicDirectoryModel(() => props.slug);
	const { profiles, refetch } = m;
	return (
		<div class="public-directory-page">
			<header class="public-directory-header">
				<h1>Public Directory</h1>
			</header>
			<Show when={profiles.loading}>
				<DirectoryLoadingState />
			</Show>
			<Show when={profiles.error}>
				<DirectoryErrorState onRetry={() => void refetch()} />
			</Show>
			<Show when={!profiles.loading && !profiles.error && profiles()}>
				<Show
					when={(m.readyProfiles()?.length ?? 0) > 0 || m.hasActiveFilters()}
				>
					<DirectoryFiltersBar model={m} />
				</Show>
				<Show
					when={!m.isFilteredEmpty()}
					fallback={
						<div class="empty-state directory-filtered-empty">
							<p>No directory profiles match the selected filters.</p>
							<button
								type="button"
								class="button secondary-button"
								onClick={m.clearFilters}
							>
								Clear filters
							</button>
						</div>
					}
				>
					<DirectorySection
						title="Teachers"
						roleClass="teachers-section"
						profiles={m.directory().teachers}
						emptyText="No teachers currently listed."
					/>
					<DirectorySection
						title="Accompanists"
						roleClass="accompanists-section"
						profiles={m.directory().accompanists}
						emptyText="No accompanists currently listed."
					/>
				</Show>
			</Show>
		</div>
	);
}
