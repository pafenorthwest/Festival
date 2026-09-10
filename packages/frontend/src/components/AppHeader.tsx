import { createEffect, createResource, createSignal, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	customerLandingSignInPath,
	getCustomerSession,
	getPublicOrganizationLanding,
	logoutCustomer,
} from "../lib/api.js";
import { isOrganizationPageRoute } from "../lib/routes.js";
import { Button } from "./Button.js";

interface AppHeaderProps {
	app: FestivalAppController;
}

export function AppHeader(props: AppHeaderProps) {
	const slug = () => {
		const route = props.app.route();
		return isOrganizationPageRoute(route) ? route.slug : null;
	};
	const [customerSession, setCustomerSession] = createSignal<{
		authenticated: boolean;
		csrfToken?: string;
	}>({ authenticated: false });
	const [sessionLoading, setSessionLoading] = createSignal(true);
	const [landing] = createResource(slug, getPublicOrganizationLanding);

	createEffect(() => {
		const organizationSlug = slug();
		if (!organizationSlug) {
			setSessionLoading(false);
			return;
		}
		setSessionLoading(true);
		void getCustomerSession(organizationSlug)
			.then((response) => setCustomerSession(response.session))
			.finally(() => setSessionLoading(false));
	});

	function logout() {
		const organizationSlug = slug();
		const session = customerSession();
		if (organizationSlug && session.authenticated && session.csrfToken)
			logoutCustomer(organizationSlug, session.csrfToken);
	}

	return (
		<Show
			when={isOrganizationPageRoute(props.app.route())}
			fallback={
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
					<Show
						when={props.app.sessionMembership() && !props.app.isAdminRoute()}
					>
						<div class="identity-card">
							<div class="identity-label">Signed in as</div>
							<div>{props.app.session().user?.displayName}</div>
							<div class="identity-email">
								{props.app.session().user?.email}
							</div>
						</div>
					</Show>
					<Show
						when={props.app.sessionMembership() && props.app.isAdminRoute()}
					>
						<div class="masthead-actions">
							<Show when={props.app.isAdminSubRoute()}>
								<Button
									type="button"
									variant="compact-header"
									onClick={props.app.backToAdmin}
								>
									Back to Admin
								</Button>
							</Show>
							<Button
								type="button"
								variant="compact-header"
								onClick={props.app.handleLogout}
								disabled={props.app.isBusy()}
							>
								Log out {props.app.adminUserLabel()}
							</Button>
						</div>
					</Show>
				</header>
			}
		>
			<header class="org-landing-header">
				<div>
					<p class="eyebrow">Music festival</p>
					<h1>{landing()?.organization.name ?? "Organization"}</h1>
				</div>
				<Show when={!sessionLoading()}>
					<Show
						when={customerSession().authenticated}
						fallback={
							<a
								class="customer-auth-button"
								href={customerLandingSignInPath(slug() ?? "")}
							>
								Login
							</a>
						}
					>
						<Button type="button" variant="secondary" onClick={logout}>
							Logout
						</Button>
					</Show>
				</Show>
			</header>
		</Show>
	);
}
