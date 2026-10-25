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
import type { ParticipantProfileService } from "../../services/participant-profile-service.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "../shared/csrf-guard.js";

export interface ParticipantProfileRoutesOptions {
	profileService: ParticipantProfileService;
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
}

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

export function buildParticipantProfileRoutes(
	options: ParticipantProfileRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { profileService, authVerifier, repository } = options;

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
			assertNoBearerPrincipal(c.req.header("Authorization"));
			c.header("Cache-Control", "no-store");
			const orgSlug = requireParam(c, "orgSlug");
			const sessionId = getCookie(c, CUSTOMER_SESSION_COOKIE);
			const csrfToken = c.req.header("X-CSRF-Token");
			const requestOrigin = resolveRequestOrigin(c);
			const payload = await readJsonBody(c);
			const result = await profileService.upsertTeacherProfile(
				{ orgSlug, sessionId, csrfToken, requestOrigin },
				payload,
			);
			return c.json(result);
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
			assertNoBearerPrincipal(c.req.header("Authorization"));
			c.header("Cache-Control", "no-store");
			const orgSlug = requireParam(c, "orgSlug");
			const sessionId = getCookie(c, CUSTOMER_SESSION_COOKIE);
			const csrfToken = c.req.header("X-CSRF-Token");
			const requestOrigin = resolveRequestOrigin(c);
			const payload = await readJsonBody(c);
			const result = await profileService.upsertAccompanistProfile(
				{ orgSlug, sessionId, csrfToken, requestOrigin },
				payload,
			);
			return c.json(result);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

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
					await profileService.listTeacherProfiles(tenant.organization.id),
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
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

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
					await profileService.listAccompanistProfiles(tenant.organization.id),
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
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// Public: Directory profiles
	router.get("/org-info/:orgSlug/directory/profiles", async (c) => {
		try {
			const orgSlug = requireParam(c, "orgSlug");
			return c.json(await profileService.getPublicDirectoryProfiles(orgSlug));
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	return router;
}
