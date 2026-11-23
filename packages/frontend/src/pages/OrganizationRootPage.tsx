import { createResource, For, Show } from "solid-js";
import { getPublicOrganizationLanding } from "../lib/api.js";
import { type AppRoute, buildOrgRootPath } from "../lib/routes.js";

const seasonsByMonth = [
	"winter",
	"winter",
	"spring",
	"spring",
	"spring",
	"summer",
	"summer",
	"summer",
	"fall",
	"fall",
	"fall",
	"winter",
] as const;

interface OrganizationRootPageProps {
	app: { route: () => AppRoute };
}

export function OrganizationRootPage(props: OrganizationRootPageProps) {
	const slug = () => {
		const route = props.app.route();
		return route.kind === "org-root" ? route.slug : undefined;
	};
	const [landing] = createResource(slug, getPublicOrganizationLanding);

	return (
		<section class="org-landing">
			<Show when={landing.loading}>
				<p class="muted">Loading festivals.</p>
			</Show>
			<Show when={landing.error}>
				<p role="alert">This organization is temporarily unavailable.</p>
			</Show>
			<Show
				when={
					Boolean(slug()) && !landing.loading && !landing.error && landing()
				}
				keyed
			>
				{(result) => (
					<Show
						when={result.festivals.length > 0}
						fallback={<p>No festivals are currently scheduled.</p>}
					>
						<nav class="org-festival-banners" aria-label="Upcoming festivals">
							<For each={result.festivals}>
								{(festival) => (
									<a
										class="org-festival-banner"
										data-season={
											seasonsByMonth[Number(festival.startDate.slice(5, 7)) - 1]
										}
										href={`${buildOrgRootPath(result.organization.slug)}/festival/${festival.shortName}`}
									>
										{festival.name}
									</a>
								)}
							</For>
						</nav>
					</Show>
				)}
			</Show>
		</section>
	);
}
