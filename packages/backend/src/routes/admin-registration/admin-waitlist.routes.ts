import { Hono } from "hono";
import {
	type ApiVariables,
	getRequiredIdentity,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../../auth/tenant-context.js";
import type { AuthVerifier } from "../../auth/types.js";
import { AppError } from "../../errors/app-error.js";
import type { OrganizationRepository } from "../../repo/organization-repository.js";
import type { WaitlistService } from "../../waitlist/waitlist-service.js";

type AdminEnv = { Variables: Partial<ApiVariables> };

export interface AdminWaitlistRoutesDeps {
	waitlistService?: WaitlistService;
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
}

export function buildAdminWaitlistRoutes(
	deps: AdminWaitlistRoutesDeps,
): Hono<AdminEnv> {
	const router = new Hono<AdminEnv>();
	const { waitlistService, authVerifier, repository } = deps;

	router.get(
		"/organizations/:slug/festivals/:festivalShortName/classes/:classId/waitlist",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!waitlistService) {
					throw new AppError("Waitlist service is unavailable.", 503);
				}
				const tenant = getRequiredTenant(c);
				const actor = getRequiredIdentity(c);
				const festivalShortName = c.req.param("festivalShortName");
				const classId = c.req.param("classId");

				const festival = await repository.findFestivalByShortName(
					tenant.organization.id,
					festivalShortName,
				);
				if (!festival) {
					throw new AppError("Festival not found.", 404);
				}

				const roster = await waitlistService.listClassWaitlistRosterForAdmin({
					organizationId: tenant.organization.id,
					festivalId: festival.id,
					classId,
					actorUid: actor.uid,
				});

				return c.json({ roster });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
