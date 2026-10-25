import { type Component, lazy } from "solid-js";
import { type AppRoute, parseRoute } from "../lib/routes.js";

// biome-ignore lint/suspicious/noExplicitAny: Match Solid's lazy component constraint while preserving each page's exact props.
export function lazyPage<Page extends Component<any>>(
	loadModule: () => Promise<{ default: Page }>,
) {
	let pending: ReturnType<typeof loadModule> | undefined;
	const load = () => {
		if (!pending) {
			const request = loadModule();
			pending = request;
			void request.catch(() => {
				if (pending === request) pending = undefined;
			});
		}
		return pending;
	};
	const page = lazy(load);
	// Share the import directly: speculative failures stay catchable and can
	// retry without rendering a component or retaining Solid's rejected preload.
	page.preload = load;
	return page;
}
export const AccompanistMembershipPage = lazyPage(() =>
	import("../pages/AccompanistMembershipPage.js").then((module) => ({
		default: module.AccompanistMembershipPage,
	})),
);
export const AdminAccompanistsPage = lazyPage(() =>
	import("../pages/AdminAccompanistsPage.js").then((module) => ({
		default: module.AdminAccompanistsPage,
	})),
);
export const AdminCheckoutRecoveryPage = lazyPage(() =>
	import("../pages/AdminCheckoutRecoveryPage.js").then((module) => ({
		default: module.AdminCheckoutRecoveryPage,
	})),
);
export const AdminDivisionsPage = lazyPage(() =>
	import("../pages/AdminDivisionsPage.js").then((module) => ({
		default: module.AdminDivisionsPage,
	})),
);
export const AdminFestivalsPage = lazyPage(() =>
	import("../pages/AdminFestivalsPage.js").then((module) => ({
		default: module.AdminFestivalsPage,
	})),
);
export const AdminHomePage = lazyPage(() =>
	import("../pages/AdminHomePage.js").then((module) => ({
		default: module.AdminHomePage,
	})),
);
export const AdminIntegrationsPage = lazyPage(() =>
	import("../pages/AdminIntegrationsPage.js").then((module) => ({
		default: module.AdminIntegrationsPage,
	})),
);
export const AdminMembershipProductsPage = lazyPage(() =>
	import("../pages/AdminMembershipProductsPage.js").then((module) => ({
		default: module.AdminMembershipProductsPage,
	})),
);
export const AdminRoomsPage = lazyPage(() =>
	import("../pages/AdminRoomsPage.js").then((module) => ({
		default: module.AdminRoomsPage,
	})),
);
export const AdminRosterPage = lazyPage(() =>
	import("../pages/AdminRosterPage.js").then((module) => ({
		default: module.AdminRosterPage,
	})),
);
export const AdminSettingsPage = lazyPage(() =>
	import("../pages/AdminSettingsPage.js").then((module) => ({
		default: module.AdminSettingsPage,
	})),
);
export const AdminUsersPage = lazyPage(() =>
	import("../pages/AdminUsersPage.js").then((module) => ({
		default: module.AdminUsersPage,
	})),
);
export const BillingReconciliationPage = lazyPage(() =>
	import("../pages/BillingReconciliationPage.js").then((module) => ({
		default: module.BillingReconciliationPage,
	})),
);
export const CommunicationTemplatesPage = lazyPage(() =>
	import("../pages/CommunicationTemplatesPage.js").then((module) => ({
		default: module.CommunicationTemplatesPage,
	})),
);
export const CreateOrganizationPage = lazyPage(() =>
	import("../pages/CreateOrganizationPage.js").then((module) => ({
		default: module.CreateOrganizationPage,
	})),
);
export const CustomerAccountAvailabilityPage = lazyPage(() =>
	import("../pages/CustomerAccountAvailabilityPage.js").then((module) => ({
		default: module.CustomerAccountAvailabilityPage,
	})),
);
export const CustomerAccountClassesPage = lazyPage(() =>
	import("../pages/CustomerAccountClassesPage.js").then((module) => ({
		default: module.CustomerAccountClassesPage,
	})),
);
export const CustomerAccountContactPage = lazyPage(() =>
	import("../pages/CustomerAccountContactPage.js").then((module) => ({
		default: module.CustomerAccountContactPage,
	})),
);
export const CustomerAccountMembershipsPage = lazyPage(() =>
	import("../pages/CustomerAccountMembershipsPage.js").then((module) => ({
		default: module.CustomerAccountMembershipsPage,
	})),
);
export const CustomerAccountOrdersPage = lazyPage(() =>
	import("../pages/CustomerAccountOrdersPage.js").then((module) => ({
		default: module.CustomerAccountOrdersPage,
	})),
);
export const CustomerCheckoutRecoveryPage = lazyPage(() =>
	import("../pages/CustomerCheckoutRecoveryPage.js").then((module) => ({
		default: module.CustomerCheckoutRecoveryPage,
	})),
);
export const CustomerChildrenPage = lazyPage(() =>
	import("../pages/CustomerChildrenPage.js").then((module) => ({
		default: module.CustomerChildrenPage,
	})),
);
export const FestivalAdminClassesPage = lazyPage(() =>
	import("../pages/FestivalAdminClassesPage.js").then((module) => ({
		default: module.FestivalAdminClassesPage,
	})),
);
export const FestivalAdminDashboardPage = lazyPage(() =>
	import("../pages/FestivalAdminDashboardPage.js").then((module) => ({
		default: module.FestivalAdminDashboardPage,
	})),
);
export const FestivalClassRegistrationPage = lazyPage(() =>
	import("../pages/FestivalClassRegistrationPage.js").then((module) => ({
		default: module.FestivalClassRegistrationPage,
	})),
);
export const FestivalLandingPage = lazyPage(() =>
	import("../pages/FestivalLandingPage.js").then((module) => ({
		default: module.FestivalLandingPage,
	})),
);
export const FestivalVolunteersPage = lazyPage(() =>
	import("../pages/FestivalVolunteersPage.js").then((module) => ({
		default: module.FestivalVolunteersPage,
	})),
);
export const InviteLandingPage = lazyPage(() =>
	import("../pages/InviteLandingPage.js").then((module) => ({
		default: module.InviteLandingPage,
	})),
);
export const LegacyCustomerAccountRedirect = lazyPage(() =>
	import("../pages/LegacyCustomerAccountRedirect.js").then((module) => ({
		default: module.LegacyCustomerAccountRedirect,
	})),
);
export const MembershipPage = lazyPage(() =>
	import("../pages/MembershipPage.js").then((module) => ({
		default: module.MembershipPage,
	})),
);
export const MusicReviewPage = lazyPage(() =>
	import("../pages/MusicReviewPage.js").then((module) => ({
		default: module.MusicReviewPage,
	})),
);
export const OrganizationRootPage = lazyPage(() =>
	import("../pages/OrganizationRootPage.js").then((module) => ({
		default: module.OrganizationRootPage,
	})),
);
export const PrivacyPolicyPage = lazyPage(() =>
	import("../pages/PrivacyPolicyPage.js").then((module) => ({
		default: module.PrivacyPolicyPage,
	})),
);
export const VolunteerRolesPage = lazyPage(() =>
	import("../pages/VolunteerRolesPage.js").then((module) => ({
		default: module.VolunteerRolesPage,
	})),
);

