import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
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

export function OrganizationSideNavigation(props: {
	slug: string;
	currentRoute?: AppRoute;
	currentPath?: string;
	app: FestivalAppController;
}) {
	const [intermediate, setIntermediate] = createSignal(false);
	const [mobile, setMobile] = createSignal(false);
	onMount(() => {
		const rail = window.matchMedia(
			"(min-width: 761px) and (max-width: 1100px)",
		);
		const compact = window.matchMedia("(max-width: 760px)");
		const update = () => {
			setIntermediate(rail.matches);
			setMobile(compact.matches);
			if (!compact.matches) props.app.setParentNavigationOpen(false);
		};
		update();
		rail.addEventListener("change", update);
		compact.addEventListener("change", update);
		onCleanup(() => {
			rail.removeEventListener("change", update);
			compact.removeEventListener("change", update);
		});
	});
	const collapsed = () =>
		!mobile() && (intermediate() || props.app.parentNavigationCollapsed());
	const festivalSlug = () =>
		props.app.parentRegistration.activeFestival(props.slug);
	const festivalHome = () =>
		festivalSlug()
			? `/org/${props.slug}/festival/${festivalSlug()}`
			: buildOrgRootPath(props.slug);
	const festivalLinks = () => [
		{
			label: "Festival Home",
			icon: "home",
			href: festivalHome(),
			active:
				props.currentRoute?.kind === "festival-public" ||
				props.currentRoute?.kind === "org-root",
		},
		{
			label: "Performers",
			icon: "family_restroom",
			href: buildOrgCustomerAccountChildrenPath(props.slug),
			active: props.currentRoute?.kind === "org-customer-account-children",
		},
		{
			label: "Registration",
			icon: "app_registration",
			href: festivalSlug()
				? buildFestivalRegistrationPath(props.slug, festivalSlug() ?? "")
				: festivalHome(),
			active:
				props.currentRoute?.kind === "festival-register" ||
				props.currentRoute?.kind === "festival-register-class",
		},
		{
			label: "My Registrations",
			icon: "school",
			href: buildOrgCustomerAccountClassesPath(props.slug),
			active: props.currentRoute?.kind === "org-customer-account-classes",
		},
	];
	const accountLinks = () => [
		{
			label: "Memberships",
			icon: "card_membership",
			href: buildOrgCustomerAccountMembershipsPath(props.slug),
			active: props.currentRoute?.kind === "org-customer-account-memberships",
		},
		{
			label: "Contact Information",
			icon: "contact_page",
			href: buildOrgCustomerAccountContactPath(props.slug),
			active: props.currentRoute?.kind === "org-customer-account-contact",
		},
		{
			label: "Order History",
			icon: "receipt_long",
			href: buildOrgCustomerAccountOrdersPath(props.slug),
			active: props.currentRoute?.kind === "org-customer-account-orders",
		},
		{
			label: "Availability",
			icon: "schedule",
			href: buildOrgCustomerAccountAvailabilityPath(props.slug),
			active: props.currentRoute?.kind === "org-customer-account-availability",
		},
	];
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
	return (
		<nav
			id="parent-navigation"
			class="organization-side-navigation parent-side-navigation"
			classList={{
				"is-collapsed": collapsed(),
				"is-open": props.app.parentNavigationOpen(),
			}}
			aria-label="Organization navigation"
		>
			<button
				type="button"
				class="organization-side-navigation-toggle"
				onClick={() =>
					props.app.setParentNavigationCollapsed((value) => !value)
				}
				aria-label={collapsed() ? "Expand navigation" : "Collapse navigation"}
				aria-expanded={!collapsed()}
				aria-controls="parent-navigation"
				title={collapsed() ? "Expand navigation" : "Collapse navigation"}
			>
				<span class="material-symbols-outlined" aria-hidden="true">
					{collapsed() ? "chevron_right" : "chevron_left"}
				</span>
			</button>
			<section class="organization-side-navigation-section">
				<h2>Festival</h2>
				<For each={festivalLinks()}>
					{(link) => (
						<a
							class="org-nav-link"
							classList={{ active: link.active }}
							href={link.href}
							onClick={(event) => follow(event, link.href)}
							aria-label={link.label}
							title={link.label}
							aria-current={link.active ? "page" : undefined}
						>
							<span class="material-symbols-outlined" aria-hidden="true">
								{link.icon}
							</span>
							<span class="organization-side-navigation-label">
								{link.label}
							</span>
							<span class="parent-navigation-tooltip" aria-hidden="true">
								{link.label}
							</span>
						</a>
					)}
				</For>
			</section>
			<section class="organization-side-navigation-section">
				<h2>Account</h2>
				<For each={accountLinks()}>
					{(link) => (
						<a
							class="org-nav-link"
							classList={{ active: link.active }}
							href={link.href}
							onClick={(event) => follow(event, link.href)}
							aria-label={link.label}
							title={link.label}
							aria-current={link.active ? "page" : undefined}
						>
							<span class="material-symbols-outlined" aria-hidden="true">
								{link.icon}
							</span>
							<span class="organization-side-navigation-label">
								{link.label}
							</span>
							<span class="parent-navigation-tooltip" aria-hidden="true">
								{link.label}
							</span>
						</a>
					)}
				</For>
			</section>
			<div class="parent-navigation-footer">
				<Show when={festivalSlug()}>
					<p class="eyebrow">Festival registration</p>
				</Show>
				<a
					class="org-nav-link parent-directory-link"
					href={buildOrgPublicDirectoryPath(props.slug)}
					onClick={(event) =>
						follow(event, buildOrgPublicDirectoryPath(props.slug))
					}
					aria-label="Directory"
					title="Directory"
					aria-current={
						props.currentRoute?.kind === "org-public-directory"
							? "page"
							: undefined
					}
				>
					<span class="material-symbols-outlined" aria-hidden="true">
						groups
					</span>
					<span class="organization-side-navigation-label">Directory</span>
					<span class="parent-navigation-tooltip" aria-hidden="true">
						Directory
					</span>
				</a>
			</div>
		</nav>
	);
}
