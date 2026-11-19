import { For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { buildOrgPath } from "../lib/routes.js";

interface OrganizationChooserProps {
	app: FestivalAppController;
}

export function OrganizationChooser(props: OrganizationChooserProps) {
	return (
		<section class="panel flow-panel" aria-label="Organization chooser">
			<h2>Choose an organization</h2>
			<Show
				when={props.app.memberships().length > 0}
				fallback={<a href="/">Return to the home page</a>}
			>
				<div class="organization-list">
					<For each={props.app.memberships()}>
						{(membership) => (
							<button
								type="button"
								class="organization-choice"
								data-preload-path={buildOrgPath(membership.organizationSlug)}
								onClick={() =>
									props.app.navigate(buildOrgPath(membership.organizationSlug))
								}
							>
								<strong>{membership.organizationName}</strong>
								<span>{membership.role}</span>
							</button>
						)}
					</For>
				</div>
			</Show>
		</section>
	);
}
