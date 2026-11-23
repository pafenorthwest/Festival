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
			<section class="home-organizations" aria-labelledby="home-organizations">
				<h2 id="home-organizations">Organizations</h2>
				<Show when={organizationList.state === "errored"}>
					<p class="muted" role="status">
						Organizations are temporarily unavailable.
					</p>
				</Show>
				<Show when={organizations()?.length}>
					<nav class="home-organization-grid" aria-label="Member sites">
						<For each={organizations()}>
							{(organization) => (
								<a
									class="home-organization-tile"
									href={buildOrgRootPath(organization.slug)}
									title={organization.name}
									aria-label={organization.name}
								>
									<span class="eyebrow">{organization.slug.toUpperCase()}</span>
									<span class="home-organization-name">
										{organization.name || organization.slug.toUpperCase()}
									</span>
								</a>
							)}
						</For>
					</nav>
				</Show>
			</section>
			<section class="home-join" aria-labelledby="home-join">
				<div>
					<h1 id="home-join">Join Now</h1>
					<p>Sign up with Google or email to start your organization.</p>
					<p>Free to join and use for sign ups before March 10th 2027</p>
				</div>
				<Button
					class="home-primary-action"
					type="button"
					onClick={() => props.app.openSignInModal("create-org")}
				>
					Sign Up
				</Button>
			</section>
			<section class="home-sell" aria-labelledby="home-sell">
				<div>
					<h2 id="home-sell">Run your music festival in one place</h2>
					<ul>
						<li>
							<strong>Online registration and payments.</strong> Families can
							find eligible classes, register performers, and pay online.
						</li>
						<li>
							<strong>Flexible class setup.</strong> Organize classes by
							division and age, and set fees and prerequisites.
						</li>
						<li>
							<strong>Teacher and performer records.</strong> Keep track of
							teacher assignments, performer profiles, and registration history.
						</li>
					</ul>
				</div>
				<figure>
					<img
						src="/festival-registration-preview.jpg"
						width="1629"
						height="1050"
						alt="Festival registration screen with performer, division, and teacher selectors and a list of available classes."
					/>
					<figcaption>Festival registration</figcaption>
				</figure>
			</section>
		</div>
	);
}
