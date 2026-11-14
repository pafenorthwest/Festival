import {
	type AppRoute,
	STAFF_ORGANIZATION_CHOOSER_PATH,
} from "./routePaths.js";

export * from "./routePaths.js";

type SegmentMatcher = string | readonly string[];

interface RoutePattern {
	segments: readonly SegmentMatcher[];
	allowTrailingSlash?: boolean;
	build: (params: Record<string, string>) => AppRoute;
}

const ORG_PREFIX = ["org", "organizations"] as const;

type FestivalRouteKind = Exclude<
	Extract<AppRoute, { slug: string; festivalSlug: string }>["kind"],
	"festival-register-class"
>;

type SlugOnlyRouteKind = Exclude<
	Extract<AppRoute, { slug: string }>["kind"],
	FestivalRouteKind | "org-checkout-recovery"
>;

function slugRoute(
	segments: readonly SegmentMatcher[],
	kind: SlugOnlyRouteKind,
	allowTrailingSlash = false,
): RoutePattern {
	return {
		segments,
		allowTrailingSlash,
		build: ({ slug = "" }) => ({ kind, slug }) as AppRoute,
	};
}

function festivalRoute(
	suffix: readonly SegmentMatcher[],
	kind: FestivalRouteKind,
	allowTrailingSlash = false,
): RoutePattern {
	return {
		segments: ["org", ":slug", "festival", ":festivalSlug", ...suffix],
		allowTrailingSlash,
		build: ({ slug = "", festivalSlug = "" }) => ({
			kind,
			slug,
			festivalSlug,
		}),
	};
}

function decodeRouteSegment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

const ROUTE_PATTERNS: readonly RoutePattern[] = [
	{
		segments: STAFF_ORGANIZATION_CHOOSER_PATH.slice(1).split("/"),
		allowTrailingSlash: true,
		build: () => ({ kind: "staff-organization-chooser" }),
	},
	{
		segments: ["privacy-policy"],
		build: () => ({ kind: "privacy-policy" }),
	},
	{
		segments: ["create-organization"],
		build: () => ({ kind: "create-org" }),
	},
	{
		segments: ["invite", ":token"],
		build: ({ token = "" }) => ({ kind: "invite", token }),
	},
	slugRoute(["org", ":slug"], "org-root", true),
	slugRoute(["org", ":slug", "directory"], "org-public-directory", true),
	festivalRoute(["admin"], "festival-admin"),
	festivalRoute(["admin", "classes"], "festival-admin-classes"),
	festivalRoute(["volunteers"], "festival-volunteers"),
	{
		segments: [
			"org",
			":slug",
			"festival",
			":festivalSlug",
			"register",
			"class",
			":classId",
		],
		allowTrailingSlash: true,
		build: ({ slug = "", festivalSlug = "", classId = "" }) => ({
			kind: "festival-register-class",
			slug,
			festivalSlug,
			classId: decodeRouteSegment(classId),
		}),
	},
	festivalRoute(["register", "cart"], "festival-cart", true),
	festivalRoute(["register"], "festival-register"),
	festivalRoute([], "festival-public"),
	slugRoute(["org", ":slug", "membership"], "org-membership"),
	slugRoute(
		["org", ":slug", "accompanist-membership"],
		"org-accompanist-membership",
	),
	slugRoute(["org", ":slug", "account"], "org-customer-account-legacy", true),
	slugRoute(
		["org", ":slug", "account", "memberships"],
		"org-customer-account-memberships",
	),
	slugRoute(
		["org", ":slug", "account", "contact"],
		"org-customer-account-contact",
	),
	slugRoute(
		["org", ":slug", "account", "orders"],
		"org-customer-account-orders",
	),
	slugRoute(
		["org", ":slug", "account", "classes"],
		"org-customer-account-classes",
	),
	slugRoute(
		[ORG_PREFIX, ":slug", "account", "availability"],
		"org-customer-account-availability",
		true,
	),
	slugRoute(["org", ":slug", "admin"], "org-admin"),
	slugRoute(
		["org", ":slug", "account", "children"],
		"org-customer-account-children",
	),
	slugRoute(["org", ":slug", "admin", "users"], "org-admin-users"),
	slugRoute(
		["org", ":slug", "admin", "integrations"],
		"org-admin-integrations",
	),
	slugRoute(["org", ":slug", "admin", "memberships"], "org-admin-memberships"),
	slugRoute(["org", ":slug", "admin", "festivals"], "org-admin-festivals"),
	slugRoute(["org", ":slug", "admin", "divisions"], "org-admin-divisions"),
	slugRoute(["org", ":slug", "admin", "settings"], "org-admin-settings"),
	slugRoute(["org", ":slug", "admin", "roster"], "org-admin-roster"),
	slugRoute(["org", ":slug", "admin", "accompanists"], "org-admin-roster"),
	slugRoute(["org", ":slug", "admin", "volunteers"], "org-admin-volunteers"),
	slugRoute(["org", ":slug", "admin", "rooms"], "org-admin-rooms"),
	slugRoute([ORG_PREFIX, ":slug", "music-review"], "org-music-review", true),
	slugRoute(
		[ORG_PREFIX, ":slug", "admin", "music-review"],
		"org-music-review",
		true,
	),
	slugRoute([ORG_PREFIX, ":slug", "billing"], "org-billing", true),
	slugRoute(
		[ORG_PREFIX, ":slug", "communications"],
		"org-communications",
		true,
	),
	slugRoute(
		[ORG_PREFIX, ":slug", "admin", "communications"],
		"org-communications",
		true,
	),
	slugRoute(
		["org", ":slug", "admin", "checkout-recovery"],
		"org-admin-checkout-recovery",
		true,
	),
	{
		segments: ["org", ":slug", "checkout-recovery", ":token"],
		allowTrailingSlash: true,
		build: ({ slug = "", token = "" }) => ({
			kind: "org-checkout-recovery",
			slug,
			token,
		}),
	},
];

function matchSegment(
	matcher: SegmentMatcher,
	segment: string,
	params: Record<string, string>,
): boolean {
	if (typeof matcher === "string") {
		if (matcher.startsWith(":")) {
			if (segment.length === 0) {
				return false;
			}
			params[matcher.slice(1)] = segment;
			return true;
		}
		return segment === matcher;
	}
	return matcher.includes(segment);
}

function matchRoutePattern(
	pattern: RoutePattern,
	segments: readonly string[],
	hasTrailingSlash: boolean,
): AppRoute | null {
	if (hasTrailingSlash && !pattern.allowTrailingSlash) {
		return null;
	}
	if (segments.length !== pattern.segments.length) {
		return null;
	}
	const params: Record<string, string> = {};
	for (let i = 0; i < pattern.segments.length; i += 1) {
		const matcher = pattern.segments[i];
		const segment = segments[i];
		if (matcher === undefined || segment === undefined) {
			return null;
		}
		if (!matchSegment(matcher, segment, params)) {
			return null;
		}
	}
	return pattern.build(params);
}

export function parseRoute(pathname: string): AppRoute {
	if (pathname === "/" || !pathname.startsWith("/")) {
		return { kind: "home" };
	}
	const hasTrailingSlash = pathname.length > 1 && pathname.endsWith("/");
	const trimmed = hasTrailingSlash ? pathname.slice(0, -1) : pathname;
	const segments = trimmed.slice(1).split("/");

	for (const pattern of ROUTE_PATTERNS) {
		const matched = matchRoutePattern(pattern, segments, hasTrailingSlash);
		if (matched !== null) {
			return matched;
		}
	}
	return { kind: "home" };
}
