import {
	deriveDisplayName,
	type OrganizationMembershipRecord,
	type OrganizationRecord,
	type OrganizationRole,
	type OrganizationUserRecord,
} from "@festival/common";
import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "../errors/app-error.js";
import type {
	MembershipWithOrganization,
	OrganizationRepository,
} from "../repo/organization-repository.js";
import type { AuthVerifier } from "./types.js";

export interface AuthContext {
	identity: {
		uid: string;
		email: string;
		displayName: string;
	};
}

export interface TenantContext extends AuthContext {
	user: OrganizationUserRecord;
	organization: OrganizationRecord;
	membership: OrganizationMembershipRecord;
	role: OrganizationRole;
}

export type ApiVariables = {
	identity: AuthContext["identity"];
	tenant: TenantContext;
};

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

export function toJsonError(c: Context, error: unknown) {
	if (error instanceof AppError) {
		c.status(error.status as 400 | 401 | 403 | 404 | 409 | 500);
		return c.json({ error: error.message });
	}

	c.status(500);
	return c.json({ error: (error as Error).message });
}

function parseBearerToken(c: Context): string | null {
	const header = c.req.header("Authorization");
	if (!header) {
		return null;
	}

	const [scheme, token, extra] = header.split(" ");
	if (scheme !== "Bearer" || !token || extra) {
		throw new AppError(
			"Authorization header must use Bearer token format.",
			401,
		);
	}

	return token;
}

export async function readIdentity(
	c: Context,
	authVerifier: AuthVerifier,
): Promise<AuthContext["identity"] | null> {
	const token = parseBearerToken(c);
	if (!token) {
		return null;
	}

	try {
		return await authVerifier.verify(token);
	} catch (error) {
		if (error instanceof AppError) {
			throw error;
		}

		throw new AppError((error as Error).message, 401);
	}
}

export function requireAuth(
	authVerifier: AuthVerifier,
): MiddlewareHandler<{ Variables: Partial<ApiVariables> }> {
	return async (c, next) => {
		try {
			const identity = await readIdentity(c, authVerifier);
			if (!identity) {
				throw new AppError("Authentication required.", 401);
			}

			c.set("identity", identity);
			await next();
		} catch (error) {
			return toJsonError(c, error);
		}
	};
}

export async function resolveTenantContext(
	c: ApiContext,
	repository: OrganizationRepository,
	organizationSlug: string,
): Promise<TenantContext> {
	const identity = getRequiredIdentity(c);

	const user = await repository.upsertUser({
		...identity,
		displayName: deriveDisplayName(identity),
		email: identity.email.toLowerCase(),
	});
	const membership = await repository.findMembershipByUserAndSlug(
		user.id,
		organizationSlug,
	);
	if (!membership) {
		throw new AppError("Organization access denied.", 403);
	}

	return toTenantContext(identity, user, membership);
}

export function requireTenant(
	repository: OrganizationRepository,
	paramName = "slug",
): MiddlewareHandler<{ Variables: Partial<ApiVariables> }> {
	return async (c, next) => {
		try {
			const organizationSlug = c.req.param(paramName);
			if (!organizationSlug) {
				throw new AppError("Organization route parameter is required.", 400);
			}

			const tenant = await resolveTenantContext(
				c,
				repository,
				organizationSlug,
			);
			c.set("tenant", tenant);
			await next();
		} catch (error) {
			return toJsonError(c, error);
		}
	};
}

export function getRequiredIdentity(c: ApiContext): AuthContext["identity"] {
	const identity = c.var.identity;
	if (!identity) {
		throw new AppError("Authentication required.", 401);
	}

	return identity;
}

export function getRequiredTenant(c: ApiContext): TenantContext {
	const tenant = c.var.tenant;
	if (!tenant) {
		throw new AppError("Organization context required.", 500);
	}

	return tenant;
}

export function assertTenantRole(
	tenant: TenantContext,
	allowedRoles: readonly OrganizationRole[],
): void {
	if (!allowedRoles.includes(tenant.role)) {
		throw new AppError("Insufficient organization role.", 403);
	}
}

export function requireTenantRole(
	allowedRoles: readonly OrganizationRole[],
): MiddlewareHandler<{ Variables: Partial<ApiVariables> }> {
	return async (c, next) => {
		try {
			assertTenantRole(getRequiredTenant(c), allowedRoles);
			await next();
		} catch (error) {
			return toJsonError(c, error);
		}
	};
}

function toTenantContext(
	identity: AuthContext["identity"],
	user: OrganizationUserRecord,
	record: MembershipWithOrganization,
): TenantContext {
	return {
		identity,
		user,
		organization: record.organization,
		membership: record.membership,
		role: record.membership.role,
	};
}
