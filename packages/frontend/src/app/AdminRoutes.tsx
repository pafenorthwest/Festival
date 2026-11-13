import { Route, useParams } from "@solidjs/router";
import type { JSX } from "solid-js";
import {
	AdminCommerceProvider,
	useAdminCommerce,
} from "../domains/admin-commerce/AdminCommerceContext.js";
import { AdminOrgProvider } from "../domains/admin-org/AdminOrgContext.js";
import { CatalogRepertoireProvider } from "../domains/catalog/CatalogRepertoireContext.js";
import { TeacherDirectoryProvider } from "../domains/directory/TeacherDirectoryContext.js";
import { ClassRegistrationProvider } from "../domains/registration/ClassRegistrationContext.js";
import { VolunteersProvider } from "../domains/volunteers/VolunteersContext.js";
import { useFestivalShell } from "./FestivalShellContext.js";
import * as Pages from "./lazyPages.js";

type Shell = ReturnType<typeof useFestivalShell>;

export const withDir =
	(render: (slug: string, app: Shell) => JSX.Element) => () => {
		const slug = useParams().slug ?? "";
		return (
			<TeacherDirectoryProvider slug={slug}>
				{render(slug, useFestivalShell())}
			</TeacherDirectoryProvider>
		);
	};

export const withVol =
	(render: (slug: string, festivalSlug: string, app: Shell) => JSX.Element) =>
	() => {
		const p = useParams();
		const slug = p.slug ?? "";
		return (
			<VolunteersProvider slug={slug}>
				{render(slug, p.festivalSlug ?? "", useFestivalShell())}
			</VolunteersProvider>
		);
	};

export const withCat =
	(render: (slug: string, festivalSlug: string, app: Shell) => JSX.Element) =>
	() => {
		const p = useParams();
		return (
			<CatalogRepertoireProvider>
				{render(p.slug ?? "", p.festivalSlug ?? "", useFestivalShell())}
			</CatalogRepertoireProvider>
		);
	};

const withCom = (render: (slug: string, app: Shell) => JSX.Element) => () => {
	const slug = useParams().slug ?? "";
	return (
		<AdminCommerceProvider slug={slug}>
			{render(slug, useFestivalShell())}
		</AdminCommerceProvider>
	);
};

function AdminMembershipsInner(props: { app: Shell; slug: string }) {
	const commerce = useAdminCommerce();
	return (
		<TeacherDirectoryProvider
			slug={props.slug}
			shopifyPrerequisiteMet={commerce.shopifyPrerequisiteMet}
		>
			<Pages.AdminMembershipProductsPage app={props.app} />
		</TeacherDirectoryProvider>
	);
}

export function adminRoutes() {
	return (
		<>
			<Route
				path="/admin"
				component={withVol((_s, _f, app) => <Pages.AdminHomePage app={app} />)}
			/>
			<Route
				path="/admin/users"
				component={() => (
					<AdminOrgProvider>
						<Pages.AdminUsersPage app={useFestivalShell()} />
					</AdminOrgProvider>
				)}
			/>
			<Route
				path="/admin/divisions"
				component={() => (
					<AdminOrgProvider>
						<Pages.AdminDivisionsPage app={useFestivalShell()} />
					</AdminOrgProvider>
				)}
			/>
			<Route
				path="/admin/settings"
				component={() => <Pages.AdminSettingsPage app={useFestivalShell()} />}
			/>
			<Route
				path="/admin/integrations"
				component={withCom((_s, app) => (
					<Pages.AdminIntegrationsPage app={app} />
				))}
			/>
			<Route
				path="/admin/memberships"
				component={withCom((slug, app) => (
					<AdminMembershipsInner app={app} slug={slug} />
				))}
			/>
			<Route
				path="/admin/festivals"
				component={withCat((_s, _f, app) => (
					<Pages.AdminFestivalsPage app={app} />
				))}
			/>
			<Route
				path={["/admin/roster", "/admin/accompanists"]}
				component={withDir((_s, app) => <Pages.AdminRosterPage app={app} />)}
			/>
			<Route
				path="/admin/volunteers"
				component={withVol((slug, _f, app) => (
					<Pages.VolunteerRolesPage app={app} slug={slug} />
				))}
			/>
			<Route
				path="/admin/rooms"
				component={withCat((slug, _f, app) => (
					<Pages.AdminRoomsPage app={app} slug={slug} />
				))}
			/>
			<Route
				path="/admin/checkout-recovery"
				component={() => {
					const p = useParams();
					return (
						<ClassRegistrationProvider
							slug={p.slug ?? ""}
							festivalSlug={p.festivalSlug ?? ""}
						>
							<Pages.AdminCheckoutRecoveryPage app={useFestivalShell()} />
						</ClassRegistrationProvider>
					);
				}}
			/>
			<Route
				path={["/music-review", "/admin/music-review"]}
				component={withCat((slug, _f, app) => (
					<Pages.MusicReviewPage app={app} slug={slug} />
				))}
			/>
			<Route
				path="/billing"
				component={withCom((slug, app) => (
					<Pages.BillingReconciliationPage app={app} slug={slug} />
				))}
			/>
			<Route
				path={["/communications", "/admin/communications"]}
				component={withVol((slug, _f, app) => (
					<Pages.CommunicationTemplatesPage app={app} slug={slug} />
				))}
			/>
		</>
	);
}
