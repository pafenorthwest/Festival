import { Hono } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { VolunteerRepository } from "../volunteers/volunteer-repository.js";

export interface VolunteerRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	volunteerRepository?: VolunteerRepository;
}

/**
 * Builds the volunteer sub-router.
 *
 * This router is mounted under `/organizations/:slug/festivals/:festivalShortName/volunteers`.
 * All volunteer activity — roles, slots, assignments, and enrollment — is scoped to a single
 * festival. The `:festivalShortName` param is accessible from handler context via
 * `c.req.param("festivalShortName")` and must be used by future handlers to enforce
 * festival isolation per specs/VOLUNTEER-PORTAL.md.
 */
export function buildVolunteerRoutes(
	options: VolunteerRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();

	router.get(
		"/roles",
		requireAuth(options.authVerifier),
		requireTenant(options.repository),
		async (c) => {
			try {
				if (!options.volunteerRepository) {
					throw new AppError("Volunteer roles are unavailable.", 503);
				}
				const tenant = getRequiredTenant(c);
				return c.json(
					await options.volunteerRepository.listRoles(tenant.organization.id),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
