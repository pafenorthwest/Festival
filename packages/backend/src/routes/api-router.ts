import { Hono } from "hono";
import type { ApiVariables } from "../auth/tenant-context.js";
import type { AuthRoutesType } from "./auth-router.js";
import {
	type ApiRouterOptions,
	buildCatalogGroupRoutes,
	buildCommerceGroupRoutes,
	buildCustomerGroupRoutes,
	buildDirectoryGroupRoutes,
	buildOrgAdminGroupRoutes,
	buildRegistrationGroupRoutes,
	buildVolunteersGroupRoutes,
	CATALOG_GROUP_ROUTE_SECURITY,
	type CatalogRoutesType,
	COMMERCE_GROUP_ROUTE_SECURITY,
	type CommerceRoutesType,
	CUSTOMER_GROUP_ROUTE_SECURITY,
	type CustomerRoutesType,
	DIRECTORY_GROUP_ROUTE_SECURITY,
	type DirectoryRoutesType,
	ORG_ADMIN_GROUP_ROUTE_SECURITY,
	type OrgAdminRoutesType,
	REGISTRATION_GROUP_ROUTE_SECURITY,
	type RegistrationRoutesType,
	VOLUNTEERS_GROUP_ROUTE_SECURITY,
	type VolunteersRoutesType,
} from "./route-groups.js";
import {
	type CoLocatedRouteSecurity,
	withRouteSecurity,
} from "./shared/route-security-metadata.js";

export type {
	ApiRouterOptions,
	AuthRoutesType,
	CatalogRoutesType,
	CommerceRoutesType,
	CustomerRoutesType,
	DirectoryRoutesType,
	OrgAdminRoutesType,
	RegistrationRoutesType,
	VolunteersRoutesType,
};

export const API_ROUTE_SECURITY = withRouteSecurity("/api", [
	...ORG_ADMIN_GROUP_ROUTE_SECURITY,
	...CATALOG_GROUP_ROUTE_SECURITY,
	...CUSTOMER_GROUP_ROUTE_SECURITY,
	...DIRECTORY_GROUP_ROUTE_SECURITY,
	...REGISTRATION_GROUP_ROUTE_SECURITY,
	...COMMERCE_GROUP_ROUTE_SECURITY,
	...VOLUNTEERS_GROUP_ROUTE_SECURITY,
]) as readonly CoLocatedRouteSecurity[];

export function buildApiRouter(options: ApiRouterOptions) {
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.route("/", buildOrgAdminGroupRoutes(options))
		.route("/", buildCatalogGroupRoutes(options))
		.route("/", buildCustomerGroupRoutes(options))
		.route("/", buildDirectoryGroupRoutes(options))
		.route("/", buildRegistrationGroupRoutes(options))
		.route("/", buildCommerceGroupRoutes(options))
		.route("/", buildVolunteersGroupRoutes(options));
}

export type ApiRoutesType = ReturnType<typeof buildApiRouter>;
