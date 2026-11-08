import {
	createEffect,
	createMemo,
	ErrorBoundary,
	Match,
	on,
	Show,
	Suspense,
	Switch,
} from "solid-js";
import {
	AccompanistMembershipPage,
	AdminAccompanistsPage,
	AdminCheckoutRecoveryPage,
	AdminDivisionsPage,
	AdminFestivalsPage,
	AdminHomePage,
	AdminIntegrationsPage,
	AdminMembershipProductsPage,
	AdminRoomsPage,
	AdminRosterPage,
	AdminSettingsPage,
	AdminUsersPage,
	BillingReconciliationPage,
	CommunicationTemplatesPage,
	CreateOrganizationPage,
	CustomerAccountAvailabilityPage,
	CustomerAccountClassesPage,
	CustomerAccountContactPage,
	CustomerAccountMembershipsPage,
	CustomerAccountOrdersPage,
	CustomerCheckoutRecoveryPage,
	CustomerChildrenPage,
	FestivalAdminClassesPage,
	FestivalAdminDashboardPage,
	FestivalClassRegistrationPage,
	FestivalLandingPage,
	FestivalVolunteersPage,
	InviteLandingPage,
	LegacyCustomerAccountRedirect,
	MembershipPage,
	MusicReviewPage,
	OrganizationRootPage,
	PrivacyPolicyPage,
	PublicDirectoryPage,
	VolunteerRolesPage,
} from "./app/lazyPages.js";
import { preloadNavigation } from "./app/navigationPreload.js";
import { useFestivalAppController } from "./app/useFestivalAppController.js";
import { AppBanners } from "./components/AppBanners.js";
import { AppHeader } from "./components/AppHeader.js";
import { OrganizationSideNavigation } from "./components/OrganizationSideNavigation.js";
import { SignInModal } from "./components/SignInModal.js";
import { isOrganizationPageRoute } from "./lib/routes.js";
import { HomePage } from "./pages/HomePage.js";
import { OrganizationChooser } from "./pages/OrganizationChooser.js";

export default function App() {
	const app = useFestivalAppController();
	const isAdminPage = () => app.isAdminRoute();
	const organizationSlug = () => {
		const route = app.route();
		return isOrganizationPageRoute(route)
			? (route as { slug: string }).slug
			: null;
	};
	const registrationContext = createMemo(() => {
		const route = app.route();
		return route.kind === "festival-register" ||
			route.kind === "festival-register-class" ||
			route.kind === "festival-cart"
			? `${route.slug}/${route.festivalSlug}`
			: null;
	});

	return (
		<main
			class="shell"
			classList={{ "parent-shell": organizationSlug() !== null }}
			onPointerOver={preloadNavigation}
			onFocusIn={preloadNavigation}
		>
			<AppHeader app={app} />
			<AppBanners app={app} />
			<OrganizationChooser app={app} />

			<div
				class="application-page-layout"
				classList={{
					"organization-page-layout": organizationSlug() !== null,
					"parent-page-layout": organizationSlug() !== null,
					"is-navigation-collapsed": app.parentNavigationCollapsed(),
					"is-navigation-open": app.parentNavigationOpen(),
				}}
			>
				{organizationSlug() && (
					<OrganizationSideNavigation
						slug={organizationSlug() ?? ""}
						currentRoute={app.route()}
						app={app}
					/>
				)}
				<div
					class="application-page-content"
					classList={{ "admin-page-content": isAdminPage() }}
				>
					<Show when={organizationSlug() ?? "public"} keyed>
						{(_organizationSlug) => (
							<ErrorBoundary
								fallback={(_error, reset) => {
									createEffect(on(() => app.route(), reset, { defer: true }));
									return (
										<section class="panel flow-panel" role="alert">
											<h2>Unable to display this page</h2>
											<p>Please reload the page and try again.</p>
											<button
												type="button"
												class="button"
												onClick={() => window.location.reload()}
											>
												Reload page
											</button>
										</section>
									);
								}}
							>
								<Suspense fallback={<p role="status">Loading page…</p>}>
									<Switch>
										<Match
											when={
												app.route().kind === "home" &&
												!app.shouldShowOrgChooser()
											}
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
										<Match when={app.route().kind === "org-public-directory"}>
											<PublicDirectoryPage
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match when={app.route().kind === "festival-public"}>
											<FestivalLandingPage
												app={app}
												slug={(app.route() as { slug: string }).slug}
												festivalSlug={
													(app.route() as { festivalSlug: string }).festivalSlug
												}
											/>
										</Match>
										<Match
											when={
												app.route().kind === "festival-register" ||
												app.route().kind === "festival-register-class" ||
												app.route().kind === "festival-cart"
											}
										>
											<Show when={registrationContext()} keyed>
												{(_registrationContext) => (
													<FestivalClassRegistrationPage
														app={app}
														slug={(app.route() as { slug: string }).slug}
														festivalSlug={
															(app.route() as { festivalSlug: string })
																.festivalSlug
														}
														view={
															app.route().kind === "festival-cart"
																? "cart"
																: app.route().kind === "festival-register-class"
																	? "class"
																	: "workspace"
														}
														classId={
															(app.route() as { classId?: string }).classId
														}
													/>
												)}
											</Show>
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
										<Match
											when={app.route().kind === "org-accompanist-membership"}
										>
											<AccompanistMembershipPage
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match
											when={app.route().kind === "org-customer-account-legacy"}
										>
											<LegacyCustomerAccountRedirect
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match
											when={
												app.route().kind === "org-customer-account-memberships"
											}
										>
											<CustomerAccountMembershipsPage
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match
											when={app.route().kind === "org-customer-account-contact"}
										>
											<CustomerAccountContactPage
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match
											when={
												app.route().kind === "org-customer-account-children"
											}
										>
											<CustomerChildrenPage
												slug={(app.route() as { slug: string }).slug}
												app={app}
											/>
										</Match>
										<Match
											when={app.route().kind === "org-customer-account-orders"}
										>
											<CustomerAccountOrdersPage
												app={app}
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match
											when={app.route().kind === "org-customer-account-classes"}
										>
											<CustomerAccountClassesPage
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match
											when={
												app.route().kind === "org-customer-account-availability"
											}
										>
											<CustomerAccountAvailabilityPage
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
										<Match when={app.route().kind === "org-admin-roster"}>
											<AdminRosterPage app={app} />
										</Match>
										<Match when={app.route().kind === "org-admin-volunteers"}>
											<VolunteerRolesPage
												app={app}
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match when={app.route().kind === "org-admin-rooms"}>
											<AdminRoomsPage
												app={app}
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match when={app.route().kind === "org-music-review"}>
											<MusicReviewPage
												app={app}
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match when={app.route().kind === "org-billing"}>
											<BillingReconciliationPage
												app={app}
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match when={app.route().kind === "org-communications"}>
											<CommunicationTemplatesPage
												app={app}
												slug={(app.route() as { slug: string }).slug}
											/>
										</Match>
										<Match
											when={app.route().kind === "org-admin-checkout-recovery"}
										>
											<AdminCheckoutRecoveryPage app={app} />
										</Match>
										<Match when={app.route().kind === "org-checkout-recovery"}>
											<CustomerCheckoutRecoveryPage app={app} />
										</Match>
									</Switch>
								</Suspense>
							</ErrorBoundary>
						)}
					</Show>
				</div>
			</div>
			<footer class="site-footer">
				<a href="/privacy-policy">Privacy Policy</a>
			</footer>

			<SignInModal app={app} />
		</main>
	);
}
