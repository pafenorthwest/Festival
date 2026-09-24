import type { OrganizationRole } from "@festival/common";
import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	type ApiVariables,
	getRequiredIdentity,
	requireTenantRole,
	toJsonError,
	type VolunteerScope,
} from "./tenant-context.js";

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

/**
 * The organization roles that count as "admin intent" for the volunteer
 * portal. Per VOLUNTEER-PORTAL.md: "This applies to every Festival
 * administrative role, including Admin, Division Chair, Concert Chair,
 * and equivalent admin roles." This is intentionally broader than the
 * plain ["Admin"] check most other admin routes in this app use.
 */
export const VOLUNTEER_ADMIN_ROLES: readonly OrganizationRole[] = [
	"Admin",
	"Division Chair",
	"Concert Chair",
];

/**
 * Resolves a volunteer's scope: the organization and festival named in
 * the route, for the currently authenticated Firebase user. Unlike
 * resolveTenantContext, this never requires organization membership —
 * a volunteer who has never joined the organization can still resolve
 * this scope, which is the point of the separate authorization model
 * the spec introduces.
 */
export async function resolveVolunteerScope(
	c: ApiContext,
	repository: OrganizationRepository,
	slugParam = "slug",
	festivalParam = "festivalShortName",
): Promise<VolunteerScope> {
	const identity = getRequiredIdentity(c);

	const slug = c.req.param(slugParam);
	const festivalShortName = c.req.param(festivalParam);
	if (!slug || !festivalShortName) {
		throw new AppError("Organization and festival are required.", 400);
	}

	const organization = await repository.findOrganizationBySlug(slug);
	if (!organization) throw new AppError("Organization not found.", 404);

	const festival = await repository.findFestivalByShortName(
		organization.id,
		festivalShortName,
	);
	if (!festival) throw new AppError("Festival not found.", 404);

	return { identity, organization, festival };
}

/**
 * Guards a volunteer-portal route: requires Firebase authentication
 * (via requireAuth, applied earlier in the chain) and resolves the
 * organization + festival the route names, attaching it as
 * `volunteerScope`. It does not by itself resolve *which* volunteer is
 * calling, or check that a volunteer enrollment exists — routes that
 * act on a specific volunteer's own data should additionally look up
 * that volunteer's enrollment (see the /volunteers/enroll route) and
 * enforce that a caller can only read or modify their own record.
 */
export function requireVolunteerScope(
	repository: OrganizationRepository,
	slugParam = "slug",
	festivalParam = "festivalShortName",
): MiddlewareHandler<{ Variables: Partial<ApiVariables> }> {
	return async (c, next) => {
		try {
			const scope = await resolveVolunteerScope(
				c,
				repository,
				slugParam,
				festivalParam,
			);
			c.set("volunteerScope", scope);
			await next();
		} catch (error) {
			return toJsonError(c, error);
		}
	};
}

export function getRequiredVolunteerScope(c: ApiContext): VolunteerScope {
	const scope = c.var.volunteerScope;
	if (!scope) throw new AppError("Volunteer context required.", 500);
	return scope;
}

/**
 * Guards an admin-facing volunteer-portal route: requires the caller to
 * hold one of VOLUNTEER_ADMIN_ROLES within the organization. Compose
 * after requireAuth + requireTenant, the same as requireTenantRole.
 */
export function requireAdminIntent(): MiddlewareHandler<{
	Variables: Partial<ApiVariables>;
}> {
	return requireTenantRole(VOLUNTEER_ADMIN_ROLES);
}
