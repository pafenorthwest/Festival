import type {
	AcceptInviteInput,
	CreateInviteInput,
	CreateOrganizationInput,
} from "@festival/common";
import { Hono } from "hono";
import type { CustomClaimsWriter } from "../../auth/custom-claims.js";
import {
	type ApiVariables,
	assertTenantRole,
	getRequiredIdentity,
	requireAuth,
	resolveTenantContext,
	toJsonError,
} from "../../auth/tenant-context.js";
import type { AuthVerifier } from "../../auth/types.js";
import { AppError } from "../../errors/app-error.js";
import type { OrganizationService } from "../../services/organization-service.js";

export interface IdentityRoutesOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
	customClaimsWriter?: CustomClaimsWriter;
}

export function buildIdentityRoutes(
	options: IdentityRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { organizationService, authVerifier, customClaimsWriter } = options;
	const repository = organizationService.repository;

	router.get("/bootstrap", async (c) => {
		try {
			if (c.req.header("Authorization") !== undefined) {
				throw new AppError(
					"Authorization is not accepted on the bootstrap route.",
					400,
				);
			}

			return c.json(await organizationService.getSession());
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/firebase-session", requireAuth(authVerifier), async (c) => {
		try {
			return c.json(
				await organizationService.getSession(getRequiredIdentity(c)),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/organizations", requireAuth(authVerifier), async (c) => {
		try {
			const identity = getRequiredIdentity(c);
			const payload = (await c.req.json()) as CreateOrganizationInput;
			const response = await organizationService.createOrganization(
				identity,
				payload,
			);
			// Best-effort; never blocks the response. See auth/custom-claims.ts.
			void customClaimsWriter?.setOrgRole(
				identity.uid,
				response.organization.id,
				response.membership.role,
			);
			c.status(201);
			return c.json(response);
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
				const identity = getRequiredIdentity(c);
				const payload = (await c.req.json()) as AcceptInviteInput;
				const response = await organizationService.acceptInvite(
					identity,
					c.req.param("token"),
					payload,
				);
				// Best-effort; never blocks the response. See auth/custom-claims.ts.
				void customClaimsWriter?.setOrgRole(
					identity.uid,
					response.organization.id,
					response.membership.role,
				);
				c.status(201);
				return c.json(response);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
