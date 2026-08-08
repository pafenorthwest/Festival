import { For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { buildOrgPath } from "../lib/routes.js";

interface OrganizationChooserProps {
	app: FestivalAppController;
}

export function OrganizationChooser(props: OrganizationChooserProps) {
	return (
		<Show when={props.app.shouldShowOrgChooser()}>
			<section class="panel flow-panel" aria-label="Organization chooser">
				<h2>Choose an organization</h2>
				<p>Select the organization workspace you want to enter.</p>
				<div class="organization-list">
					<For each={props.app.memberships()}>
						{(membership) => (
							<button
								type="button"
								class="organization-choice"
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
			</section>
		</Show>
	);
}
