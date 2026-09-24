import type { CreateFestivalInput } from "@festival/common";
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
import { requireAdminIntent } from "../../auth/volunteer-context.js";
import { AppError } from "../../errors/app-error.js";
import type { OrganizationService } from "../../services/organization-service.js";

function assertAllowedFields(
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

export function buildAdminOrgRoutes(options: {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
}): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { organizationService, authVerifier } = options;
	const repository = organizationService.repository;

	router.get(
		"/organizations/:slug/admin/users",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listAdminUsersForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.delete(
		"/organizations/:slug/admin/memberships/:membershipId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.deleteMembershipForTenant(
						getRequiredTenant(c),
						c.req.param("membershipId"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.delete(
		"/organizations/:slug/admin/invites/:inviteId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.cancelInviteForTenant(
						getRequiredTenant(c),
						c.req.param("inviteId"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/festivals",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireAdminIntent(),
		async (c) => {
			try {
				return c.json(
					await organizationService.listFestivalsForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/festivals",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = (await c.req.json()) as CreateFestivalInput;
				c.status(201);
				return c.json(
					await organizationService.createFestivalForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/festivals/:festivalShortName/primary",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.setPrimaryFestivalForTenant(
						getRequiredTenant(c),
						c.req.param("festivalShortName"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/festivals/:festivalShortName",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.getAdminFestivalForTenant(
						getRequiredTenant(c),
						c.req.param("festivalShortName"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/festivals/:festivalShortName/classes",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listFestivalClasses(
						getRequiredTenant(c).organization.slug,
						c.req.param("festivalShortName"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/festivals/:festivalShortName/classes",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.createFestivalClass(
						getRequiredTenant(c).organization.slug,
						c.req.param("festivalShortName"),
						await c.req.json(),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.patch(
		"/organizations/:slug/admin/festivals/:festivalShortName/classes/:classId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.updateFestivalClass(
						getRequiredTenant(c).organization.slug,
						c.req.param("festivalShortName"),
						c.req.param("classId"),
						await c.req.json(),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/festivals/:festivalShortName/classes/:classId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.updateFestivalClass(
						getRequiredTenant(c).organization.slug,
						c.req.param("festivalShortName"),
						c.req.param("classId"),
						await c.req.json(),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/divisions",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listDivisionsForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/divisions",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["displayName"],
					"Division create request",
				);
				c.status(201);
				return c.json(
					await organizationService.createDivisionForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/divisions/reorder",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["divisionIds"],
					"Division reorder request",
				);
				return c.json(
					await organizationService.reorderDivisionsForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/divisions/:divisionId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["displayName", "isActive"],
					"Division update request",
				);
				return c.json(
					await organizationService.updateDivisionForTenant(
						getRequiredTenant(c),
						c.req.param("divisionId"),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/timezone",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.getTimezoneForTenant(getRequiredTenant(c)),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/timezone",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(payload, ["timezone"], "Timezone update request");
				return c.json(
					await organizationService.updateTimezoneForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
