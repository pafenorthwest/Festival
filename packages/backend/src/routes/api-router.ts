import type {
	AcceptInviteInput,
	CreateInviteInput,
	CreateOrganizationInput,
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
import type { OrganizationService } from "../services/organization-service.js";

export function buildApiRouter(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
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

	return router;
}
