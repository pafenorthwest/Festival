import type { PublicOrganizationLandingResponse } from "@festival/common";
import { createEffect, createResource, type Resource, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { useCustomerIdentity } from "../domains/customer/CustomerIdentityContext.js";
import {
	customerLandingSignInPath,
	getPublicOrganizationLanding,
	logoutCustomer,
} from "../lib/api.js";
import {
	buildFestivalCartPath,
	buildOrgCustomerAccountMembershipsPath,
	buildOrgPath,
	buildOrgRootPath,
	isOrganizationPageRoute,
	STAFF_ORGANIZATION_CHOOSER_PATH,
} from "../lib/routes.js";
import { Button } from "./Button.js";

interface AppHeaderProps {
	app: FestivalAppController;
}

/**
 * Solid 1.9 resources throw when read in the errored state, so only read
 * the value once the resource is ready for the active organization slug.
 */
export function readReadyOrganizationLanding(
	resource: Resource<PublicOrganizationLandingResponse>,
	expectedSlug: string | null,
): PublicOrganizationLandingResponse | undefined {
	if (expectedSlug !== null && resource.state === "ready" && !resource.error) {
		const value = resource();
		return value?.organization.slug === expectedSlug ? value : undefined;
	}
	return undefined;
}

export function AppHeader(props: AppHeaderProps) {
	const customerIdentity = useCustomerIdentity();
	const isHome = () => props.app.route().kind === "home";
	const slug = () => {
		const route = props.app.route();
		return isOrganizationPageRoute(route)
			? (route as { slug: string }).slug
			: null;
	};
	const [landing] = createResource(slug, getPublicOrganizationLanding);
	const currentLanding = () => readReadyOrganizationLanding(landing, slug());
	const festivalSlug = () => {
		const route = props.app.route();
		return "festivalSlug" in route
			? route.festivalSlug
			: props.app.parentRegistration.activeFestival(slug() ?? "");
	};
	createEffect(() => {
		const organizationSlug = slug();
		const primary = currentLanding()?.festivals.find(
			(festival) => festival.isPrimary,
		);
		if (
			organizationSlug &&
			primary &&
			!props.app.parentRegistration.activeFestival(organizationSlug)
		) {
			props.app.parentRegistration.setActiveFestival(
				organizationSlug,
				primary.shortName,
			);
		}
	});
	const festival = () =>
		currentLanding()?.festivals.find(
			(entry) => entry.shortName === festivalSlug(),
		);
	const homePath = () =>
		festivalSlug()
			? `/org/${slug()}/festival/${festivalSlug()}`
			: buildOrgRootPath(slug() ?? "");
	const pendingCheckout = customerIdentity.pendingCheckout;
	const hasPendingCheckout = () =>
		customerIdentity.customerSession().authenticated &&
		pendingCheckout.ownerSlug() === slug() &&
		pendingCheckout.isBlocked();
	const cartFestivalSlug = () =>
		(hasPendingCheckout()
			? pendingCheckout.checkout()?.festivalShortName
			: null) ?? festivalSlug();
	const cartPath = () =>
		buildFestivalCartPath(slug() ?? "", cartFestivalSlug() ?? "");
	const accountPath = () =>
		buildOrgCustomerAccountMembershipsPath(slug() ?? "");
	const cartCount = () => {
		if (hasPendingCheckout()) {
			return pendingCheckout.checkout()?.registrationCount ?? null;
		}
		return festivalSlug()
			? props.app.parentRegistration
					.workspace(slug() ?? "", festivalSlug() ?? "")
					.cart.itemCount()
			: 0;
	};
	const cartLabel = () =>
		cartCount() === null
			? "Cart, checkout status needs checking"
			: `Cart, ${cartCount()} registrations`;
	function follow(event: MouseEvent, path: string) {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return;
		event.preventDefault();
		props.app.navigate(path);
	}

	function staffAdminPath() {
		if (!isHome() || !props.app.session().authenticated) {
			return null;
		}
		const memberships = props.app.memberships();
		if (memberships.length > 1) return STAFF_ORGANIZATION_CHOOSER_PATH;
		const [membership] = memberships;
		return membership ? buildOrgPath(membership.organizationSlug) : null;
	}

	function logout() {
		const organizationSlug = slug();
		const session = customerIdentity.customerSession();
		if (organizationSlug && session.authenticated && session.csrfToken) {
			if (
				!window.dispatchEvent(
					new Event("festival:request-sign-out", { cancelable: true }),
				)
			)
				return;
			props.app.parentRegistration.clear(organizationSlug);
			pendingCheckout.clearOrganization(organizationSlug);
			logoutCustomer(organizationSlug, session.csrfToken);
		}
	}

	function login() {
		const organizationSlug = slug();
		if (!organizationSlug) return;
		window.location.assign(customerLandingSignInPath(organizationSlug));
	}

	return (
		<Show
			when={isOrganizationPageRoute(props.app.route())}
			fallback={
				<header class="masthead" classList={{ "home-masthead": isHome() }}>
					<div>
						<p class="eyebrow">
							{isHome()
								? "Manage and Grow Your Music Festival"
								: "Music Festival Administration"}
						</p>
						<Show
							when={isHome()}
							fallback={
								<Show
									when={props.app.isAdminRoute()}
									fallback={<h1>Festival</h1>}
								>
									<h1>{props.app.adminBreadcrumb()}</h1>
								</Show>
							}
						>
							<p class="home-brand">Arts Festival Online</p>
						</Show>
					</div>
					<Show when={isHome() && !props.app.sessionMembership()}>
						<Button
							class="home-primary-action"
							type="button"
							onClick={() => props.app.openSignInModal("login")}
						>
							Log-In
						</Button>
					</Show>
					<Show
						when={props.app.sessionMembership() && !props.app.isAdminRoute()}
					>
						<div class="identity-card">
							<div class="identity-label">Signed in as</div>
							<div>{props.app.session().user?.displayName}</div>
							<div class="identity-email">
								{props.app.session().user?.email}
							</div>
							<Show when={staffAdminPath()} keyed>
								{(path) => (
									<a
										class="home-admin-link"
										href={path}
										data-preload-path={path}
									>
										Admin
									</a>
								)}
							</Show>
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
									data-preload-path={
										props.app.sessionMembership()
											? buildOrgPath(
													props.app.sessionMembership()?.organizationSlug ?? "",
												)
											: undefined
									}
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
			<header class="org-landing-header parent-header">
				<a
					class="parent-brand"
					href={homePath()}
					onClick={(event) => follow(event, homePath())}
					aria-label="Festival Home"
				>
					<span class="parent-brand-mark">
						{(slug() ?? "PAFE").slice(0, 5).toUpperCase()}
					</span>
					<span class="parent-brand-copy">
						{currentLanding()?.organization.name ?? "Music Festival"}
					</span>
				</a>
				<Show when={festival()}>
					{(current) => (
						<div class="parent-header-festival">
							<span class="eyebrow">Current festival</span>
							<span>{current().name}</span>
						</div>
					)}
				</Show>
				<div class="org-landing-actions parent-header-actions">
					<Show when={cartFestivalSlug()}>
						<a
							class="parent-header-button parent-cart-link"
							classList={{ active: props.app.route().kind === "festival-cart" }}
							href={cartPath()}
							onClick={(event) => follow(event, cartPath())}
							aria-label={cartLabel()}
							aria-current={
								props.app.route().kind === "festival-cart" ? "page" : undefined
							}
						>
							<span class="material-symbols-outlined" aria-hidden="true">
								shopping_cart
							</span>
							<span class="parent-header-label">Cart</span>
							<span class="parent-cart-count">
								{cartCount() ?? (pendingCheckout.isChecking() ? "…" : "?")}
							</span>
						</a>
					</Show>
					<a
						class="parent-header-button parent-account-button"
						classList={{
							active: props.app
								.route()
								.kind.startsWith("org-customer-account-"),
						}}
						href={accountPath()}
						onClick={(event) => follow(event, accountPath())}
						aria-label="Customer account"
						aria-current={
							props.app.route().kind.startsWith("org-customer-account-")
								? "page"
								: undefined
						}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							person
						</span>
						<span class="parent-header-label">Account</span>
					</a>
					<Show when={!customerIdentity.isCustomerSessionLoading()}>
						<Show
							when={customerIdentity.customerSession().authenticated}
							fallback={
								<Button
									type="button"
									variant="compact-header"
									class="customer-auth-button parent-header-button"
									onClick={login}
									aria-label="Sign in"
								>
									<span class="material-symbols-outlined" aria-hidden="true">
										login
									</span>
									<span class="parent-header-label">Sign in</span>
								</Button>
							}
						>
							<Button
								type="button"
								variant="compact-header"
								class="customer-auth-button parent-header-button"
								onClick={logout}
								aria-label="Sign out"
							>
								<span class="material-symbols-outlined" aria-hidden="true">
									logout
								</span>
								<span class="parent-header-label">Sign out</span>
							</Button>
						</Show>
					</Show>
					<button
						class="parent-header-button parent-menu-toggle"
						type="button"
						aria-label={
							props.app.parentNavigationOpen()
								? "Close navigation"
								: "Open navigation"
						}
						aria-expanded={props.app.parentNavigationOpen()}
						aria-controls="parent-navigation"
						onClick={() => props.app.setParentNavigationOpen((open) => !open)}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							menu
						</span>
					</button>
				</div>
			</header>
		</Show>
	);
}
