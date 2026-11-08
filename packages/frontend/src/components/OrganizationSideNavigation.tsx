import { createSignal, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	type AppRoute,
	buildFestivalRegistrationPath,
	buildOrgCustomerAccountAvailabilityPath,
	buildOrgCustomerAccountChildrenPath,
	buildOrgCustomerAccountClassesPath,
	buildOrgCustomerAccountContactPath,
	buildOrgCustomerAccountMembershipsPath,
	buildOrgCustomerAccountOrdersPath,
	buildOrgPublicDirectoryPath,
	buildOrgRootPath,
} from "../lib/routes.js";

function startsCollapsed() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(max-width: 720px)").matches
	);
}

function getCurrentPath(): string {
	if (typeof window === "undefined") {
		return "";
	}
	return window.location.pathname;
}

function normalizePath(path: string): string {
	return path.replace(/\/+$/, "");
}

export function OrganizationSideNavigation(props: {
	slug: string;
	currentRoute?: AppRoute;
	currentPath?: string;
	app?: FestivalAppController;
}) {
	const [localCollapsed, setLocalCollapsed] = createSignal(startsCollapsed());
	const isCollapsed = () =>
		props.app ? props.app.isNavCollapsed() : localCollapsed();
	const toggleCollapsed = () => {
		if (props.app) {
			props.app.toggleNavCollapsed();
		} else {
			setLocalCollapsed((current) => !current);
		}
	};
	const currentPath = () => props.currentPath ?? getCurrentPath();
	const isCurrent = (path: string) =>
		normalizePath(currentPath()) === normalizePath(path);

	const festivalSlug = () => {
		if (props.app?.activeFestivalSlug()) {
			return props.app.activeFestivalSlug();
		}
		const route = props.currentRoute;
		if (route && "festivalSlug" in route && route.festivalSlug) {
			return route.festivalSlug;
		}
		return null;
	};

	const registrationHref = () => {
		const fSlug = festivalSlug();
		return fSlug
			? buildFestivalRegistrationPath(props.slug, fSlug)
			: `/org/${props.slug}/festival/register`;
	};

	const closeNav = () => {
		props.app?.closeNavOpen();
	};

	return (
		<>
			<Show when={props.app?.isNavOpen()}>
				<div class="nav-mobile-overlay" onClick={closeNav} aria-hidden="true" />
			</Show>

			<nav
				class="organization-side-navigation"
				classList={{
					"is-collapsed": isCollapsed(),
					"nav-open": Boolean(props.app?.isNavOpen()),
				}}
				aria-label="Organization navigation"
			>
				<button
					type="button"
					class="organization-side-navigation-toggle"
					onClick={toggleCollapsed}
					aria-label={
						isCollapsed() ? "Expand navigation" : "Collapse navigation"
					}
					title={isCollapsed() ? "Expand navigation" : "Collapse navigation"}
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						{isCollapsed() ? "chevron_right" : "chevron_left"}
					</span>
				</button>

				<section class="organization-side-navigation-section">
					<h2>Festival</h2>
					<a
						class="org-nav-link"
						href={buildOrgRootPath(props.slug)}
						aria-label="Home"
						aria-current={
							isCurrent(buildOrgRootPath(props.slug)) ? "page" : undefined
						}
						classList={{
							active: isCurrent(buildOrgRootPath(props.slug)),
						}}
						onClick={closeNav}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							home
						</span>
						<span class="organization-side-navigation-label">Home</span>
						<span class="nav-tooltip" role="tooltip">
							Home
						</span>
					</a>
					<a
						class="org-nav-link"
						href={buildOrgPublicDirectoryPath(props.slug)}
						aria-label="Directory"
						classList={{
							active:
								props.currentRoute?.kind === "org-public-directory" ||
								isCurrent(buildOrgPublicDirectoryPath(props.slug)),
						}}
						aria-current={
							props.currentRoute?.kind === "org-public-directory" ||
							isCurrent(buildOrgPublicDirectoryPath(props.slug))
								? "page"
								: undefined
						}
						onClick={closeNav}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							groups
						</span>
						<span class="organization-side-navigation-label">Directory</span>
						<span class="nav-tooltip" role="tooltip">
							Directory
						</span>
					</a>
					<a
						class="org-nav-link"
						href={buildOrgCustomerAccountChildrenPath(props.slug)}
						aria-label="Performers"
						classList={{
							active:
								props.currentRoute?.kind === "org-customer-account-children" ||
								isCurrent(buildOrgCustomerAccountChildrenPath(props.slug)),
						}}
						aria-current={
							props.currentRoute?.kind === "org-customer-account-children" ||
							isCurrent(buildOrgCustomerAccountChildrenPath(props.slug))
								? "page"
								: undefined
						}
						onClick={closeNav}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							face
						</span>
						<span class="organization-side-navigation-label">Performers</span>
						<span class="nav-tooltip" role="tooltip">
							Performers
						</span>
					</a>
					<a
						class="org-nav-link"
						href={registrationHref()}
						aria-label="Registration"
						classList={{
							active:
								props.currentRoute?.kind === "festival-register" ||
								isCurrent(registrationHref()),
						}}
						aria-current={
							props.currentRoute?.kind === "festival-register" ||
							isCurrent(registrationHref())
								? "page"
								: undefined
						}
						onClick={closeNav}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							how_to_reg
						</span>
						<span class="organization-side-navigation-label">Registration</span>
						<span class="nav-tooltip" role="tooltip">
							Registration
						</span>
					</a>
					<a
						class="org-nav-link"
						href={buildOrgCustomerAccountClassesPath(props.slug)}
						aria-label="Classes"
						aria-current={
							isCurrent(buildOrgCustomerAccountClassesPath(props.slug))
								? "page"
								: undefined
						}
						classList={{
							active: isCurrent(buildOrgCustomerAccountClassesPath(props.slug)),
						}}
						onClick={closeNav}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							school
						</span>
						<span class="organization-side-navigation-label">
							My Registrations
						</span>
						<span class="nav-tooltip" role="tooltip">
							My Registrations
						</span>
					</a>
				</section>

				<section class="organization-side-navigation-section">
					<h2>Accounts</h2>
					<a
						class="org-nav-link"
						href={buildOrgCustomerAccountMembershipsPath(props.slug)}
						aria-label="Memberships"
						aria-current={
							isCurrent(buildOrgCustomerAccountMembershipsPath(props.slug))
								? "page"
								: undefined
						}
						classList={{
							active: isCurrent(
								buildOrgCustomerAccountMembershipsPath(props.slug),
							),
						}}
						onClick={closeNav}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							card_membership
						</span>
						<span class="organization-side-navigation-label">Memberships</span>
						<span class="nav-tooltip" role="tooltip">
							Memberships
						</span>
					</a>
					<a
						class="org-nav-link"
						href={buildOrgCustomerAccountContactPath(props.slug)}
						aria-label="Contact Information"
						aria-current={
							isCurrent(buildOrgCustomerAccountContactPath(props.slug))
								? "page"
								: undefined
						}
						classList={{
							active: isCurrent(buildOrgCustomerAccountContactPath(props.slug)),
						}}
						onClick={closeNav}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							contact_page
						</span>
						<span class="organization-side-navigation-label">
							Contact Information
						</span>
						<span class="nav-tooltip" role="tooltip">
							Contact Information
						</span>
					</a>
					<a
						class="org-nav-link"
						href={buildOrgCustomerAccountOrdersPath(props.slug)}
						aria-label="Order History"
						aria-current={
							isCurrent(buildOrgCustomerAccountOrdersPath(props.slug))
								? "page"
								: undefined
						}
						classList={{
							active: isCurrent(buildOrgCustomerAccountOrdersPath(props.slug)),
						}}
						onClick={closeNav}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							receipt_long
						</span>
						<span class="organization-side-navigation-label">
							Order History
						</span>
						<span class="nav-tooltip" role="tooltip">
							Order History
						</span>
					</a>
					<a
						class="org-nav-link"
						href={buildOrgCustomerAccountAvailabilityPath(props.slug)}
						aria-label="Availability"
						aria-current={
							isCurrent(buildOrgCustomerAccountAvailabilityPath(props.slug))
								? "page"
								: undefined
						}
						classList={{
							active: isCurrent(
								buildOrgCustomerAccountAvailabilityPath(props.slug),
							),
						}}
						onClick={closeNav}
					>
						<span class="material-symbols-outlined" aria-hidden="true">
							schedule
						</span>
						<span class="organization-side-navigation-label">Availability</span>
						<span class="nav-tooltip" role="tooltip">
							Availability
						</span>
					</a>
				</section>
			</nav>
		</>
	);
}
