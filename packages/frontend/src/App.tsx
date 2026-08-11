import { Match, Switch } from "solid-js";
import { useFestivalAppController } from "./app/useFestivalAppController.js";
import { AppBanners } from "./components/AppBanners.js";
import { AppHeader } from "./components/AppHeader.js";
import { SignInModal } from "./components/SignInModal.js";
import { AdminFestivalsPage } from "./pages/AdminFestivalsPage.js";
import { AdminHomePage } from "./pages/AdminHomePage.js";
import { AdminIntegrationsPage } from "./pages/AdminIntegrationsPage.js";
import { AdminUsersPage } from "./pages/AdminUsersPage.js";
import { CreateOrganizationPage } from "./pages/CreateOrganizationPage.js";
import { HomePage } from "./pages/HomePage.js";
import { InviteLandingPage } from "./pages/InviteLandingPage.js";
import { MembershipPage } from "./pages/MembershipPage.js";
import { OrganizationChooser } from "./pages/OrganizationChooser.js";
import { OrganizationRootPage } from "./pages/OrganizationRootPage.js";

export default function App() {
	const app = useFestivalAppController();

	return (
		<main class="shell">
			<AppHeader app={app} />
			<AppBanners app={app} />
			<OrganizationChooser app={app} />

			<Switch>
				<Match
					when={app.route().kind === "home" && !app.shouldShowOrgChooser()}
				>
					<HomePage app={app} />
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
				<Match when={app.route().kind === "org-admin"}>
					<AdminHomePage app={app} />
				</Match>
				<Match when={app.route().kind === "org-admin-users"}>
					<AdminUsersPage app={app} />
				</Match>
				<Match when={app.route().kind === "org-admin-integrations"}>
					<AdminIntegrationsPage app={app} />
				</Match>
				<Match when={app.route().kind === "org-admin-festivals"}>
					<AdminFestivalsPage app={app} />
				</Match>
			</Switch>

			<SignInModal app={app} />
		</main>
	);
}
