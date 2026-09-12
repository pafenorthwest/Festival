export type AppRoute =
	| { kind: "home" }
	| { kind: "privacy-policy" }
	| { kind: "create-org" }
	| { kind: "invite"; token: string }
	| { kind: "org-root"; slug: string }
	| { kind: "org-membership"; slug: string }
	| { kind: "org-accompanist-membership"; slug: string }
	| { kind: "org-customer-account-legacy"; slug: string }
	| { kind: "org-customer-account-memberships"; slug: string }
	| { kind: "org-customer-account-contact"; slug: string }
	| { kind: "org-customer-account-orders"; slug: string }
	| { kind: "org-admin"; slug: string }
	| { kind: "org-admin-users"; slug: string }
	| { kind: "org-admin-integrations"; slug: string }
	| { kind: "org-admin-memberships"; slug: string }
	| { kind: "org-admin-festivals"; slug: string }
	| { kind: "org-admin-divisions"; slug: string }
	| { kind: "org-admin-accompanists"; slug: string };

export function buildOrgPath(slug: string): string {
	return `/org/${slug}/admin`;
}

export function buildOrgRootPath(slug: string): string {
	return `/org/${slug}`;
}

export function buildOrgMembershipPath(slug: string): string {
	return `/org/${slug}/membership`;
}

export function buildOrgAccompanistMembershipPath(slug: string): string {
	return `/org/${slug}/accompanist-membership`;
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

export function buildOrgCustomerAccountOrdersPath(slug: string): string {
	return `/org/${slug}/account/orders`;
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
export function buildOrgAdminAccompanistsPath(slug: string): string {
	return `/org/${slug}/admin/accompanists`;
}

export function buildInvitePath(token: string): string {
	return `/invite/${token}`;
}

export function buildPrivacyPolicyPath(): string {
	return "/privacy-policy";
}

export function isOrganizationPageRoute(route: AppRoute): boolean {
	return (
		route.kind === "org-root" ||
		route.kind === "org-membership" ||
		route.kind === "org-accompanist-membership" ||
		route.kind === "org-customer-account-legacy" ||
		route.kind === "org-customer-account-memberships" ||
		route.kind === "org-customer-account-contact" ||
		route.kind === "org-customer-account-orders"
	);
}

export function parseRoute(pathname: string): AppRoute {
	if (pathname === "/") {
		return { kind: "home" };
	}

	if (pathname === "/privacy-policy") {
		return { kind: "privacy-policy" };
	}

	if (pathname === "/create-organization") {
		return { kind: "create-org" };
	}

	const inviteMatch = pathname.match(/^\/invite\/([^/]+)$/);
	if (inviteMatch) {
		return { kind: "invite", token: inviteMatch[1] ?? "" };
	}

	const orgRootMatch = pathname.match(/^\/org\/([^/]+)\/?$/);
	if (orgRootMatch) {
		return { kind: "org-root", slug: orgRootMatch[1] ?? "" };
	}

	const orgMembershipMatch = pathname.match(/^\/org\/([^/]+)\/membership$/);
	if (orgMembershipMatch) {
		return { kind: "org-membership", slug: orgMembershipMatch[1] ?? "" };
	}
	const accompanistMembershipMatch = pathname.match(
		/^\/org\/([^/]+)\/accompanist-membership$/,
	);
	if (accompanistMembershipMatch) {
		return {
			kind: "org-accompanist-membership",
			slug: accompanistMembershipMatch[1] ?? "",
		};
	}

	const customerAccountMatch = pathname.match(/^\/org\/([^/]+)\/account\/?$/);
	if (customerAccountMatch)
		return {
			kind: "org-customer-account-legacy",
			slug: customerAccountMatch[1] ?? "",
		};

	const customerAccountMembershipsMatch = pathname.match(
		/^\/org\/([^/]+)\/account\/memberships$/,
	);
	if (customerAccountMembershipsMatch)
		return {
			kind: "org-customer-account-memberships",
			slug: customerAccountMembershipsMatch[1] ?? "",
		};

	const customerAccountContactMatch = pathname.match(
		/^\/org\/([^/]+)\/account\/contact$/,
	);
	if (customerAccountContactMatch)
		return {
			kind: "org-customer-account-contact",
			slug: customerAccountContactMatch[1] ?? "",
		};

	const customerAccountOrdersMatch = pathname.match(
		/^\/org\/([^/]+)\/account\/orders$/,
	);
	if (customerAccountOrdersMatch)
		return {
			kind: "org-customer-account-orders",
			slug: customerAccountOrdersMatch[1] ?? "",
		};

	const orgAdminMatch = pathname.match(/^\/org\/([^/]+)\/admin$/);
	if (orgAdminMatch) {
		return { kind: "org-admin", slug: orgAdminMatch[1] ?? "" };
	}

	const orgAdminUsersMatch = pathname.match(/^\/org\/([^/]+)\/admin\/users$/);
	if (orgAdminUsersMatch) {
		return { kind: "org-admin-users", slug: orgAdminUsersMatch[1] ?? "" };
	}

	const orgAdminIntegrationsMatch = pathname.match(
		/^\/org\/([^/]+)\/admin\/integrations$/,
	);
	if (orgAdminIntegrationsMatch) {
		return {
			kind: "org-admin-integrations",
			slug: orgAdminIntegrationsMatch[1] ?? "",
		};
	}

	const orgAdminMembershipsMatch = pathname.match(
		/^\/org\/([^/]+)\/admin\/memberships$/,
	);
	if (orgAdminMembershipsMatch) {
		return {
			kind: "org-admin-memberships",
			slug: orgAdminMembershipsMatch[1] ?? "",
		};
	}

	const orgAdminFestivalsMatch = pathname.match(
		/^\/org\/([^/]+)\/admin\/festivals$/,
	);
	if (orgAdminFestivalsMatch) {
		return {
			kind: "org-admin-festivals",
			slug: orgAdminFestivalsMatch[1] ?? "",
		};
	}

	const orgAdminDivisionsMatch = pathname.match(
		/^\/org\/([^/]+)\/admin\/divisions$/,
	);
	if (orgAdminDivisionsMatch) {
		return {
			kind: "org-admin-divisions",
			slug: orgAdminDivisionsMatch[1] ?? "",
		};
	}
	const orgAdminAccompanistsMatch = pathname.match(
		/^\/org\/([^/]+)\/admin\/accompanists$/,
	);
	if (orgAdminAccompanistsMatch)
		return {
			kind: "org-admin-accompanists",
			slug: orgAdminAccompanistsMatch[1] ?? "",
		};

	return { kind: "home" };
}
