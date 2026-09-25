import { createResource, Show } from "solid-js";
import { getPublicFestival } from "../lib/api.js";
import {
	buildFestivalRegistrationPath,
	buildFestivalVolunteersPath,
} from "../lib/routes.js";

interface FestivalLandingPageProps {
	slug: string;
	festivalSlug: string;
}

export function FestivalLandingPage(props: FestivalLandingPageProps) {
	const membershipPath = `/org/${props.slug}/membership`;
	const [festival] = createResource(
		() => [props.slug, props.festivalSlug] as const,
		([slug, festivalSlug]) => getPublicFestival(slug, festivalSlug),
	);

	return (
		<>
			<Show when={festival.loading}>
				<section class="org-landing">
					<p class="muted">Loading festival.</p>
				</section>
			</Show>
			<Show when={festival.error}>
				<section class="org-landing">
					<p role="alert">Festival not found.</p>
				</section>
			</Show>
			<Show when={festival()}>
				<section class="org-landing">
					<h2>{festival()?.festival.name}</h2>
					<h2>Register</h2>
					<nav class="role-banners" aria-label="Audience links">
						<a class="role-banner teachers" href={membershipPath}>
							Teachers
						</a>
						<a
							class="role-banner parents"
							href={buildFestivalRegistrationPath(
								props.slug,
								props.festivalSlug,
							)}
						>
							Parents
						</a>
						<a
							class="role-banner volunteers"
							href={buildFestivalVolunteersPath(props.slug, props.festivalSlug)}
						>
							Volunteers
						</a>
						<a
							class="role-banner accompanists"
							href={`/org/${props.slug}/accompanist-membership`}
						>
							Accompanists
						</a>
					</nav>
					<a
						class="button secondary-button compact-header-button all-memberships-link"
						href={membershipPath}
					>
						All Memberships
					</a>
				</section>
			</Show>
		</>
	);
}
