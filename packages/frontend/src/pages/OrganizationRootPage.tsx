import { createResource, For, Show } from "solid-js";
import { getPublicOrganizationLanding } from "../lib/api.js";

interface OrganizationRootPageProps {
	app: { route: () => { kind: string; slug?: string } };
}

export function OrganizationRootPage(props: OrganizationRootPageProps) {
	const slug = () => props.app.route().slug ?? "";
	const [landing] = createResource(slug, getPublicOrganizationLanding);

	return (
		<section class="org-landing">
			<Show when={landing.loading}>
				<p class="muted">Loading upcoming festivals.</p>
			</Show>
			<Show when={landing.error}>
				<p role="alert">This organization is temporarily unavailable.</p>
			</Show>
			<Show when={landing()}>
				<section class="upcoming-festivals">
					<h2>Upcoming festivals</h2>
					<Show
						when={(landing()?.festivals.length ?? 0) > 0}
						fallback={<p class="muted">No upcoming festivals are scheduled.</p>}
					>
						<ul>
							<For each={landing()?.festivals ?? []}>
								{(festival) => (
									<li>
										<strong>{festival.name}</strong>
										<span>
											{festival.startDate}
											{festival.endDate !== festival.startDate
												? ` – ${festival.endDate}`
												: ""}
										</span>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</section>
				<h2>Register</h2>
				<nav class="role-banners" aria-label="Audience links">
					<a class="role-banner teachers" href={`/org/${slug()}/membership`}>
						Teachers
					</a>
					<a class="role-banner parents" href="/classes">
						Parents
					</a>
					<a class="role-banner volunteers" href="/sign-up">
						Volunteers
					</a>
					<a
						class="role-banner accompanists"
						href={`/org/${slug()}/membership`}
					>
						Accompanists
					</a>
				</nav>
				<a
					class="button secondary-button compact-header-button all-memberships-link"
					href={`/org/${slug()}/membership`}
				>
					All Memberships
				</a>
			</Show>
		</section>
	);
}
