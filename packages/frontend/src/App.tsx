import { Match, Switch } from "solid-js";
import { useFestivalAppController } from "./app/useFestivalAppController.js";
import { AppBanners } from "./components/AppBanners.js";
import { AppHeader } from "./components/AppHeader.js";
import { OrganizationSideNavigation } from "./components/OrganizationSideNavigation.js";
import { SignInModal } from "./components/SignInModal.js";
import { isOrganizationPageRoute } from "./lib/routes.js";
import { AccompanistMembershipPage } from "./pages/AccompanistMembershipPage.js";
import { AdminAccompanistsPage } from "./pages/AdminAccompanistsPage.js";
import { AdminDivisionsPage } from "./pages/AdminDivisionsPage.js";
import { AdminFestivalsPage } from "./pages/AdminFestivalsPage.js";
import { AdminHomePage } from "./pages/AdminHomePage.js";
import { AdminIntegrationsPage } from "./pages/AdminIntegrationsPage.js";
import { AdminMembershipProductsPage } from "./pages/AdminMembershipProductsPage.js";
import { AdminSettingsPage } from "./pages/AdminSettingsPage.js";
import { AdminUsersPage } from "./pages/AdminUsersPage.js";
import { CreateOrganizationPage } from "./pages/CreateOrganizationPage.js";
import { CustomerAccountContactPage } from "./pages/CustomerAccountContactPage.js";
import { CustomerAccountMembershipsPage } from "./pages/CustomerAccountMembershipsPage.js";
import { CustomerAccountOrdersPage } from "./pages/CustomerAccountOrdersPage.js";
import { CustomerChildrenPage } from "./pages/CustomerChildrenPage.js";
import { FestivalAdminClassesPage } from "./pages/FestivalAdminClassesPage.js";
import { FestivalAdminDashboardPage } from "./pages/FestivalAdminDashboardPage.js";
import { FestivalClassRegistrationPage } from "./pages/FestivalClassRegistrationPage.js";
import { FestivalLandingPage } from "./pages/FestivalLandingPage.js";
import { FestivalVolunteersPage } from "./pages/FestivalVolunteersPage.js";
import { HomePage } from "./pages/HomePage.js";
import { InviteLandingPage } from "./pages/InviteLandingPage.js";
import { LegacyCustomerAccountRedirect } from "./pages/LegacyCustomerAccountRedirect.js";
import { MembershipPage } from "./pages/MembershipPage.js";
import { OrganizationChooser } from "./pages/OrganizationChooser.js";
import { OrganizationRootPage } from "./pages/OrganizationRootPage.js";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage.js";
import { VolunteerRolesPage } from "./pages/VolunteerRolesPage.js";

export default function App() {
	const app = useFestivalAppController();
	const isAdminPage = () => app.isAdminRoute();
	const organizationSlug = () => {
		const route = app.route();
		return isOrganizationPageRoute(route)
			? (route as { slug: string }).slug
			: null;
	};

	return (
		<main class="shell">
			<AppHeader app={app} />
			<AppBanners app={app} />
			<OrganizationChooser app={app} />

			<div
				class="application-page-layout"
				classList={{ "organization-page-layout": organizationSlug() !== null }}
			>
				{organizationSlug() && (
					<OrganizationSideNavigation slug={organizationSlug() ?? ""} />
				)}
				<div
					class="application-page-content"
					classList={{ "admin-page-content": isAdminPage() }}
				>
					<Switch>
						<Match
							when={app.route().kind === "home" && !app.shouldShowOrgChooser()}
						>
							<HomePage app={app} />
						</Match>
						<Match when={app.route().kind === "privacy-policy"}>
							<PrivacyPolicyPage />
						</Match>
						<Match when={app.route().kind === "create-org"}>
							<CreateOrganizationPage app={app} />
						</Match>
						<Match when={app.route().kind === "invite"}>
							<InviteLandingPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-root"}>
							<OrganizationRootPage app={app} />
						</Match>
						<Match when={app.route().kind === "festival-public"}>
							<FestivalLandingPage
								slug={(app.route() as { slug: string }).slug}
								festivalSlug={
									(app.route() as { festivalSlug: string }).festivalSlug
								}
							/>
						</Match>
						<Match when={app.route().kind === "festival-register"}>
							<FestivalClassRegistrationPage
								app={app}
								slug={(app.route() as { slug: string }).slug}
								festivalSlug={
									(app.route() as { festivalSlug: string }).festivalSlug
								}
							/>
						</Match>
						<Match when={app.route().kind === "festival-volunteers"}>
							<FestivalVolunteersPage
								app={app}
								slug={(app.route() as { slug: string }).slug}
								festivalSlug={
									(app.route() as { festivalSlug: string }).festivalSlug
								}
							/>
						</Match>
						<Match when={app.route().kind === "festival-admin"}>
							<FestivalAdminDashboardPage
								app={app}
								slug={(app.route() as { slug: string }).slug}
								festivalSlug={
									(app.route() as { festivalSlug: string }).festivalSlug
								}
							/>
						</Match>
						<Match when={app.route().kind === "festival-admin-classes"}>
							<FestivalAdminClassesPage
								app={app}
								slug={(app.route() as { slug: string }).slug}
								festivalSlug={
									(app.route() as { festivalSlug: string }).festivalSlug
								}
							/>
						</Match>
						<Match when={app.route().kind === "org-membership"}>
							<MembershipPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-accompanist-membership"}>
							<AccompanistMembershipPage
								slug={(app.route() as { slug: string }).slug}
							/>
						</Match>
						<Match when={app.route().kind === "org-customer-account-legacy"}>
							<LegacyCustomerAccountRedirect
								slug={(app.route() as { slug: string }).slug}
							/>
						</Match>
						<Match
							when={app.route().kind === "org-customer-account-memberships"}
						>
							<CustomerAccountMembershipsPage
								slug={(app.route() as { slug: string }).slug}
							/>
						</Match>
						<Match when={app.route().kind === "org-customer-account-contact"}>
							<CustomerAccountContactPage
								slug={(app.route() as { slug: string }).slug}
							/>
						</Match>
						<Match when={app.route().kind === "org-customer-account-children"}>
							<CustomerChildrenPage
								slug={(app.route() as { slug: string }).slug}
							/>
						</Match>
						<Match when={app.route().kind === "org-customer-account-orders"}>
							<CustomerAccountOrdersPage
								slug={(app.route() as { slug: string }).slug}
							/>
						</Match>
						<Match when={app.route().kind === "org-admin"}>
							<AdminHomePage app={app} />
						</Match>
						<Match when={app.route().kind === "org-admin-users"}>
							<AdminUsersPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-admin-integrations"}>
							<AdminIntegrationsPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-admin-memberships"}>
							<AdminMembershipProductsPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-admin-festivals"}>
							<AdminFestivalsPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-admin-divisions"}>
							<AdminDivisionsPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-admin-settings"}>
							<AdminSettingsPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-admin-accompanists"}>
							<AdminAccompanistsPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-admin-volunteers"}>
							<VolunteerRolesPage
								app={app}
								slug={(app.route() as { slug: string }).slug}
							/>
						</Match>
					</Switch>
				</div>
			</div>
			<footer class="site-footer">
				<a href="/privacy-policy">Privacy Policy</a>
			</footer>

			<SignInModal app={app} />
		</main>
	);
}
