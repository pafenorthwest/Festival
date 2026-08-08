import { Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";

interface AppHeaderProps {
	app: FestivalAppController;
}

export function AppHeader(props: AppHeaderProps) {
	return (
		<header class="masthead">
			<div>
				<p class="eyebrow">Music Festival Administration</p>
				<Show
					when={props.app.isAdminRoute()}
					fallback={
						<>
							<h1>Get Started.</h1>
							<p class="lede">Sign up to get started.</p>
						</>
					}
				>
					<h1>{props.app.adminBreadcrumb()}</h1>
				</Show>
			</div>
			<Show when={props.app.sessionMembership() && !props.app.isAdminRoute()}>
				<div class="identity-card">
					<div class="identity-label">Signed in as</div>
					<div>{props.app.session().user?.displayName}</div>
					<div class="identity-email">{props.app.session().user?.email}</div>
				</div>
			</Show>
			<Show when={props.app.sessionMembership() && props.app.isAdminRoute()}>
				<div class="masthead-actions">
					<Show when={props.app.isAdminSubRoute()}>
						<button
							type="button"
							class="secondary-button compact-header-button"
							onClick={props.app.backToAdmin}
						>
							Back to Admin
						</button>
					</Show>
					<button
						type="button"
						class="secondary-button compact-header-button"
						onClick={props.app.handleLogout}
						disabled={props.app.isBusy()}
					>
						Log out {props.app.adminUserLabel()}
					</button>
				</div>
			</Show>
		</header>
	);
}
