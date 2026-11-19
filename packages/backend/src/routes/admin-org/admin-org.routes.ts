import {
	type CreateFestivalInput,
	CreateFestivalInputSchema,
	CreateOrganizationDivisionInputSchema,
	ReorderOrganizationDivisionsInputSchema,
	type UpdateFestivalRegistrationWindowInput,
	UpdateFestivalRegistrationWindowInputSchema,
	UpdateOrganizationDivisionInputSchema,
	UpdateOrganizationTimezoneInputSchema,
} from "@festival/common";
import type { Context } from "hono";
import { Hono } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
} from "../../auth/tenant-context.js";
import { requireAdminIntent } from "../../auth/volunteer-context.js";
import type { OrganizationService } from "../../services/organization-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import { jsonValidator } from "../shared/schema-validator.js";
import {
	ADMIN_FESTIVAL_CATALOG_ROUTE_SECURITY,
	type AdminOrgRoutesOptions,
	assertAdminOrgAllowedFields,
	buildAdminFestivalCatalogRoutes,
	withAdminOrgJson,
} from "./admin-festival-catalog.routes.js";

const coreRoute = (
	method: CoLocatedRouteSecurity["method"],
	path: string,
	authenticationClass: CoLocatedRouteSecurity["authenticationClass"] = "admin",
) =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass,
		csrfRequired: false,
		browserAllowed: true,
	});

export const ADMIN_ORG_CORE_ROUTE_SECURITY = [
	coreRoute("GET", "/organizations/:slug/admin/users"),
	coreRoute("DELETE", "/organizations/:slug/admin/memberships/:membershipId"),
	coreRoute("DELETE", "/organizations/:slug/admin/invites/:inviteId"),
	coreRoute("GET", "/organizations/:slug/admin/festivals", "volunteer-admin"),
	coreRoute("POST", "/organizations/:slug/admin/festivals"),
	coreRoute(
		"POST",
		"/organizations/:slug/admin/festivals/:festivalShortName/primary",
	),
	coreRoute("GET", "/organizations/:slug/admin/festivals/:festivalShortName"),
	coreRoute(
		"PUT",
		"/organizations/:slug/admin/festivals/:festivalShortName/registration-window",
	),
	coreRoute(
		"PATCH",
		"/organizations/:slug/admin/festivals/:festivalShortName/registration-window",
	),
	coreRoute("GET", "/organizations/:slug/admin/divisions"),
	coreRoute("POST", "/organizations/:slug/admin/divisions"),
	coreRoute("POST", "/organizations/:slug/admin/divisions/reorder"),
	coreRoute("POST", "/organizations/:slug/admin/divisions/:divisionId"),
	coreRoute("GET", "/organizations/:slug/admin/timezone"),
	coreRoute("POST", "/organizations/:slug/admin/timezone"),
] as const satisfies readonly CoLocatedRouteSecurity[];

export { ADMIN_FESTIVAL_CATALOG_ROUTE_SECURITY };

export const ADMIN_ORG_ROUTE_SECURITY = [
	...ADMIN_ORG_CORE_ROUTE_SECURITY,
	...ADMIN_FESTIVAL_CATALOG_ROUTE_SECURITY,
] as const satisfies readonly CoLocatedRouteSecurity[];

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

function handleCreateFestival(
	c: ApiContext,
	organizationService: OrganizationService,
	payload: CreateFestivalInput,
) {
	return withAdminOrgJson(
		c,
		() =>
			organizationService.createFestivalForTenant(
				getRequiredTenant(c),
				payload,
			),
		201,
	);
}

function handleUpdateRegistrationWindow(
	c: ApiContext,
	organizationService: OrganizationService,
	payload: UpdateFestivalRegistrationWindowInput,
) {
	return withAdminOrgJson(c, () =>
		organizationService.updateFestivalRegistrationWindowForTenant(
			getRequiredTenant(c),
			c.req.param("festivalShortName") ?? "",
			payload,
		),
	);
}

function buildAdminOrgMemberRoutes(options: AdminOrgRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/organizations/:slug/admin/users", auth, tenant, admin, (c) =>
			withAdminOrgJson(c, () =>
				organizationService.listAdminUsersForTenant(getRequiredTenant(c)),
			),
		)
		.delete(
			"/organizations/:slug/admin/memberships/:membershipId",
			auth,
			tenant,
			admin,
			(c) =>
				withAdminOrgJson(c, () =>
					organizationService.deleteMembershipForTenant(
						getRequiredTenant(c),
						c.req.param("membershipId"),
					),
				),
		)
		.delete(
			"/organizations/:slug/admin/invites/:inviteId",
			auth,
			tenant,
			admin,
			(c) =>
				withAdminOrgJson(c, () =>
					organizationService.cancelInviteForTenant(
						getRequiredTenant(c),
						c.req.param("inviteId"),
					),
				),
		);
}

