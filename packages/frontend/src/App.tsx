import { Match, Switch } from "solid-js";
import { useFestivalAppController } from "./app/useFestivalAppController.js";
import { AppBanners } from "./components/AppBanners.js";
import { AppHeader } from "./components/AppHeader.js";
import { SignInModal } from "./components/SignInModal.js";
import { OrganizationSideNavigation } from "./components/OrganizationSideNavigation.js";
import { AdminDivisionsPage } from "./pages/AdminDivisionsPage.js";
import { AdminFestivalsPage } from "./pages/AdminFestivalsPage.js";
import { AdminHomePage } from "./pages/AdminHomePage.js";
import { AdminIntegrationsPage } from "./pages/AdminIntegrationsPage.js";
import { AdminMembershipProductsPage } from "./pages/AdminMembershipProductsPage.js";
import { AdminUsersPage } from "./pages/AdminUsersPage.js";
import { CreateOrganizationPage } from "./pages/CreateOrganizationPage.js";
import { CustomerAccountContactPage } from "./pages/CustomerAccountContactPage.js";
import { CustomerAccountMembershipsPage } from "./pages/CustomerAccountMembershipsPage.js";
import { CustomerAccountOrdersPage } from "./pages/CustomerAccountOrdersPage.js";
import { HomePage } from "./pages/HomePage.js";
import { InviteLandingPage } from "./pages/InviteLandingPage.js";
import { LegacyCustomerAccountRedirect } from "./pages/LegacyCustomerAccountRedirect.js";
import { MembershipPage } from "./pages/MembershipPage.js";
import { OrganizationChooser } from "./pages/OrganizationChooser.js";
import { OrganizationRootPage } from "./pages/OrganizationRootPage.js";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage.js";
import { isOrganizationPageRoute } from "./lib/routes.js";

export default function App() {
	const app = useFestivalAppController();
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
				<div class="application-page-content">
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
						<Match when={app.route().kind === "org-membership"}>
							<MembershipPage app={app} />
						</Match>
						<Match when={app.route().kind === "org-customer-account-legacy"}>
							<LegacyCustomerAccountRedirect
								slug={(app.route() as { slug: string }).slug}
							/>
						</Match>
						<Match when={app.route().kind === "org-customer-account-memberships"}>
							<CustomerAccountMembershipsPage
								slug={(app.route() as { slug: string }).slug}
							/>
						</Match>
						<Match when={app.route().kind === "org-customer-account-contact"}>
							<CustomerAccountContactPage
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
