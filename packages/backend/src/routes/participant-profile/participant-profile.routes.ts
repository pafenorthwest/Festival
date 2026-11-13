import {
	UpdateProfileApprovalBodySchema,
	UpsertCustomerTeacherProfileInputSchema,
	UpsertParticipantProfileInputSchema,
} from "@festival/common";
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
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
} from "../shared/schema-validator.js";

const profileRoute = (
	method: CoLocatedRouteSecurity["method"],
	path: string,
	options: {
		authenticationClass: CoLocatedRouteSecurity["authenticationClass"];
		csrfRequired?: boolean;
	},
) =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: options.authenticationClass,
		csrfRequired: options.csrfRequired ?? false,
		browserAllowed: true,
	});

export const PARTICIPANT_PROFILE_ROUTE_SECURITY = [
	profileRoute("GET", "/customer/orgs/:orgSlug/profiles/teacher", {
		authenticationClass: "customer",
	}),
	profileRoute("PUT", "/customer/orgs/:orgSlug/profiles/teacher", {
		authenticationClass: "customer",
		csrfRequired: true,
	}),
	profileRoute("GET", "/customer/orgs/:orgSlug/profiles/accompanist", {
		authenticationClass: "customer",
	}),
	profileRoute("PUT", "/customer/orgs/:orgSlug/profiles/accompanist", {
		authenticationClass: "customer",
		csrfRequired: true,
	}),
	profileRoute("GET", "/admin/orgs/:orgSlug/profiles/teachers", {
		authenticationClass: "admin",
	}),
	profileRoute(
		"PATCH",
		"/admin/orgs/:orgSlug/profiles/teachers/:profileId/approval",
		{ authenticationClass: "admin" },
	),
	profileRoute("GET", "/admin/orgs/:orgSlug/profiles/accompanists", {
		authenticationClass: "admin",
	}),
	profileRoute(
		"PATCH",
		"/admin/orgs/:orgSlug/profiles/accompanists/:profileId/approval",
		{ authenticationClass: "admin" },
	),
	profileRoute("GET", "/org-info/:orgSlug/directory/profiles", {
		authenticationClass: "public",
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface ParticipantProfileRoutesOptions {
	profileService: ParticipantProfileService;
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
}

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

function requireParam(c: Context, name: string): string {
	const val = c.req.param(name);
	if (!val) {
		throw new AppError(`${name} is required.`, 400);
	}
	return val;
}

function readCustomerReadContext(c: Context) {
	assertNoBearerPrincipal(c.req.header("Authorization"));
	c.header("Cache-Control", "no-store");
	return {
		orgSlug: requireParam(c, "orgSlug"),
		sessionId: getCookie(c, CUSTOMER_SESSION_COOKIE),
	};
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

async function withNoStoreJson<T>(c: ApiContext, fn: () => Promise<T>) {
	try {
		c.header("Cache-Control", "no-store");
		return c.json(await fn());
	} catch (error) {
		return toJsonError(c, error);
	}
}

const customerWriteContextCache = new WeakMap<
	Request,
	CustomerProfileSessionContext
>();

const guardCustomerWrite = preValidationGuard((c) => {
	customerWriteContextCache.set(c.req.raw, readCustomerWriteContext(c));
});

function buildCustomerProfileRoutes(profileService: ParticipantProfileService) {
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/customer/orgs/:orgSlug/profiles/teacher", (c) =>
			withNoStoreJson(c, () => {
				const { orgSlug, sessionId } = readCustomerReadContext(c);
				return profileService.getTeacherProfile(orgSlug, sessionId);
			}),
		)
		.put(
			"/customer/orgs/:orgSlug/profiles/teacher",
			guardCustomerWrite,
			jsonValidator(UpsertCustomerTeacherProfileInputSchema),
			(c) =>
				withNoStoreJson(c, () => {
					const context =
						customerWriteContextCache.get(c.req.raw) ??
						readCustomerWriteContext(c);
					return profileService.upsertTeacherProfile(
						context,
						c.req.valid("json"),
					);
				}),
		)
		.get("/customer/orgs/:orgSlug/profiles/accompanist", (c) =>
			withNoStoreJson(c, () => {
				const { orgSlug, sessionId } = readCustomerReadContext(c);
				return profileService.getAccompanistProfile(orgSlug, sessionId);
			}),
		)
		.put(
			"/customer/orgs/:orgSlug/profiles/accompanist",
			guardCustomerWrite,
			jsonValidator(UpsertParticipantProfileInputSchema),
			(c) =>
				withNoStoreJson(c, () => {
					const context =
						customerWriteContextCache.get(c.req.raw) ??
						readCustomerWriteContext(c);
					return profileService.upsertAccompanistProfile(
						context,
						c.req.valid("json"),
					);
				}),
		);
}

function buildAdminTeacherProfileRoutes(
	options: ParticipantProfileRoutesOptions,
) {
	const { profileService, authVerifier, repository } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(repository, "orgSlug");
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/admin/orgs/:orgSlug/profiles/teachers", auth, tenant, admin, (c) =>
			withNoStoreJson(c, () => {
				const t = getRequiredTenant(c);
				return profileService.listTeacherProfiles(
					t.organization.id,
					t.identity.uid,
				);
			}),
		)
		.patch(
			"/admin/orgs/:orgSlug/profiles/teachers/:profileId/approval",
			auth,
			tenant,
			admin,
			jsonValidator(UpdateProfileApprovalBodySchema),
			(c) =>
				withNoStoreJson(c, () => {
					const t = getRequiredTenant(c);
					return profileService.updateTeacherProfileApproval(
						t.organization.id,
						requireParam(c, "profileId"),
						c.req.valid("json"),
						t.identity.uid,
					);
				}),
		);
}

function buildAdminAccompanistProfileRoutes(
	options: ParticipantProfileRoutesOptions,
) {
	const { profileService, authVerifier, repository } = options;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(repository, "orgSlug");
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/admin/orgs/:orgSlug/profiles/accompanists",
			auth,
			tenant,
			admin,
			(c) =>
				withNoStoreJson(c, () => {
					const t = getRequiredTenant(c);
					return profileService.listAccompanistProfiles(
						t.organization.id,
						t.identity.uid,
					);
				}),
		)
		.patch(
			"/admin/orgs/:orgSlug/profiles/accompanists/:profileId/approval",
			auth,
			tenant,
			admin,
			jsonValidator(UpdateProfileApprovalBodySchema),
			(c) =>
				withNoStoreJson(c, () => {
					const t = getRequiredTenant(c);
					return profileService.updateAccompanistProfileApproval(
						t.organization.id,
						requireParam(c, "profileId"),
						c.req.valid("json"),
						t.identity.uid,
					);
				}),
		);
}

export function buildParticipantProfileRoutes(
	options: ParticipantProfileRoutesOptions,
) {
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.route("/", buildCustomerProfileRoutes(options.profileService))
		.route("/", buildAdminTeacherProfileRoutes(options))
		.route("/", buildAdminAccompanistProfileRoutes(options))
		.get("/org-info/:orgSlug/directory/profiles", (c) =>
			withNoStoreJson(c, () =>
				options.profileService.getPublicDirectoryProfiles(
					requireParam(c, "orgSlug"),
				),
			),
		);
}
