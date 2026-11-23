import {
	type AcceptInviteInput,
	AcceptInviteInputSchema,
	type CreateInviteInput,
	CreateInviteInputSchema,
	type CreateOrganizationInput,
	CreateOrganizationInputSchema,
} from "@festival/common";
import type { Context } from "hono";
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
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import { jsonValidator } from "../shared/schema-validator.js";

const identityRoute = (
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

export const IDENTITY_ROUTE_SECURITY = [
	identityRoute("GET", "/bootstrap", "public"),
	identityRoute("GET", "/firebase-session", "firebase"),
	identityRoute("GET", "/organizations", "public"),
	identityRoute("POST", "/organizations", "firebase"),
	identityRoute("GET", "/memberships", "firebase"),
	identityRoute("POST", "/invites", "admin"),
	identityRoute("GET", "/invites/:token", "public"),
	identityRoute("POST", "/invites/:token/accept", "firebase"),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface IdentityRoutesOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
	customClaimsWriter?: CustomClaimsWriter;
}

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

function handleBootstrap(
	c: ApiContext,
	organizationService: OrganizationService,
) {
	return (async () => {
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
	})();
}

async function handleCreateOrganization(
	c: ApiContext,
	options: IdentityRoutesOptions,
	payload: CreateOrganizationInput,
) {
	try {
		const identity = getRequiredIdentity(c);
		const response = await options.organizationService.createOrganization(
			identity,
			payload,
		);
		// Best-effort; never blocks the response. See auth/custom-claims.ts.
		void options.customClaimsWriter?.setOrgRole(
			identity.uid,
			response.organization.id,
			response.membership.role,
		);
		return c.json(response, 201);
	} catch (error) {
		return toJsonError(c, error);
	}
}

const resolvedInviteTenants = new WeakMap<
	Request,
	Awaited<ReturnType<typeof resolveTenantContext>>
>();

async function ensureInviteAdminTenant(
	c: ApiContext,
	organizationService: OrganizationService,
	organizationSlug: string,
) {
	const tenant = await resolveTenantContext(
		c,
		organizationService.repository,
		organizationSlug,
	);
	assertTenantRole(tenant, ["Admin"]);
	resolvedInviteTenants.set(c.req.raw, tenant);
	return tenant;
}

async function handleCreateInvite(
	c: ApiContext,
	organizationService: OrganizationService,
	payload: CreateInviteInput,
) {
	try {
		const tenant =
			resolvedInviteTenants.get(c.req.raw) ??
			(await ensureInviteAdminTenant(
				c,
				organizationService,
				payload.organizationSlug,
			));
		return c.json(
			await organizationService.createInviteForTenant(tenant, payload),
			201,
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleAcceptInvite(
	c: ApiContext,
	options: IdentityRoutesOptions,
	payload: AcceptInviteInput,
) {
	try {
		const identity = getRequiredIdentity(c);
		const response = await options.organizationService.acceptInvite(
			identity,
			c.req.param("token") ?? "",
			payload,
		);
		// Best-effort; never blocks the response. See auth/custom-claims.ts.
		void options.customClaimsWriter?.setOrgRole(
			identity.uid,
			response.organization.id,
			response.membership.role,
		);
		return c.json(response, 201);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function withIdentityJson<T>(c: ApiContext, fn: () => Promise<T>) {
	try {
		return c.json(await fn());
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildIdentityRoutes(options: IdentityRoutesOptions) {
	const { organizationService, authVerifier } = options;
	const auth = requireAuth(authVerifier);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/bootstrap", (c) => handleBootstrap(c, organizationService))
		.get("/firebase-session", auth, (c) =>
			withIdentityJson(c, () =>
				organizationService.getSession(getRequiredIdentity(c)),
			),
		)
		.get("/organizations", (c) =>
			withIdentityJson(c, () => organizationService.listPublicOrganizations()),
		)
		.post(
			"/organizations",
			auth,
			jsonValidator(CreateOrganizationInputSchema),
			(c) => handleCreateOrganization(c, options, c.req.valid("json")),
		)
		.get("/memberships", auth, (c) =>
			withIdentityJson(c, () =>
				organizationService.listMemberships(getRequiredIdentity(c)),
			),
		)
		.post(
			"/invites",
			auth,
			jsonValidator(CreateInviteInputSchema, {
				preCheck: async (raw, c) => {
					if (
						typeof raw === "object" &&
						raw !== null &&
						"organizationSlug" in raw &&
						typeof raw.organizationSlug === "string" &&
						raw.organizationSlug.trim().length > 0
					) {
						await ensureInviteAdminTenant(
							c as ApiContext,
							organizationService,
							raw.organizationSlug,
						);
					}
				},
			}),
			(c) => handleCreateInvite(c, organizationService, c.req.valid("json")),
		)
		.get("/invites/:token", (c) =>
			withIdentityJson(c, () =>
				organizationService.getInvite(c.req.param("token")),
			),
		)
		.post(
			"/invites/:token/accept",
			auth,
			jsonValidator(AcceptInviteInputSchema),
			(c) => handleAcceptInvite(c, options, c.req.valid("json")),
		);
}
