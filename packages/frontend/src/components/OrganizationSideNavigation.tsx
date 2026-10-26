import { createSignal } from "solid-js";
import {
	type AppRoute,
	buildOrgCustomerAccountAvailabilityPath,
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
}) {
	const [collapsed, setCollapsed] = createSignal(startsCollapsed());
	const currentPath = () => props.currentPath ?? getCurrentPath();
	const isCurrent = (path: string) =>
		normalizePath(currentPath()) === normalizePath(path);

	return (
		<nav
			class="organization-side-navigation"
			classList={{ "is-collapsed": collapsed() }}
			aria-label="Organization navigation"
		>
			<button
				type="button"
				class="organization-side-navigation-toggle"
				onClick={() => setCollapsed((current) => !current)}
				aria-label={collapsed() ? "Expand navigation" : "Collapse navigation"}
				title={collapsed() ? "Expand navigation" : "Collapse navigation"}
			>
				<span class="material-symbols-outlined" aria-hidden="true">
					{collapsed() ? "chevron_right" : "chevron_left"}
				</span>
			</button>

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
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						card_membership
					</span>
					<span class="organization-side-navigation-label">Memberships</span>
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
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						contact_page
					</span>
					<span class="organization-side-navigation-label">
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
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						receipt_long
					</span>
					<span class="organization-side-navigation-label">Order History</span>
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
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						school
					</span>
					<span class="organization-side-navigation-label">Classes</span>
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
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						schedule
					</span>
					<span class="organization-side-navigation-label">Availability</span>
				</a>
			</section>

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
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						home
					</span>
					<span class="organization-side-navigation-label">Home</span>
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
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						groups
					</span>
					<span class="organization-side-navigation-label">Directory</span>
				</a>
			</section>
		</nav>
	);
}
