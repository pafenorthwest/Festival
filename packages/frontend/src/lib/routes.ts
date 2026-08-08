export type AppRoute =
	| { kind: "home" }
	| { kind: "create-org" }
	| { kind: "invite"; token: string }
	| { kind: "org-root"; slug: string }
	| { kind: "org-admin"; slug: string }
	| { kind: "org-admin-users"; slug: string }
	| { kind: "org-admin-festivals"; slug: string };

export function buildOrgPath(slug: string): string {
	return `/org/${slug}/admin`;
}

export function buildOrgRootPath(slug: string): string {
	return `/org/${slug}`;
}

export function buildOrgAdminUsersPath(slug: string): string {
	return `/org/${slug}/admin/users`;
}

export function buildOrgAdminFestivalsPath(slug: string): string {
	return `/org/${slug}/admin/festivals`;
}

export function buildInvitePath(token: string): string {
	return `/invite/${token}`;
}

export function parseRoute(pathname: string): AppRoute {
	if (pathname === "/") {
		return { kind: "home" };
	}

	if (pathname === "/create-organization") {
		return { kind: "create-org" };
	}

	const inviteMatch = pathname.match(/^\/invite\/([^/]+)$/);
	if (inviteMatch) {
		return { kind: "invite", token: inviteMatch[1] ?? "" };
	}

	const orgRootMatch = pathname.match(/^\/org\/([^/]+)$/);
	if (orgRootMatch) {
		return { kind: "org-root", slug: orgRootMatch[1] ?? "" };
	}

	const orgAdminMatch = pathname.match(/^\/org\/([^/]+)\/admin$/);
	if (orgAdminMatch) {
		return { kind: "org-admin", slug: orgAdminMatch[1] ?? "" };
	}

	const orgAdminUsersMatch = pathname.match(/^\/org\/([^/]+)\/admin\/users$/);
	if (orgAdminUsersMatch) {
		return { kind: "org-admin-users", slug: orgAdminUsersMatch[1] ?? "" };
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

	return { kind: "home" };
}
