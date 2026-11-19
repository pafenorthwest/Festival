export const ROUTE_AUTHENTICATION_CLASSES = [
	"public",
	"firebase",
	"tenant",
	"admin",
	"volunteer-admin",
	"private-health",
	"customer-auth-start",
	"customer-oauth-callback",
	"customer",
	"shopify-webhook",
	"private-service",
	"private-runtime",
	"private-operator",
	"private-event-bus",
] as const;

export type RouteAuthenticationClass =
	(typeof ROUTE_AUTHENTICATION_CLASSES)[number];

export type RouteHttpMethod =
	| "GET"
	| "HEAD"
	| "POST"
	| "PUT"
	| "PATCH"
	| "DELETE";

export interface CoLocatedRouteSecurity {
	method: RouteHttpMethod;
	path: string;
	authenticationClass: RouteAuthenticationClass;
	csrfRequired: boolean;
	browserAllowed: boolean;
}

export interface RouteSecurityDeclaration {
	method: RouteHttpMethod;
	path: string;
	authenticationClass: RouteAuthenticationClass;
	csrfRequired?: boolean;
	browserAllowed?: boolean;
}

export function isPrivateRouteAuthenticationClass(
	authenticationClass: RouteAuthenticationClass,
): boolean {
	return authenticationClass.startsWith("private-");
}

export function isAllowedPrivateRoutePath(path: string): boolean {
	return path === "/health" || path.startsWith("/api/internal/");
}

export function isReservedPrivateSurfacePath(path: string): boolean {
	return (
		path === "/health" ||
		/^\/(?:api\/)?(?:internal|metrics|ready|readiness|diagnostics|debug|jobs|workers|queues|operator)(?:\/|$)/.test(
			path,
		)
	);
}

export function joinRoutePath(prefix: string, path: string): string {
	const cleanPrefix =
		prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
	const cleanPath = path.startsWith("/") ? path : `/${path}`;
	if (!cleanPrefix || cleanPrefix === "/") {
		return cleanPath;
	}
	if (cleanPath === "/") {
		return cleanPrefix;
	}
	return `${cleanPrefix}${cleanPath}`;
}

export function defineRouteSecurity(
	declaration: CoLocatedRouteSecurity,
): CoLocatedRouteSecurity {
	return declaration;
}

export function withRouteSecurity(
	prefix: string,
	declarations: readonly CoLocatedRouteSecurity[],
): CoLocatedRouteSecurity[] {
	return declarations.map((entry) => ({
		...entry,
		path: joinRoutePath(prefix, entry.path),
	}));
}
