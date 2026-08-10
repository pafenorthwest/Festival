import type {
	AcceptInviteInput,
	CreateFestivalInput,
	CreateInviteInput,
	CreateOrganizationInput,
	SaveShopifyIntegrationInput,
} from "@festival/common";
import { Hono } from "hono";
import {
	type ApiVariables,
	assertTenantRole,
	getRequiredIdentity,
	getRequiredTenant,
	readIdentity,
	requireAuth,
	requireTenant,
	requireTenantRole,
	resolveTenantContext,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationService } from "../services/organization-service.js";
import type { ShopifyIntegrationService } from "../shopify/shopify-integration-service.js";

export function buildApiRouter(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
	shopifyIntegrationService?: ShopifyIntegrationService,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const repository = organizationService.repository;

	router.get("/session", async (c) => {
		try {
			const identity = await readIdentity(c, authVerifier);
			return c.json(
				await organizationService.getSession(identity ?? undefined),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/organizations", requireAuth(authVerifier), async (c) => {
		try {
			const payload = (await c.req.json()) as CreateOrganizationInput;
			c.status(201);
			return c.json(
				await organizationService.createOrganization(
					getRequiredIdentity(c),
					payload,
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/memberships", requireAuth(authVerifier), async (c) => {
		try {
			return c.json(
				await organizationService.listMemberships(getRequiredIdentity(c)),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/invites", requireAuth(authVerifier), async (c) => {
		try {
			const payload = (await c.req.json()) as CreateInviteInput;
			const tenant = await resolveTenantContext(
				c,
				repository,
				payload.organizationSlug,
			);
			assertTenantRole(tenant, ["Admin"]);
			c.status(201);
			return c.json(
				await organizationService.createInviteForTenant(tenant, payload),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/invites/:token", async (c) => {
		try {
			return c.json(await organizationService.getInvite(c.req.param("token")));
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post(
		"/invites/:token/accept",
		requireAuth(authVerifier),
		async (c) => {
			try {
				const payload = (await c.req.json()) as AcceptInviteInput;
				c.status(201);
				return c.json(
					await organizationService.acceptInvite(
						getRequiredIdentity(c),
						c.req.param("token"),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug",
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

	router.post(
		"/organizations/:slug/welcome/dismiss",
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

	router.get(
		"/organizations/:slug/admin/users",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listAdminUsersForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.delete(
		"/organizations/:slug/admin/memberships/:membershipId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.deleteMembershipForTenant(
						getRequiredTenant(c),
						c.req.param("membershipId"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.delete(
		"/organizations/:slug/admin/invites/:inviteId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.cancelInviteForTenant(
						getRequiredTenant(c),
						c.req.param("inviteId"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/festivals",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listFestivalsForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/festivals",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = (await c.req.json()) as CreateFestivalInput;
				c.status(201);
				return c.json(
					await organizationService.createFestivalForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/shopify",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyIntegrationService) {
					throw new AppError("AES_ENCRYPTION_KEY is required.", 500);
				}

				return c.json(
					await shopifyIntegrationService.getSettingsForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/shopify",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyIntegrationService) {
					throw new AppError("AES_ENCRYPTION_KEY is required.", 500);
				}

				const payload = (await c.req.json()) as SaveShopifyIntegrationInput;
				return c.json(
					await shopifyIntegrationService.saveAndTestForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
