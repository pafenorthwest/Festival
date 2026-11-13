export type AppRoute =
	| { kind: "home" }
	| { kind: "privacy-policy" }
	| { kind: "create-org" }
	| { kind: "invite"; token: string }
	| { kind: "org-root"; slug: string }
	| { kind: "festival-public"; slug: string; festivalSlug: string }
	| { kind: "festival-admin"; slug: string; festivalSlug: string }
	| { kind: "festival-admin-classes"; slug: string; festivalSlug: string }
	| { kind: "festival-volunteers"; slug: string; festivalSlug: string }
	| { kind: "festival-register"; slug: string; festivalSlug: string }
	| {
			kind: "festival-register-class";
			slug: string;
			festivalSlug: string;
			classId: string;
	  }
	| { kind: "festival-cart"; slug: string; festivalSlug: string }
	| { kind: "org-membership"; slug: string }
	| { kind: "org-accompanist-membership"; slug: string }
	| { kind: "org-customer-account-legacy"; slug: string }
	| { kind: "org-customer-account-memberships"; slug: string }
	| { kind: "org-customer-account-contact"; slug: string }
	| { kind: "org-customer-account-children"; slug: string }
	| { kind: "org-customer-account-orders"; slug: string }
	| { kind: "org-customer-account-classes"; slug: string }
	| { kind: "org-customer-account-availability"; slug: string }
	| { kind: "org-admin"; slug: string }
	| { kind: "org-admin-users"; slug: string }
	| { kind: "org-admin-integrations"; slug: string }
	| { kind: "org-admin-memberships"; slug: string }
	| { kind: "org-admin-festivals"; slug: string }
	| { kind: "org-admin-divisions"; slug: string }
	| { kind: "org-admin-settings"; slug: string }
	| { kind: "org-admin-accompanists"; slug: string }
	| { kind: "org-admin-roster"; slug: string }
	| { kind: "org-admin-volunteers"; slug: string }
	| { kind: "org-admin-rooms"; slug: string }
	| { kind: "org-music-review"; slug: string }
	| { kind: "org-billing"; slug: string }
	| { kind: "org-communications"; slug: string }
	| { kind: "org-public-directory"; slug: string }
	| AdminCheckoutRecoveryRoute
	| CustomerCheckoutRecoveryRoute;

export type AdminCheckoutRecoveryRoute = {
	kind: "org-admin-checkout-recovery";
	slug: string;
};

export type CustomerCheckoutRecoveryRoute = {
	kind: "org-checkout-recovery";
	slug: string;
	token: string;
};

export function buildOrgBillingPath(slug: string): string {
	return `/organizations/${slug}/billing`;
}

export function buildOrgPath(slug: string): string {
	return `/org/${slug}/admin`;
}

export function buildOrgRootPath(slug: string): string {
	return `/org/${slug}`;
}

export function buildOrgPublicDirectoryPath(slug: string): string {
	return `/org/${slug}/directory`;
}

export function buildOrgMembershipPath(slug: string): string {
	return `/org/${slug}/membership`;
}

export function buildOrgAccompanistMembershipPath(slug: string): string {
	return `/org/${slug}/accompanist-membership`;
}

export function buildFestivalAdminClassesPath(
	slug: string,
	festivalSlug: string,
): string {
	return `${buildFestivalAdminPath(slug, festivalSlug)}/classes`;
}

export function buildFestivalVolunteersPath(
	slug: string,
	festivalSlug: string,
): string {
	return `/org/${slug}/festival/${festivalSlug}/volunteers`;
}

export function buildFestivalRegistrationPath(
	slug: string,
	festivalSlug: string,
): string {
	return `/org/${slug}/festival/${festivalSlug}/register`;
}

export function buildFestivalRegistrationClassPath(
	slug: string,
	festivalSlug: string,
	classId: string,
): string {
	return `${buildFestivalRegistrationPath(slug, festivalSlug)}/class/${encodeURIComponent(classId)}`;
}

