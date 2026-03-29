export type AppRoute =
	| { kind: "home" }
	| { kind: "create-org" }
	| { kind: "invite"; token: string }
	| { kind: "org"; slug: string };

export function buildOrgPath(slug: string): string {
	return `/org/${slug}`;
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

	const orgMatch = pathname.match(/^\/org\/([^/]+)$/);
	if (orgMatch) {
		return { kind: "org", slug: orgMatch[1] ?? "" };
	}

	return { kind: "home" };
}
