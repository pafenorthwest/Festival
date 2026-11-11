import { createEffect, createResource, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
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
} from "../lib/routes.js";
import { Button } from "./Button.js";

interface AppHeaderProps {
	app: FestivalAppController;
}

export function AppHeader(props: AppHeaderProps) {
	const slug = () => {
		const route = props.app.route();
		return isOrganizationPageRoute(route)
			? (route as { slug: string }).slug
			: null;
	};
	const [landing] = createResource(slug, getPublicOrganizationLanding);
	const currentLanding = () =>
		landing()?.organization.slug === slug() ? landing() : undefined;
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
	const cartCount = () =>
		festivalSlug()
			? props.app.parentRegistration
					.workspace(slug() ?? "", festivalSlug() ?? "")
					.cart.itemCount()
			: 0;
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

	function logout() {
		const organizationSlug = slug();
		const session = props.app.customerSession();
		if (organizationSlug && session.authenticated && session.csrfToken) {
			if (
				!window.dispatchEvent(
					new Event("festival:request-sign-out", { cancelable: true }),
				)
			)
				return;
			props.app.parentRegistration.clear(organizationSlug);
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
				<header class="masthead">
					<div>
						<p class="eyebrow">Music Festival Administration</p>
						<Show
							when={props.app.isAdminRoute()}
							fallback={
								<>
									<h1>Festival</h1>
									<p class="lede">General Informtion.</p>
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
					<Show when={festivalSlug()}>
						<a
							class="parent-header-button parent-cart-link"
							classList={{ active: props.app.route().kind === "festival-cart" }}
							href={buildFestivalCartPath(slug() ?? "", festivalSlug() ?? "")}
							onClick={(event) =>
								follow(
									event,
									buildFestivalCartPath(slug() ?? "", festivalSlug() ?? ""),
								)
							}
							aria-label={`Cart, ${cartCount()} registrations`}
							aria-current={
								props.app.route().kind === "festival-cart" ? "page" : undefined
							}
						>
							<span class="material-symbols-outlined" aria-hidden="true">
								shopping_cart
							</span>
							<span class="parent-header-label">Cart</span>
							<span class="parent-cart-count">{cartCount()}</span>
						</a>
					</Show>
					<button
						class="parent-header-button parent-account-button"
						type="button"
						aria-label="Customer account"
						onClick={() =>
							props.app.navigate(
								buildOrgCustomerAccountMembershipsPath(slug() ?? ""),
							)
						}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							person
						</span>
						<span class="parent-header-label">Account</span>
					</button>
					<Show when={!props.app.isCustomerSessionLoading()}>
						<Show
							when={props.app.customerSession().authenticated}
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
