import { createSignal } from "solid-js";
import {
	buildOrgCustomerAccountContactPath,
	buildOrgCustomerAccountMembershipsPath,
	buildOrgCustomerAccountOrdersPath,
	buildOrgRootPath,
} from "../lib/routes.js";

function startsCollapsed() {
	return typeof window !== "undefined" &&
		window.matchMedia("(max-width: 720px)").matches;
}

export function OrganizationSideNavigation(props: { slug: string }) {
	const [collapsed, setCollapsed] = createSignal(startsCollapsed());

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
					href={buildOrgCustomerAccountMembershipsPath(props.slug)}
					aria-label="Memberships"
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						card_membership
					</span>
					<span class="organization-side-navigation-label">Memberships</span>
				</a>
				<a
					href={buildOrgCustomerAccountContactPath(props.slug)}
					aria-label="Contact Information"
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						contact_page
					</span>
					<span class="organization-side-navigation-label">
						Contact Information
					</span>
				</a>
				<a
					href={buildOrgCustomerAccountOrdersPath(props.slug)}
					aria-label="Order History"
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						receipt_long
					</span>
					<span class="organization-side-navigation-label">Order History</span>
				</a>
			</section>

			<section class="organization-side-navigation-section">
				<h2>Festival</h2>
				<a href={buildOrgRootPath(props.slug)} aria-label="Home">
					<span class="material-symbols-outlined" aria-hidden="true">
						home
					</span>
					<span class="organization-side-navigation-label">Home</span>
				</a>
			</section>
		</nav>
	);
}
