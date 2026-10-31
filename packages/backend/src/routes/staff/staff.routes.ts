import {
	parseEntitlementReportFilters,
	parseEntitlementReportPage,
} from "@festival/common";
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

	router.get(
		"/organizations/:slug/admin/entitlements",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!accompanistMembershipService)
					throw new AppError("Entitlement report is unavailable.", 503);
				let filters: ReturnType<typeof parseEntitlementReportFilters>;
				let pageRequest: ReturnType<typeof parseEntitlementReportPage>;
				try {
					filters = parseEntitlementReportFilters({
						search: c.req.query("search"),
						entitlementClass: c.req.query("entitlementClass"),
						status: c.req.query("status"),
						divisionId: c.req.query("divisionId"),
					});
					pageRequest = parseEntitlementReportPage({
						page: c.req.query("page"),
						pageSize: c.req.query("pageSize"),
					});
				} catch (error) {
					throw new AppError(
						error instanceof Error ? error.message : "Report query is invalid.",
						400,
					);
				}
				const report = await accompanistMembershipService.listEntitlementReport(
					getRequiredTenant(c).organization.id,
					filters,
					pageRequest,
				);
				c.header("Cache-Control", "no-store");
				return c.json(report);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
