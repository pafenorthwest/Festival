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
import type { OrganizationService } from "../../services/organization-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";

const orgInfoRoute = (
	method: CoLocatedRouteSecurity["method"],
	path: string,
	authenticationClass: CoLocatedRouteSecurity["authenticationClass"],
) =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass,
		csrfRequired: false,
		browserAllowed: true,
	});

export const ORG_INFO_TENANT_ROUTE_SECURITY = [
	orgInfoRoute("GET", "/", "tenant"),
	orgInfoRoute("POST", "/welcome/dismiss", "tenant"),
] as const satisfies readonly CoLocatedRouteSecurity[];

export const ORG_INFO_PUBLIC_ROUTE_SECURITY = [
	orgInfoRoute("GET", "/primary", "public"),
	orgInfoRoute("GET", "/festivals/:festivalShortName", "public"),
	orgInfoRoute("GET", "/divisions", "public"),
	orgInfoRoute("GET", "/landing", "public"),
] as const satisfies readonly CoLocatedRouteSecurity[];

export const ORG_INFO_ROUTE_SECURITY = [
	...ORG_INFO_TENANT_ROUTE_SECURITY,
	...ORG_INFO_PUBLIC_ROUTE_SECURITY,
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface OrgInfoRoutesOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
}

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

function requireOrgSlug(c: ApiContext): string {
	const slug = c.req.param("slug");
	if (!slug) throw new AppError("Organization is required.", 400);
	return slug;
}

async function withOrgInfoJson<T>(c: ApiContext, fn: () => Promise<T> | T) {
	try {
		return c.json(await fn());
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildOrgInfoTenantRoutes(options: OrgInfoRoutesOptions) {
	const { organizationService, authVerifier, repository } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(repository);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/", auth, tenant, (c) =>
			withOrgInfoJson(c, () =>
				organizationService.getOrganizationLandingForTenant(
					getRequiredTenant(c),
				),
			),
		)
		.post(
			"/welcome/dismiss",
			auth,
			tenant,
			requireTenantRole([
				"Admin",
				"Division Chair",
				"Music Reviewer",
				"Concert Chair",
				"Read Only",
			]),
			(c) =>
				withOrgInfoJson(c, () =>
					organizationService.dismissWelcomeForTenant(getRequiredTenant(c)),
				),
		);
}

export function buildOrgInfoPublicRoutes(
	options: Pick<OrgInfoRoutesOptions, "organizationService">,
) {
	const { organizationService } = options;

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/primary", (c) =>
			withOrgInfoJson(c, () =>
				organizationService.getPrimaryFestivalPath(requireOrgSlug(c)),
			),
		)
		.get("/festivals/:festivalShortName", (c) =>
			withOrgInfoJson(c, () =>
				organizationService.getPublicFestival(
					requireOrgSlug(c),
					c.req.param("festivalShortName"),
				),
			),
		)
		.get("/divisions", (c) =>
			withOrgInfoJson(c, () =>
				organizationService.listPublicDivisions(requireOrgSlug(c)),
			),
		)
		.get("/landing", (c) =>
			withOrgInfoJson(c, () =>
				organizationService.getPublicLanding(requireOrgSlug(c)),
			),
		);
}

export function buildOrgInfoRoutes(options: OrgInfoRoutesOptions) {
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.route("/", buildOrgInfoTenantRoutes(options))
		.route("/", buildOrgInfoPublicRoutes(options));
}