export function buildFestivalCartPath(
	slug: string,
	festivalSlug: string,
): string {
	return `${buildFestivalRegistrationPath(slug, festivalSlug)}/cart`;
}

export function buildFestivalAdminPath(
	slug: string,
	festivalSlug: string,
): string {
	return `/org/${slug}/festival/${festivalSlug}/admin`;
}

export function buildOrgCustomerAccountPath(slug: string): string {
	return buildOrgCustomerAccountMembershipsPath(slug);
}

export function buildOrgCustomerAccountMembershipsPath(slug: string): string {
	return `/org/${slug}/account/memberships`;
}

export function buildOrgCustomerAccountContactPath(slug: string): string {
	return `/org/${slug}/account/contact`;
}

export function buildOrgCustomerAccountChildrenPath(slug: string): string {
	return `/org/${slug}/account/children`;
}

export function buildOrgCustomerAccountOrdersPath(slug: string): string {
	return `/org/${slug}/account/orders`;
}

export function buildOrgCustomerAccountClassesPath(slug: string): string {
	return `/org/${slug}/account/classes`;
}

export function buildOrgCustomerAccountAvailabilityPath(slug: string): string {
	return `/org/${slug}/account/availability`;
}

export function buildOrgAdminUsersPath(slug: string): string {
	return `/org/${slug}/admin/users`;
}

export function buildOrgAdminIntegrationsPath(slug: string): string {
	return `/org/${slug}/admin/integrations`;
}

export function buildOrgAdminMembershipsPath(slug: string): string {
	return `/org/${slug}/admin/memberships`;
}

export function buildOrgAdminFestivalsPath(slug: string): string {
	return `/org/${slug}/admin/festivals`;
}

export function buildOrgAdminDivisionsPath(slug: string): string {
	return `/org/${slug}/admin/divisions`;
}

export function buildOrgAdminSettingsPath(slug: string): string {
	return `/org/${slug}/admin/settings`;
}

export function buildOrgAdminRosterPath(slug: string): string {
	return `/org/${slug}/admin/roster`;
}

export function buildOrgAdminAccompanistsPath(slug: string): string {
	return buildOrgAdminRosterPath(slug);
}

export function buildOrgAdminVolunteersPath(slug: string): string {
	return `/org/${slug}/admin/volunteers`;
}

export function buildOrgAdminRoomsPath(slug: string): string {
	return `/org/${slug}/admin/rooms`;
}

export function buildOrgMusicReviewPath(slug: string): string {
	return `/organizations/${slug}/music-review`;
}

export function buildOrgCommunicationsPath(slug: string): string {
	return `/organizations/${slug}/communications`;
}

export function buildOrgAdminCheckoutRecoveryPath(slug: string): string {
	return `/org/${slug}/admin/checkout-recovery`;
}

export function buildOrgCheckoutRecoveryPath(
	slug: string,
	token: string,
): string {
	return `/org/${slug}/checkout-recovery/${token}`;
}

export function buildInvitePath(token: string): string {
	return `/invite/${token}`;
}

export function buildPrivacyPolicyPath(): string {
	return "/privacy-policy";
}

export function isOrganizationPageRoute(route: AppRoute): boolean {
	return (
		route.kind === "festival-register" ||
		route.kind === "festival-register-class" ||
		route.kind === "festival-cart" ||
		route.kind === "festival-volunteers" ||
		route.kind === "org-root" ||
		route.kind === "org-public-directory" ||
		route.kind === "festival-public" ||
		route.kind === "org-membership" ||
		route.kind === "org-accompanist-membership" ||
		route.kind === "org-customer-account-legacy" ||
		route.kind === "org-customer-account-memberships" ||
		route.kind === "org-customer-account-contact" ||
		route.kind === "org-customer-account-children" ||
		route.kind === "org-customer-account-orders" ||
		route.kind === "org-customer-account-classes" ||
		route.kind === "org-customer-account-availability" ||
		route.kind === "org-checkout-recovery"
	);
}
