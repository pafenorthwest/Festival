import type { PublicDirectoryProfileDto } from "@festival/common";
import { createMemo, createResource, For, Show } from "solid-js";
import { getPublicDirectoryProfiles } from "../lib/api.js";
import { sortProfilesByName } from "./publicDirectoryHelpers.js";

export { sortProfilesByName };

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
					class={`directory-status-tag ${
						profile().isActiveMember ? "badge-active" : "badge-inactive"
					}`}
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

export function PublicDirectoryPage(props: { slug: string; app?: unknown }) {
	const [profiles, { refetch }] = createResource(
		() => props.slug,
		getPublicDirectoryProfiles,
	);

	const teachers = createMemo(() => {
		const list = profiles()?.filter((p) => p.role === "Teacher") ?? [];
		return sortProfilesByName(list);
	});

	const accompanists = createMemo(() => {
		const list = profiles()?.filter((p) => p.role === "Accompanist") ?? [];
		return sortProfilesByName(list);
	});

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
				<DirectorySection
					title="Teachers"
					roleClass="teachers-section"
					profiles={teachers()}
					emptyText="No teachers currently listed."
				/>
				<DirectorySection
					title="Accompanists"
					roleClass="accompanists-section"
					profiles={accompanists()}
					emptyText="No accompanists currently listed."
				/>
			</Show>
		</div>
	);
}
