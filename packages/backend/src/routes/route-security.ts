export const ROUTE_AUTHENTICATION_CLASSES = [
	"public",
	"firebase",
	"tenant",
	"admin",
	"private-health",
	"customer-auth-start",
	"customer-oauth-callback",
	"customer",
	"shopify-webhook",
	"private-service",
] as const;

export type RouteAuthenticationClass =
	(typeof ROUTE_AUTHENTICATION_CLASSES)[number];

export interface RouteSecurityDeclaration {
	method: "GET" | "HEAD" | "POST" | "DELETE";
	path: string;
	authenticationClass: RouteAuthenticationClass;
}

export const CURRENT_ROUTE_SECURITY = [
	{ method: "GET", path: "/health", authenticationClass: "private-health" },
	{ method: "GET", path: "/api/bootstrap", authenticationClass: "public" },
	{
		method: "GET",
		path: "/api/firebase-session",
		authenticationClass: "firebase",
	},
	{
		method: "POST",
		path: "/api/organizations",
		authenticationClass: "firebase",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/admin/shopify-customer-account",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/admin/shopify-customer-account",
		authenticationClass: "admin",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/customer-auth/start",
		authenticationClass: "customer-auth-start",
	},
	{
		method: "GET",
		path: "/api/customer-auth/callback",
		authenticationClass: "customer-oauth-callback",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/customer/session",
		authenticationClass: "customer",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/customer/membership-purchase/:offeringId",
		authenticationClass: "customer",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/customer/checkout",
		authenticationClass: "customer",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/customer/membership-status",
		authenticationClass: "customer",
	},
	{
		method: "POST",
		path: "/api/shopify/webhooks/orders-paid",
		authenticationClass: "shopify-webhook",
	},
	{
		method: "POST",
		path: "/api/internal/reconcile/shopify-orders",
		authenticationClass: "private-service",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/customer/profile",
		authenticationClass: "customer",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/customer/profile",
		authenticationClass: "customer",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/customer/orders",
		authenticationClass: "customer",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/admin/customers",
		authenticationClass: "admin",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/admin/customers/:customerId",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/customer/logout",
		authenticationClass: "customer",
	},
	{ method: "GET", path: "/api/memberships", authenticationClass: "firebase" },
	{ method: "POST", path: "/api/invites", authenticationClass: "admin" },
	{ method: "GET", path: "/api/invites/:token", authenticationClass: "public" },
	{
		method: "POST",
		path: "/api/invites/:token/accept",
		authenticationClass: "firebase",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug",
		authenticationClass: "tenant",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/welcome/dismiss",
		authenticationClass: "tenant",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/admin/users",
		authenticationClass: "admin",
	},
	{
		method: "DELETE",
		path: "/api/organizations/:slug/admin/memberships/:membershipId",
		authenticationClass: "admin",
	},
	{
		method: "DELETE",
		path: "/api/organizations/:slug/admin/invites/:inviteId",
		authenticationClass: "admin",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/admin/festivals",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/admin/festivals",
		authenticationClass: "admin",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/divisions",
		authenticationClass: "public",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/admin/divisions",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/admin/divisions",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/admin/divisions/reorder",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/admin/divisions/:divisionId",
		authenticationClass: "admin",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/admin/timezone",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/admin/timezone",
		authenticationClass: "admin",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/admin/shopify",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/admin/shopify",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/admin/shopify/diagnostics",
		authenticationClass: "admin",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/admin/membership-products",
		authenticationClass: "admin",
	},
	{
		method: "POST",
		path: "/api/organizations/:slug/admin/membership-products",
		authenticationClass: "admin",
	},
	{
		method: "GET",
		path: "/api/organizations/:slug/membership-products",
		authenticationClass: "public",
	},
	{
		method: "HEAD",
		path: "/api/organizations/:slug/membership-products",
		authenticationClass: "public",
	},
	{
		method: "POST",
		path: "/api/v1/auth/sync",
		authenticationClass: "firebase",
	},
	{
		method: "POST",
		path: "/api/v1/auth/login-event",
		authenticationClass: "firebase",
	},
	{ method: "GET", path: "/api/v1/auth/me", authenticationClass: "firebase" },
] as const satisfies readonly RouteSecurityDeclaration[];

interface RegisteredRoute {
	method: string;
	path: string;
}

function routeKey(route: RegisteredRoute): string {
	return `${route.method.toUpperCase()} ${route.path}`;
}

export function assertRouteSecurityInventory(
	routes: readonly RegisteredRoute[],
	declarations: readonly RouteSecurityDeclaration[] = CURRENT_ROUTE_SECURITY,
): void {
	const declaredKeys = new Set<string>();
	for (const declaration of declarations) {
		const key = routeKey(declaration);
		if (declaredKeys.has(key)) {
			throw new Error(`Duplicate route security declaration: ${key}`);
		}
		declaredKeys.add(key);
	}

	const registeredKeys = new Set(
		routes
			.filter(
				(route) =>
					!(route.method.toUpperCase() === "ALL" && route.path === "/api/*"),
			)
			.map(routeKey),
	);
	const undeclared = [...registeredKeys].filter(
		(key) => !declaredKeys.has(key),
	);
	const unregistered = [...declaredKeys].filter(
		(key) => !registeredKeys.has(key),
	);

	if (undeclared.length > 0 || unregistered.length > 0) {
		throw new Error(
			[
				"Route security inventory mismatch.",
				undeclared.length > 0
					? `Undeclared routes: ${undeclared.sort().join(", ")}.`
					: "",
				unregistered.length > 0
					? `Unregistered declarations: ${unregistered.sort().join(", ")}.`
					: "",
			]
				.filter(Boolean)
				.join(" "),
		);
	}
}
