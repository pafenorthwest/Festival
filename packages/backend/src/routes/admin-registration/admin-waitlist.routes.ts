import { type Context, Hono } from "hono";
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
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";

type AdminEnv = { Variables: Partial<ApiVariables> };

export const ADMIN_WAITLIST_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/festivals/:festivalShortName/classes/:classId/waitlist",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface AdminWaitlistRoutesDeps {
	waitlistService?: WaitlistService;
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
}

async function handleGetClassWaitlistRoster(
	c: Context<AdminEnv>,
	deps: AdminWaitlistRoutesDeps,
) {
	try {
		if (!deps.waitlistService) {
			throw new AppError("Waitlist service is unavailable.", 503);
		}
		const tenant = getRequiredTenant(c);
		const actor = getRequiredIdentity(c);
		const festivalShortName = c.req.param("festivalShortName");
		const classId = c.req.param("classId");
		if (!festivalShortName || !classId) {
			throw new AppError("Festival short name and class ID are required.", 400);
		}

		const festival = await deps.repository.findFestivalByShortName(
			tenant.organization.id,
			festivalShortName,
		);
		if (!festival) {
			throw new AppError("Festival not found.", 404);
		}

		const roster = await deps.waitlistService.listClassWaitlistRosterForAdmin({
			organizationId: tenant.organization.id,
			festivalId: festival.id,
			classId,
			actorUid: actor.uid,
		});

		return c.json({ roster });
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildAdminWaitlistRoutes(deps: AdminWaitlistRoutesDeps) {
	const { authVerifier, repository } = deps;
	return new Hono<AdminEnv>().get(
		"/organizations/:slug/festivals/:festivalShortName/classes/:classId/waitlist",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		(c) => handleGetClassWaitlistRoster(c, deps),
	);
}
