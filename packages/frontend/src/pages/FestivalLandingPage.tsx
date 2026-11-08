import { createResource, createSignal, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { getCustomerChildren, getPublicFestival } from "../lib/api.js";
import {
	buildFestivalRegistrationPath,
	buildFestivalVolunteersPath,
	buildOrgCustomerAccountChildrenPath,
} from "../lib/routes.js";

interface FestivalLandingPageProps {
	slug: string;
	festivalSlug: string;
	app?: FestivalAppController;
}

export function FestivalLandingPage(props: FestivalLandingPageProps) {
	const membershipPath = `/org/${props.slug}/membership`;
	const [entryError, setEntryError] = createSignal("");
	const [entering, setEntering] = createSignal(false);
	const [festival] = createResource(
		() => [props.slug, props.festivalSlug] as const,
		([slug, festivalSlug]) => getPublicFestival(slug, festivalSlug),
	);
	function follow(event: MouseEvent, path: string) {
		if (
			!props.app ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return;
		event.preventDefault();
		props.app.navigate(path);
	}
	async function enterRegistration(event: MouseEvent) {
		if (
			!props.app ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return;
		event.preventDefault();
		if (entering()) return;
		props.app.parentRegistration.setActiveFestival(
			props.slug,
			props.festivalSlug,
		);
		if (!props.app.customerSession().authenticated) {
			props.app.navigate(
				buildFestivalRegistrationPath(props.slug, props.festivalSlug),
			);
			return;
		}
		setEntering(true);
		setEntryError("");
		try {
			const { children } = await getCustomerChildren(props.slug);
			props.app.navigate(
				children.length > 0
					? buildFestivalRegistrationPath(props.slug, props.festivalSlug)
					: buildOrgCustomerAccountChildrenPath(props.slug),
			);
		} catch {
			setEntryError("Could not load your performers. Please try again.");
		} finally {
			setEntering(false);
		}
	}
	return (
		<section class="org-landing parent-festival-home">
			<Show when={festival.loading}>
				<p class="muted">Loading festival.</p>
			</Show>
			<Show when={festival.error}>
				<p role="alert">Festival not found.</p>
			</Show>
			<Show when={festival()}>
				<div class="parent-page-heading festival-home-heading">
					<p class="eyebrow">
						{festival()?.festival.startDate} – {festival()?.festival.endDate}
					</p>
					<h1>{festival()?.festival.name}</h1>
					<p class="muted">
						A place for young musicians to perform, learn, and grow.
					</p>
				</div>
				<section
					class="festival-home-gateway"
					aria-labelledby="festival-register-heading"
				>
					<h2 id="festival-register-heading">Register</h2>
					<nav
						class="role-banners festival-home-banners"
						aria-label="Audience links"
					>
						<a
							class="role-banner teachers festival-home-banner"
							href={membershipPath}
							onClick={(event) => follow(event, membershipPath)}
						>
							<span>Teachers</span>
							<span
								class="material-symbols-outlined festival-home-arrow"
								aria-hidden="true"
							>
								chevron_right
							</span>
						</a>
						<a
							class="role-banner parents festival-home-banner"
							href={buildFestivalRegistrationPath(
								props.slug,
								props.festivalSlug,
							)}
							onClick={(event) => void enterRegistration(event)}
							aria-busy={entering()}
						>
							<span>Parents</span>
							<span
								class="material-symbols-outlined festival-home-arrow"
								aria-hidden="true"
							>
								chevron_right
							</span>
						</a>
						<a
							class="role-banner volunteers festival-home-banner"
							href={buildFestivalVolunteersPath(props.slug, props.festivalSlug)}
							onClick={(event) =>
								follow(
									event,
									buildFestivalVolunteersPath(props.slug, props.festivalSlug),
								)
							}
						>
							<span>Volunteers</span>
							<span
								class="material-symbols-outlined festival-home-arrow"
								aria-hidden="true"
							>
								chevron_right
							</span>
						</a>
						<a
							class="role-banner accompanists festival-home-banner"
							href={`/org/${props.slug}/accompanist-membership`}
							onClick={(event) =>
								follow(event, `/org/${props.slug}/accompanist-membership`)
							}
						>
							<span>Accompanists</span>
							<span
								class="material-symbols-outlined festival-home-arrow"
								aria-hidden="true"
							>
								chevron_right
							</span>
						</a>
					</nav>
				</section>
				<Show when={entryError()}>
					<p role="alert">{entryError()}</p>
				</Show>
			</Show>
		</section>
	);
}
