import { Route, type RouteSectionProps, useParams } from "@solidjs/router";
import { createMemo, type JSX, Show } from "solid-js";
import { AdminOrgProvider } from "../domains/admin-org/AdminOrgContext.js";
import { ClassRegistrationProvider } from "../domains/registration/ClassRegistrationContext.js";
import {
	decodeRouteSegment,
	STAFF_ORGANIZATION_CHOOSER_PATH,
} from "../lib/routes.js";
import { HomePage } from "../pages/HomePage.js";
import { OrganizationChooser } from "../pages/OrganizationChooser.js";
import { adminRoutes, withCat, withDir, withVol } from "./AdminRoutes.js";
import { useFestivalShell } from "./FestivalShellContext.js";
import * as Pages from "./lazyPages.js";

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

function accountView(
	render: (
		slug: string,
		app: ReturnType<typeof useFestivalShell>,
	) => JSX.Element,
) {
	return () => {
		const params = useParams();
		const app = useFestivalShell();
		return (
			<Show when={params.slug} keyed>
				{(slug) => render(slug, app)}
			</Show>
		);
	};
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
				component={() => (
					<Pages.CustomerCheckoutRecoveryPage app={useFestivalShell()} />
				)}
			/>
			<Route
				path="/account"
				component={accountView((slug) => (
					<Pages.LegacyCustomerAccountRedirect slug={slug} />
				))}
			/>
			<Route
				path="/account/memberships"
				component={accountView((slug) => (
					<Pages.CustomerAccountMembershipsPage slug={slug} />
				))}
			/>
			<Route
				path="/account/contact"
				component={accountView((slug) => (
					<Pages.CustomerAccountContactPage slug={slug} />
				))}
			/>
			<Route
				path="/account/children"
				component={accountView((slug, app) => (
					<Pages.CustomerChildrenPage slug={slug} app={app} />
				))}
			/>
			<Route
				path="/account/orders"
				component={accountView((slug, app) => (
					<Pages.CustomerAccountOrdersPage slug={slug} app={app} />
				))}
			/>
			<Route
				path="/account/classes"
				component={accountView((slug) => (
					<Pages.CustomerAccountClassesPage slug={slug} />
				))}
			/>
			<Route
				path="/account/availability"
				component={accountView((slug) => (
					<Pages.CustomerAccountAvailabilityPage slug={slug} />
				))}
			/>
		</>
	);
}

function regView(view: "workspace" | "class" | "cart") {
	return () => {
		const p = useParams();
		const app = useFestivalShell();
		const classId = createMemo(() =>
			p.classId ? decodeRouteSegment(p.classId) : undefined,
		);
		const scope = createMemo(
			() => ({ slug: p.slug ?? "", festivalSlug: p.festivalSlug ?? "" }),
			undefined,
			{
				equals: (previous, next) =>
					previous.slug === next.slug &&
					previous.festivalSlug === next.festivalSlug,
			},
		);
		return (
			<Show when={scope()} keyed>
				{({ slug, festivalSlug }) => (
					<Pages.FestivalClassRegistrationPage
						app={app}
						slug={slug}
						festivalSlug={festivalSlug}
						view={view}
						classId={classId()}
					/>
				)}
			</Show>
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
			<Route path={["/org/:slug", "/organizations/:slug"]}>
				{publicOrgRoutes()}
				{festivalRoutes()}
				{adminRoutes()}
			</Route>
		</>
	);
}
