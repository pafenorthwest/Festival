import { API_ROUTE_SECURITY } from "./api-router.js";
import { AUTH_ROUTE_SECURITY } from "./auth-router.js";
import { PRIVATE_RUNTIME_ROUTE_SECURITY } from "./private-runtime.routes.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
	isAllowedPrivateRoutePath,
	isPrivateRouteAuthenticationClass,
	isReservedPrivateSurfacePath,
	ROUTE_AUTHENTICATION_CLASSES,
	type RouteAuthenticationClass,
	type RouteSecurityDeclaration,
	withRouteSecurity,
} from "./shared/route-security-metadata.js";

export {
	type CoLocatedRouteSecurity,
	isPrivateRouteAuthenticationClass,
	ROUTE_AUTHENTICATION_CLASSES,
	type RouteAuthenticationClass,
	type RouteSecurityDeclaration,
};

const ROOT_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/health",
		authenticationClass: "private-health",
		csrfRequired: false,
		browserAllowed: false,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/api/shopify/webhooks/orders-paid",
		authenticationClass: "shopify-webhook",
		csrfRequired: false,
		browserAllowed: false,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export const CURRENT_ROUTE_SECURITY = [
	ROOT_ROUTE_SECURITY[0],
	ROOT_ROUTE_SECURITY[1],
	...withRouteSecurity("/api/internal", PRIVATE_RUNTIME_ROUTE_SECURITY),
	...withRouteSecurity("/api/v1/auth", AUTH_ROUTE_SECURITY),
	...API_ROUTE_SECURITY,
] as const satisfies readonly CoLocatedRouteSecurity[];

interface RegisteredRoute {
	method: string;
	path: string;
}

function routeKey(route: RegisteredRoute): string {
	return `${route.method.toUpperCase()} ${route.path}`;
}

function validateDeclaration(
	declaration: RouteSecurityDeclaration,
	requireFullMetadata: boolean,
): string {
	const key = routeKey(declaration);
	const isPrivateClass = isPrivateRouteAuthenticationClass(
		declaration.authenticationClass,
	);
	if (isPrivateClass && !isAllowedPrivateRoutePath(declaration.path)) {
		throw new Error(
			`Private route boundary violation for ${key}: private authentication classes must use /health or /api/internal/*.`,
		);
	}
	if (!isPrivateClass && isReservedPrivateSurfacePath(declaration.path)) {
		throw new Error(
			`Private route boundary violation for ${key}: reserved private runtime paths cannot use public or browser authentication classes.`,
		);
	}
	const hasAnyMetadataField =
		declaration.csrfRequired !== undefined ||
		declaration.browserAllowed !== undefined;
	if (requireFullMetadata || hasAnyMetadataField) {
		if (
			typeof declaration.csrfRequired !== "boolean" ||
			typeof declaration.browserAllowed !== "boolean"
		) {
			throw new Error(
				`Incomplete route security metadata for ${key}: csrfRequired and browserAllowed booleans are required.`,
			);
		}
		if (
			(isPrivateClass ||
				declaration.authenticationClass === "shopify-webhook") &&
			declaration.browserAllowed
		) {
			throw new Error(
				`Browser exposure violation for ${key}: private and webhook routes must set browserAllowed=false.`,
			);
		}
	}
	return key;
}

function collectRegisteredKeys(
	routes: readonly RegisteredRoute[],
): Set<string> {
	return new Set(
		routes
			.filter(
				(route) =>
					!(
						route.method.toUpperCase() === "ALL" &&
						(route.path === "/api/*" || route.path === "/api/internal/*")
					),
			)
			.map(routeKey),
	);
}

export function assertRouteSecurityInventory(
	routes: readonly RegisteredRoute[],
	declarations: readonly RouteSecurityDeclaration[] = CURRENT_ROUTE_SECURITY,
): void {
	const requireFullMetadata = declarations === CURRENT_ROUTE_SECURITY;
	const declaredKeys = new Set<string>();
	for (const declaration of declarations) {
		const key = validateDeclaration(declaration, requireFullMetadata);
		if (declaredKeys.has(key)) {
			throw new Error(`Duplicate route security declaration: ${key}`);
		}
		declaredKeys.add(key);
	}

	const registeredKeys = collectRegisteredKeys(routes);
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
