import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../../auth/tenant-context.js";
import type { AuthVerifier } from "../../auth/types.js";
import { CUSTOMER_SESSION_COOKIE } from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import type { OrganizationRepository } from "../../repo/organization-repository.js";
import type {
	CustomerProfileSessionContext,
	ParticipantProfileService,
} from "../../services/participant-profile-service.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "../shared/csrf-guard.js";

export interface ParticipantProfileRoutesOptions {
	profileService: ParticipantProfileService;
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
}

type ParticipantProfileRouter = Hono<{ Variables: Partial<ApiVariables> }>;

function requireParam(c: Context, name: string): string {
	const val = c.req.param(name);
	if (!val) {
		throw new AppError(`${name} is required.`, 400);
	}
	return val;
}

async function readJsonBody(c: Context): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		throw new AppError("Invalid JSON body.", 400);
	}
}

function readCustomerWriteContext(c: Context): CustomerProfileSessionContext {
	assertNoBearerPrincipal(c.req.header("Authorization"));
	c.header("Cache-Control", "no-store");
	return {
		orgSlug: requireParam(c, "orgSlug"),
		sessionId: getCookie(c, CUSTOMER_SESSION_COOKIE),
		csrfToken: c.req.header("X-CSRF-Token"),
		requestOrigin: resolveRequestOrigin(c),
	};
}

function registerCustomerProfileRoutes(
	router: ParticipantProfileRouter,
	profileService: ParticipantProfileService,
): void {
	// Customer: Get own teacher profile
	router.get("/customer/orgs/:orgSlug/profiles/teacher", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			c.header("Cache-Control", "no-store");
			const orgSlug = requireParam(c, "orgSlug");
			const sessionId = getCookie(c, CUSTOMER_SESSION_COOKIE);
			return c.json(await profileService.getTeacherProfile(orgSlug, sessionId));
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	// Customer: Upsert own teacher profile
	router.put("/customer/orgs/:orgSlug/profiles/teacher", async (c) => {
		try {
			const context = readCustomerWriteContext(c);
			const payload = await readJsonBody(c);
			return c.json(
				await profileService.upsertTeacherProfile(context, payload),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	// Customer: Get own accompanist profile
	router.get("/customer/orgs/:orgSlug/profiles/accompanist", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			c.header("Cache-Control", "no-store");
			const orgSlug = requireParam(c, "orgSlug");
			const sessionId = getCookie(c, CUSTOMER_SESSION_COOKIE);
			return c.json(
				await profileService.getAccompanistProfile(orgSlug, sessionId),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	// Customer: Upsert own accompanist profile
	router.put("/customer/orgs/:orgSlug/profiles/accompanist", async (c) => {
		try {
			const context = readCustomerWriteContext(c);
			const payload = await readJsonBody(c);
			return c.json(
				await profileService.upsertAccompanistProfile(context, payload),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});
}

function registerAdminTeacherRoutes(
	router: ParticipantProfileRouter,
	options: ParticipantProfileRoutesOptions,
): void {
	const { profileService, authVerifier, repository } = options;

	// Admin: List teacher profiles
	router.get(
		"/admin/orgs/:orgSlug/profiles/teachers",
		requireAuth(authVerifier),
		requireTenant(repository, "orgSlug"),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				c.header("Cache-Control", "no-store");
				const tenant = getRequiredTenant(c);
				return c.json(
					await profileService.listTeacherProfiles(
						tenant.organization.id,
						tenant.identity.uid,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// Admin: Update teacher approval status
	router.patch(
		"/admin/orgs/:orgSlug/profiles/teachers/:profileId/approval",
		requireAuth(authVerifier),
		requireTenant(repository, "orgSlug"),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				c.header("Cache-Control", "no-store");
				const tenant = getRequiredTenant(c);
				const profileId = requireParam(c, "profileId");
				const payload = await readJsonBody(c);
				return c.json(
					await profileService.updateTeacherProfileApproval(
						tenant.organization.id,
						profileId,
						payload,
						tenant.identity.uid,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);
}

function registerAdminAccompanistRoutes(
	router: ParticipantProfileRouter,
	options: ParticipantProfileRoutesOptions,
): void {
	const { profileService, authVerifier, repository } = options;

	// Admin: List accompanist profiles
	router.get(
		"/admin/orgs/:orgSlug/profiles/accompanists",
		requireAuth(authVerifier),
		requireTenant(repository, "orgSlug"),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				c.header("Cache-Control", "no-store");
				const tenant = getRequiredTenant(c);
				return c.json(
					await profileService.listAccompanistProfiles(
						tenant.organization.id,
						tenant.identity.uid,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// Admin: Update accompanist approval status
	router.patch(
		"/admin/orgs/:orgSlug/profiles/accompanists/:profileId/approval",
		requireAuth(authVerifier),
		requireTenant(repository, "orgSlug"),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				c.header("Cache-Control", "no-store");
				const tenant = getRequiredTenant(c);
				const profileId = requireParam(c, "profileId");
				const payload = await readJsonBody(c);
				return c.json(
					await profileService.updateAccompanistProfileApproval(
						tenant.organization.id,
						profileId,
						payload,
						tenant.identity.uid,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);
}

export function buildParticipantProfileRoutes(
	options: ParticipantProfileRoutesOptions,
): ParticipantProfileRouter {
	const router: ParticipantProfileRouter = new Hono();
	registerCustomerProfileRoutes(router, options.profileService);
	registerAdminTeacherRoutes(router, options);
	registerAdminAccompanistRoutes(router, options);

	// Public: Directory profiles
	router.get("/org-info/:orgSlug/directory/profiles", async (c) => {
		try {
			c.header("Cache-Control", "no-store");
			const orgSlug = requireParam(c, "orgSlug");
			return c.json(
				await options.profileService.getPublicDirectoryProfiles(orgSlug),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	return router;
}
