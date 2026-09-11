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
		return route.kind === "org-root" ||
			route.kind === "org-membership" ||
			route.kind === "org-customer-account-legacy" ||
			route.kind === "org-customer-account-memberships" ||
			route.kind === "org-customer-account-contact" ||
			route.kind === "org-customer-account-orders"
			? route.slug
			: null;
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

	function login() {
		window.location.assign(customerLandingSignInPath(slug() ?? ""));
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
				<div class="org-landing-actions">
					<a class="org-landing-home-link" href={`/org/${slug() ?? ""}`}>
						Home
					</a>
					<a
						class="customer-account-link"
						classList={{ "is-authenticated": customerSession().authenticated }}
						href={`/org/${slug() ?? ""}/account/memberships`}
						aria-label="Customer account"
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							person
						</span>
						<span class="sr-only">Customer account</span>
					</a>
					<Show when={!sessionLoading()}>
						<Show
							when={customerSession().authenticated}
							fallback={
								<Button
									type="button"
									variant="compact-header"
									class="customer-auth-button"
									onClick={login}
								>
									Login
								</Button>
							}
						>
							<Button
								type="button"
								variant="compact-header"
								class="customer-auth-button"
								onClick={logout}
							>
								Logout
							</Button>
						</Show>
					</Show>
				</div>
			</header>
		</Show>
	);
}
