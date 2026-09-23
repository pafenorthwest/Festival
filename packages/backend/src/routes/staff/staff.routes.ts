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
import type { OrganizationRepository } from "../../repo/organization-repository.js";
import type { AccompanistMembershipService } from "../../services/accompanist-membership-service.js";

export function buildStaffRoutes(options: {
	repository: OrganizationRepository;
	authVerifier: AuthVerifier;
	accompanistMembershipService?: AccompanistMembershipService;
}): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { repository, authVerifier, accompanistMembershipService } = options;

	router.get(
		"/organizations/:slug/staff/accompanists",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin", "Division Chair", "Concert Chair"]),
		async (c) => {
			try {
				if (!accompanistMembershipService)
					throw new AppError("Accompanist roster is unavailable.", 503);
				return c.json(
					await accompanistMembershipService.listCurrentRoster(
						getRequiredTenant(c).organization.id,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
