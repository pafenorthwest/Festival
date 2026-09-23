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

export interface OrgInfoRoutesOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
}

export function buildOrgInfoRoutes(
	options: OrgInfoRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const { organizationService, authVerifier, repository } = options;
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();

	// Tenant: org landing
	router.get(
		"/",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				return c.json(
					organizationService.getOrganizationLandingForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// Tenant: dismiss welcome banner
	router.post(
		"/welcome/dismiss",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole([
			"Admin",
			"Division Chair",
			"Music Reviewer",
			"Concert Chair",
			"Read Only",
		]),
		async (c) => {
			try {
				return c.json(
					await organizationService.dismissWelcomeForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// Public: primary festival redirect target
	router.get("/primary", async (c) => {
		try {
			const slug = c.req.param("slug");
			if (!slug) throw new AppError("Organization is required.", 400);
			return c.json(await organizationService.getPrimaryFestivalPath(slug));
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	// Public: festival detail
	router.get("/festivals/:festivalShortName", async (c) => {
		try {
			const slug = c.req.param("slug");
			if (!slug) throw new AppError("Organization is required.", 400);
			return c.json(
				await organizationService.getPublicFestival(
					slug,
					c.req.param("festivalShortName"),
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	// Public: division list
	router.get("/divisions", async (c) => {
		try {
			const slug = c.req.param("slug");
			if (!slug) throw new AppError("Organization is required.", 400);
			return c.json(await organizationService.listPublicDivisions(slug));
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	// Public: org landing page data
	router.get("/landing", async (c) => {
		try {
			const slug = c.req.param("slug");
			if (!slug) throw new AppError("Organization is required.", 400);
			return c.json(await organizationService.getPublicLanding(slug));
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	return router;
}
