import type { FestivalAppController } from "../app/useFestivalAppController.js";

interface OrganizationRootPageProps {
	app: FestivalAppController;
}

export function OrganizationRootPage(props: OrganizationRootPageProps) {
	return (
		<section class="panel org-shell">
			<header class="org-header">
				<h1 class="org-title">
					Reserved Root Page for{" "}
					{props.app.organization()?.name ??
						props.app.sessionMembership()?.organizationName}
				</h1>
				<button
					type="button"
					class="secondary-button"
					onClick={props.app.handleLogout}
					disabled={props.app.isBusy()}
				>
					Log out
				</button>
			</header>
		</section>
	);
}
