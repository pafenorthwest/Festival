import {
	EntitlementReportQuerySchema,
	parseEntitlementReportFilters,
	parseEntitlementReportPage,
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
import type { OrganizationRepository } from "../../repo/organization-repository.js";
import type { AccompanistMembershipService } from "../../services/accompanist-membership-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import { queryValidator } from "../shared/schema-validator.js";

export const STAFF_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/staff/accompanists",
		authenticationClass: "firebase",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/admin/entitlements",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

function parseEntitlementQuery(raw: {
	search?: string;
	entitlementClass?: string;
	status?: string;
	divisionId?: string;
	page?: string;
	pageSize?: string;
}) {
	try {
		return {
			filters: parseEntitlementReportFilters({
				search: raw.search,
				entitlementClass: raw.entitlementClass,
				status: raw.status,
				divisionId: raw.divisionId,
			}),
			pageRequest: parseEntitlementReportPage({
				page: raw.page,
				pageSize: raw.pageSize,
			}),
		};
	} catch (error) {
		throw new AppError(
			error instanceof Error ? error.message : "Report query is invalid.",
			400,
		);
	}
}

async function handleStaffAccompanists(
	c: ApiContext,
	accompanistMembershipService?: AccompanistMembershipService,
) {
	try {
		if (!accompanistMembershipService) {
			throw new AppError("Accompanist roster is unavailable.", 503);
		}
		return c.json(
			await accompanistMembershipService.listCurrentRoster(
				getRequiredTenant(c).organization.id,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleAdminEntitlements(
	c: ApiContext,
	rawQuery: {
		search?: string;
		entitlementClass?: string;
		status?: string;
		divisionId?: string;
		page?: string;
		pageSize?: string;
	},
	accompanistMembershipService?: AccompanistMembershipService,
) {
	try {
		if (!accompanistMembershipService) {
			throw new AppError("Entitlement report is unavailable.", 503);
		}
		const { filters, pageRequest } = parseEntitlementQuery(rawQuery);
		const organizationId = getRequiredTenant(c).organization.id;
		const [report, summaryCounts] = await Promise.all([
			accompanistMembershipService.listEntitlementReport(
				organizationId,
				filters,
				pageRequest,
			),
			accompanistMembershipService.getSummaryCounts(organizationId),
		]);
		c.header("Cache-Control", "no-store");
		return c.json({ ...report, summaryCounts });
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildStaffRoutes(options: {
	repository: OrganizationRepository;
	authVerifier: AuthVerifier;
	accompanistMembershipService?: AccompanistMembershipService;
}) {
	const { repository, authVerifier, accompanistMembershipService } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(repository);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/organizations/:slug/staff/accompanists",
			auth,
			tenant,
			requireTenantRole(["Admin", "Division Chair", "Concert Chair"]),
			(c) => handleStaffAccompanists(c, accompanistMembershipService),
		)
		.get(
			"/organizations/:slug/admin/entitlements",
			auth,
			tenant,
			requireTenantRole(["Admin"]),
			queryValidator(EntitlementReportQuerySchema),
			(c) =>
				handleAdminEntitlements(
					c,
					c.req.valid("query"),
					accompanistMembershipService,
				),
		);
}