function buildAdminOrgFestivalCollectionRoutes(options: AdminOrgRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/organizations/:slug/admin/festivals",
			auth,
			tenant,
			requireAdminIntent(),
			(c) =>
				withAdminOrgJson(c, () =>
					organizationService.listFestivalsForTenant(getRequiredTenant(c)),
				),
		)
		.post(
			"/organizations/:slug/admin/festivals",
			auth,
			tenant,
			admin,
			jsonValidator(CreateFestivalInputSchema),
			(c) => handleCreateFestival(c, organizationService, c.req.valid("json")),
		);
}

function buildAdminOrgFestivalItemRoutes(options: AdminOrgRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.post(
			"/organizations/:slug/admin/festivals/:festivalShortName/primary",
			auth,
			tenant,
			admin,
			(c) =>
				withAdminOrgJson(c, () =>
					organizationService.setPrimaryFestivalForTenant(
						getRequiredTenant(c),
						c.req.param("festivalShortName"),
					),
				),
		)
		.get(
			"/organizations/:slug/admin/festivals/:festivalShortName",
			auth,
			tenant,
			admin,
			(c) =>
				withAdminOrgJson(c, () =>
					organizationService.getAdminFestivalForTenant(
						getRequiredTenant(c),
						c.req.param("festivalShortName"),
					),
				),
		);
}

function buildAdminOrgRegistrationWindowRoutes(options: AdminOrgRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);
	const windowPath =
		"/organizations/:slug/admin/festivals/:festivalShortName/registration-window" as const;

	const validateWindow = jsonValidator(
		UpdateFestivalRegistrationWindowInputSchema,
		{
			errorCode: "invalid_registration_window",
			preCheck: (raw) =>
				assertAdminOrgAllowedFields(
					raw,
					["registrationOpensAt", "registrationClosesAt"],
					"Festival registration window request",
				),
		},
	);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.put(windowPath, auth, tenant, admin, validateWindow, (c) =>
			handleUpdateRegistrationWindow(
				c,
				organizationService,
				c.req.valid("json"),
			),
		)
		.patch(windowPath, auth, tenant, admin, validateWindow, (c) =>
			handleUpdateRegistrationWindow(
				c,
				organizationService,
				c.req.valid("json"),
			),
		);
}

function buildAdminOrgDivisionCollectionRoutes(options: AdminOrgRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/organizations/:slug/admin/divisions", auth, tenant, admin, (c) =>
			withAdminOrgJson(c, () =>
				organizationService.listDivisionsForTenant(getRequiredTenant(c)),
			),
		)
		.post(
			"/organizations/:slug/admin/divisions",
			auth,
			tenant,
			admin,
			jsonValidator(CreateOrganizationDivisionInputSchema),
			(c) =>
				withAdminOrgJson(
					c,
					() =>
						organizationService.createDivisionForTenant(
							getRequiredTenant(c),
							c.req.valid("json"),
						),
					201,
				),
		);
}

function buildAdminOrgDivisionMutationRoutes(options: AdminOrgRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.post(
			"/organizations/:slug/admin/divisions/reorder",
			auth,
			tenant,
			admin,
			jsonValidator(ReorderOrganizationDivisionsInputSchema),
			(c) =>
				withAdminOrgJson(c, () =>
					organizationService.reorderDivisionsForTenant(
						getRequiredTenant(c),
						c.req.valid("json"),
					),
				),
		)
		.post(
			"/organizations/:slug/admin/divisions/:divisionId",
			auth,
			tenant,
			admin,
			jsonValidator(UpdateOrganizationDivisionInputSchema),
			(c) =>
				withAdminOrgJson(c, () =>
					organizationService.updateDivisionForTenant(
						getRequiredTenant(c),
						c.req.param("divisionId"),
						c.req.valid("json"),
					),
				),
		);
}

function buildAdminOrgTimezoneRoutes(options: AdminOrgRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/organizations/:slug/admin/timezone", auth, tenant, admin, (c) =>
			withAdminOrgJson(c, () =>
				organizationService.getTimezoneForTenant(getRequiredTenant(c)),
			),
		)
		.post(
			"/organizations/:slug/admin/timezone",
			auth,
			tenant,
			admin,
			jsonValidator(UpdateOrganizationTimezoneInputSchema),
			(c) =>
				withAdminOrgJson(c, () =>
					organizationService.updateTimezoneForTenant(
						getRequiredTenant(c),
						c.req.valid("json"),
					),
				),
		);
}

export function buildAdminOrgCoreRoutes(options: AdminOrgRoutesOptions) {
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.route("/", buildAdminOrgMemberRoutes(options))
		.route("/", buildAdminOrgFestivalCollectionRoutes(options))
		.route("/", buildAdminOrgFestivalItemRoutes(options))
		.route("/", buildAdminOrgRegistrationWindowRoutes(options))
		.route("/", buildAdminOrgDivisionCollectionRoutes(options))
		.route("/", buildAdminOrgDivisionMutationRoutes(options))
		.route("/", buildAdminOrgTimezoneRoutes(options));
}

export function buildAdminOrgRoutes(options: AdminOrgRoutesOptions) {
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.route("/", buildAdminOrgCoreRoutes(options))
		.route("/", buildAdminFestivalCatalogRoutes(options));
}
