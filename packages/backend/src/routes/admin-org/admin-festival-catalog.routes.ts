import {
	CreateClassSubtypeInputSchema,
	type CreateFestivalClassInput,
	CreateFestivalClassInputSchema,
	type CreateRoomInput,
	CreateRoomInputSchema,
	type UpdateFestivalClassInput,
	UpdateFestivalClassInputSchema,
} from "@festival/common";
import type { Context } from "hono";
import { Hono } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../../auth/tenant-context.js";
import type { AuthVerifier } from "../../auth/types.js";
import { AppError } from "../../errors/app-error.js";
import type { OrganizationService } from "../../services/organization-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import { jsonValidator } from "../shared/schema-validator.js";

const adminRoute = (method: CoLocatedRouteSecurity["method"], path: string) =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	});

export const ADMIN_FESTIVAL_CATALOG_ROUTE_SECURITY = [
	adminRoute(
		"GET",
		"/organizations/:slug/admin/festivals/:festivalShortName/class-subtypes",
	),
	adminRoute(
		"POST",
		"/organizations/:slug/admin/festivals/:festivalShortName/class-subtypes",
	),
	adminRoute(
		"GET",
		"/organizations/:slug/admin/festivals/:festivalShortName/rooms",
	),
	adminRoute(
		"POST",
		"/organizations/:slug/admin/festivals/:festivalShortName/rooms",
	),
	adminRoute(
		"GET",
		"/organizations/:slug/admin/festivals/:festivalShortName/classes",
	),
	adminRoute(
		"POST",
		"/organizations/:slug/admin/festivals/:festivalShortName/classes",
	),
	adminRoute(
		"PATCH",
		"/organizations/:slug/admin/festivals/:festivalShortName/classes/:classId",
	),
	adminRoute(
		"POST",
		"/organizations/:slug/admin/festivals/:festivalShortName/classes/:classId",
	),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface AdminOrgRoutesOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
}

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

export function assertAdminOrgAllowedFields(
	payload: unknown,
	allowed: readonly string[],
	label: string,
): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
	const allowedFields = new Set(allowed);
	const extraFields = Object.keys(payload).filter(
		(field) => !allowedFields.has(field),
	);
	if (extraFields.length > 0) {
		throw new AppError(
			`${label} cannot include browser-controlled fields: ${extraFields.join(", ")}.`,
			400,
		);
	}
}

export async function withAdminOrgJson<T>(
	c: ApiContext,
	fn: () => Promise<T>,
	status: 200 | 201 = 200,
) {
	try {
		return c.json(await fn(), status);
	} catch (error) {
		return toJsonError(c, error);
	}
}

function handleListFestivalClassSubtypes(
	c: ApiContext,
	organizationService: OrganizationService,
) {
	return withAdminOrgJson(c, () =>
		organizationService.listFestivalClassSubtypesForTenant(
			getRequiredTenant(c),
			c.req.param("festivalShortName") ?? "",
		),
	);
}

function handleCreateFestivalClassSubtype(
	c: ApiContext,
	organizationService: OrganizationService,
	payload: { displayName: string; requiredSubtypeId?: string | null },
) {
	return withAdminOrgJson(
		c,
		() =>
			organizationService.createFestivalClassSubtypeForTenant(
				getRequiredTenant(c),
				c.req.param("festivalShortName") ?? "",
				payload.displayName,
				payload.requiredSubtypeId,
			),
		201,
	);
}

function handleListRooms(
	c: ApiContext,
	organizationService: OrganizationService,
) {
	return withAdminOrgJson(c, () =>
		organizationService.listRoomsForTenant(
			getRequiredTenant(c),
			c.req.param("festivalShortName") ?? "",
		),
	);
}

function handleCreateRoom(
	c: ApiContext,
	organizationService: OrganizationService,
	payload: CreateRoomInput,
) {
	return withAdminOrgJson(
		c,
		() =>
			organizationService.createRoomForTenant(
				getRequiredTenant(c),
				c.req.param("festivalShortName") ?? "",
				payload,
			),
		201,
	);
}

