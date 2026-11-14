import { createResource, For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import { listPublicOrganizations } from "../lib/api.js";
import { buildOrgRootPath } from "../lib/routes.js";

interface HomePageProps {
	app: FestivalAppController;
}

export function HomePage(props: HomePageProps) {
	const [organizationList] = createResource(listPublicOrganizations);
	const organizations = () =>
		organizationList.state === "ready"
			? organizationList()?.organizations
			: undefined;

	return (
		<div class="home-page">
			<Show when={organizationList.state === "errored"}>
				<p class="muted" role="status">
					Organizations are temporarily unavailable.
				</p>
			</Show>
			<Show when={organizations()?.length}>
				<nav class="home-organization-grid" aria-label="Organizations">
					<For each={organizations()}>
						{(organization) => (
							<a
								class="home-organization-tile"
								href={buildOrgRootPath(organization.slug)}
							>
								{organization.slug.toUpperCase()}
							</a>
						)}
					</For>
				</nav>
				<hr class="home-organization-divider" />
			</Show>
			<section class="panel hero-panel">
				<h1>Start a new organization</h1>
				<p>Sign up here with Google or Email to create a new organization</p>
				<div class="hero-actions">
					<Button
						type="button"
						onClick={() => props.app.openSignInModal("create-org")}
					>
						Sign Up or Sign In
					</Button>
				</div>
			</section>
		</div>
	);
}
