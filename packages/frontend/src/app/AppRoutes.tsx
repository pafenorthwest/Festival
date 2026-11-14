import { Route, type RouteSectionProps, useParams } from "@solidjs/router";
import { AdminOrgProvider } from "../domains/admin-org/AdminOrgContext.js";
import { CustomerIdentityProvider } from "../domains/customer/CustomerIdentityContext.js";
import { ClassRegistrationProvider } from "../domains/registration/ClassRegistrationContext.js";
import { STAFF_ORGANIZATION_CHOOSER_PATH } from "../lib/routes.js";
import { HomePage } from "../pages/HomePage.js";
import { OrganizationChooser } from "../pages/OrganizationChooser.js";
import { adminRoutes, withCat, withDir, withVol } from "./AdminRoutes.js";
import { useFestivalShell } from "./FestivalShellContext.js";
import * as Pages from "./lazyPages.js";

function CustomerIdentityLayout(props: RouteSectionProps) {
	return <CustomerIdentityProvider>{props.children}</CustomerIdentityProvider>;
}

function RegistrationLayout(props: RouteSectionProps) {
	const p = useParams();
	return (
		<ClassRegistrationProvider
			slug={p.slug ?? ""}
			festivalSlug={p.festivalSlug ?? ""}
		>
			{props.children}
		</ClassRegistrationProvider>
	);
}

function publicOrgRoutes() {
	return (
		<>
			<Route
				path="/"
				component={() => (
					<Pages.OrganizationRootPage app={useFestivalShell()} />
				)}
			/>
			<Route
				path="/directory"
				component={withDir((slug) => <Pages.PublicDirectoryPage slug={slug} />)}
			/>
			<Route
				path="/membership"
				component={withDir((_s, app) => <Pages.MembershipPage app={app} />)}
			/>
			<Route
				path="/accompanist-membership"
				component={withDir((slug) => (
					<Pages.AccompanistMembershipPage slug={slug} />
				))}
			/>
			<Route
				path="/checkout-recovery/:token"
				component={() => {
					const p = useParams();
					return (
						<ClassRegistrationProvider
							slug={p.slug ?? ""}
							festivalSlug={p.festivalSlug ?? ""}
						>
							<Pages.CustomerCheckoutRecoveryPage app={useFestivalShell()} />
						</ClassRegistrationProvider>
					);
				}}
			/>
			<Route
				path="/account"
				component={() => (
					<Pages.LegacyCustomerAccountRedirect slug={useParams().slug ?? ""} />
				)}
			/>
			<Route
				path="/account/memberships"
				component={() => (
					<Pages.CustomerAccountMembershipsPage slug={useParams().slug ?? ""} />
				)}
			/>
			<Route
				path="/account/contact"
				component={() => (
					<Pages.CustomerAccountContactPage slug={useParams().slug ?? ""} />
				)}
			/>
			<Route
				path="/account/children"
				component={() => (
					<Pages.CustomerChildrenPage
						slug={useParams().slug ?? ""}
						app={useFestivalShell()}
					/>
				)}
			/>
			<Route
				path="/account/orders"
				component={() => (
					<Pages.CustomerAccountOrdersPage
						app={useFestivalShell()}
						slug={useParams().slug ?? ""}
					/>
				)}
			/>
			<Route
				path="/account/classes"
				component={() => (
					<Pages.CustomerAccountClassesPage slug={useParams().slug ?? ""} />
				)}
			/>
			<Route
				path="/account/availability"
				component={() => (
					<Pages.CustomerAccountAvailabilityPage
						slug={useParams().slug ?? ""}
					/>
				)}
			/>
		</>
	);
}

function regView(view: "workspace" | "class" | "cart") {
	return () => {
		const p = useParams();
		return (
			<Pages.FestivalClassRegistrationPage
				app={useFestivalShell()}
				slug={p.slug ?? ""}
				festivalSlug={p.festivalSlug ?? ""}
				view={view}
				classId={p.classId ? decodeURIComponent(p.classId) : undefined}
			/>
		);
	};
}

function festivalRoutes() {
	return (
		<>
			<Route
				path="/festival/:festivalSlug"
				component={() => {
					const p = useParams();
					return (
						<Pages.FestivalLandingPage
							app={useFestivalShell()}
							slug={p.slug ?? ""}
							festivalSlug={p.festivalSlug ?? ""}
						/>
					);
				}}
			/>
			<Route
				path="/festival/:festivalSlug/volunteers"
				component={withVol((slug, festivalSlug, app) => (
					<Pages.FestivalVolunteersPage
						app={app}
						slug={slug}
						festivalSlug={festivalSlug}
					/>
				))}
			/>
			<Route
				path="/festival/:festivalSlug/register"
				component={RegistrationLayout}
			>
				<Route path="/" component={regView("workspace")} />
				<Route path="/class/:classId" component={regView("class")} />
				<Route path="/cart" component={regView("cart")} />
			</Route>
			<Route
				path="/festival/:festivalSlug/admin"
				component={withCat((slug, festivalSlug, app) => (
					<Pages.FestivalAdminDashboardPage
						app={app}
						slug={slug}
						festivalSlug={festivalSlug}
					/>
				))}
			/>
			<Route
				path="/festival/:festivalSlug/admin/classes"
				component={withCat((slug, festivalSlug, app) => (
					<Pages.FestivalAdminClassesPage
						app={app}
						slug={slug}
						festivalSlug={festivalSlug}
					/>
				))}
			/>
		</>
	);
}

export function AppRoutes() {
	return (
		<>
			<Route
				path="/"
				component={() => {
					const app = useFestivalShell();
					return <HomePage app={app} />;
				}}
			/>
			<Route
				path={STAFF_ORGANIZATION_CHOOSER_PATH}
				component={() => {
					const app = useFestivalShell();
					return <OrganizationChooser app={app} />;
				}}
			/>
			<Route path="/privacy-policy" component={Pages.PrivacyPolicyPage} />
			<Route
				path="/create-organization"
				component={() => (
					<AdminOrgProvider>
						<Pages.CreateOrganizationPage app={useFestivalShell()} />
					</AdminOrgProvider>
				)}
			/>
			<Route
				path="/invite/:token"
				component={() => (
					<AdminOrgProvider>
						<Pages.InviteLandingPage app={useFestivalShell()} />
					</AdminOrgProvider>
				)}
			/>
			<Route
				path={["/org/:slug", "/organizations/:slug"]}
				component={CustomerIdentityLayout}
			>
				{publicOrgRoutes()}
				{festivalRoutes()}
				{adminRoutes()}
			</Route>
		</>
	);
}