function handleListFestivalClasses(
	c: ApiContext,
	organizationService: OrganizationService,
) {
	return withAdminOrgJson(c, () =>
		organizationService.listFestivalClasses(
			getRequiredTenant(c).organization.slug,
			c.req.param("festivalShortName") ?? "",
		),
	);
}

function handleCreateFestivalClass(
	c: ApiContext,
	organizationService: OrganizationService,
	payload: CreateFestivalClassInput,
) {
	return withAdminOrgJson(c, () => {
		const tenant = getRequiredTenant(c);
		return organizationService.createFestivalClass(
			tenant.organization.slug,
			c.req.param("festivalShortName") ?? "",
			payload as Parameters<OrganizationService["createFestivalClass"]>[2],
			tenant.identity.uid,
		);
	});
}

function handleUpdateFestivalClass(
	c: ApiContext,
	organizationService: OrganizationService,
	payload: UpdateFestivalClassInput,
) {
	return withAdminOrgJson(c, () => {
		const tenant = getRequiredTenant(c);
		return organizationService.updateFestivalClass(
			tenant.organization.slug,
			c.req.param("festivalShortName") ?? "",
			c.req.param("classId") ?? "",
			payload,
			tenant.identity.uid,
		);
	});
}

function buildSubtypeAndRoomRoutes(options: AdminOrgRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/organizations/:slug/admin/festivals/:festivalShortName/class-subtypes",
			auth,
			tenant,
			admin,
			(c) => handleListFestivalClassSubtypes(c, organizationService),
		)
		.post(
			"/organizations/:slug/admin/festivals/:festivalShortName/class-subtypes",
			auth,
			tenant,
			admin,
			jsonValidator(CreateClassSubtypeInputSchema, {
				preCheck: (raw) =>
					assertAdminOrgAllowedFields(
						raw,
						["displayName", "requiredSubtypeId"],
						"Festival class subtype request",
					),
			}),
			(c) =>
				handleCreateFestivalClassSubtype(
					c,
					organizationService,
					c.req.valid("json"),
				),
		)
		.get(
			"/organizations/:slug/admin/festivals/:festivalShortName/rooms",
			auth,
			tenant,
			admin,
			(c) => handleListRooms(c, organizationService),
		)
		.post(
			"/organizations/:slug/admin/festivals/:festivalShortName/rooms",
			auth,
			tenant,
			admin,
			jsonValidator(CreateRoomInputSchema, {
				preCheck: (raw) =>
					assertAdminOrgAllowedFields(
						raw,
						["name", "pianoConfigurations"],
						"Room request",
					),
			}),
			(c) => handleCreateRoom(c, organizationService, c.req.valid("json")),
		);
}

function buildFestivalClassRoutes(options: AdminOrgRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);
	const validateClassUpdate = jsonValidator(UpdateFestivalClassInputSchema);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/organizations/:slug/admin/festivals/:festivalShortName/classes",
			auth,
			tenant,
			admin,
			(c) => handleListFestivalClasses(c, organizationService),
		)
		.post(
			"/organizations/:slug/admin/festivals/:festivalShortName/classes",
			auth,
			tenant,
			admin,
			jsonValidator(CreateFestivalClassInputSchema),
			(c) =>
				handleCreateFestivalClass(c, organizationService, c.req.valid("json")),
		)
		.patch(
			"/organizations/:slug/admin/festivals/:festivalShortName/classes/:classId",
			auth,
			tenant,
			admin,
			validateClassUpdate,
			(c) =>
				handleUpdateFestivalClass(c, organizationService, c.req.valid("json")),
		)
		.post(
			"/organizations/:slug/admin/festivals/:festivalShortName/classes/:classId",
			auth,
			tenant,
			admin,
			validateClassUpdate,
			(c) =>
				handleUpdateFestivalClass(c, organizationService, c.req.valid("json")),
		);
}

export function buildAdminFestivalCatalogRoutes(
	options: AdminOrgRoutesOptions,
) {
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.route("/", buildSubtypeAndRoomRoutes(options))
		.route("/", buildFestivalClassRoutes(options));
}