interface PreloadablePage {
	preload: () => Promise<unknown>;
}

export const routePages = {
	home: null,
	"privacy-policy": PrivacyPolicyPage,
	"create-org": CreateOrganizationPage,
	invite: InviteLandingPage,
	"org-root": OrganizationRootPage,
	"festival-public": FestivalLandingPage,
	"festival-register": FestivalClassRegistrationPage,
	"festival-volunteers": FestivalVolunteersPage,
	"festival-admin": FestivalAdminDashboardPage,
	"festival-admin-classes": FestivalAdminClassesPage,
	"org-membership": MembershipPage,
	"org-accompanist-membership": AccompanistMembershipPage,
	"org-customer-account-legacy": LegacyCustomerAccountRedirect,
	"org-customer-account-memberships": CustomerAccountMembershipsPage,
	"org-customer-account-contact": CustomerAccountContactPage,
	"org-customer-account-children": CustomerChildrenPage,
	"org-customer-account-orders": CustomerAccountOrdersPage,
	"org-customer-account-classes": CustomerAccountClassesPage,
	"org-customer-account-availability": CustomerAccountAvailabilityPage,
	"org-admin": AdminHomePage,
	"org-admin-users": AdminUsersPage,
	"org-admin-integrations": AdminIntegrationsPage,
	"org-admin-memberships": AdminMembershipProductsPage,
	"org-admin-festivals": AdminFestivalsPage,
	"org-admin-divisions": AdminDivisionsPage,
	"org-admin-settings": AdminSettingsPage,
	"org-admin-accompanists": AdminAccompanistsPage,
	"org-admin-roster": AdminRosterPage,
	"org-admin-volunteers": VolunteerRolesPage,
	"org-admin-rooms": AdminRoomsPage,
	"org-music-review": MusicReviewPage,
	"org-billing": BillingReconciliationPage,
	"org-communications": CommunicationTemplatesPage,
	"org-admin-checkout-recovery": AdminCheckoutRecoveryPage,
	"org-checkout-recovery": CustomerCheckoutRecoveryPage,
} satisfies Record<AppRoute["kind"], PreloadablePage | null>;

export async function preloadRoute(pathname: string): Promise<void> {
	try {
		await routePages[parseRoute(pathname).kind]?.preload();
	} catch {
		// A speculative load must not disrupt navigation. The route boundary
		// presents recovery if the user subsequently opens a failed chunk.
	}
}
