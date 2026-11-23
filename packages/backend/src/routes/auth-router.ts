import {
	type AppUserPayload,
	type AppUserResponse,
	type AuthenticatedUser,
	LoginEventInputSchema,
	type LoginEventResponse,
} from "@festival/common";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AuthVerifier } from "../auth/types.js";
import { AppError } from "../errors/app-error.js";
import { jsonError as safeJsonError } from "../errors/json-error.js";
import type { AppUserRepository } from "../repo/app-user-repository.js";
import { appUserInputFromIdentity } from "../repo/app-user-repository.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";
import { jsonValidator } from "./shared/schema-validator.js";

export const AUTH_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "POST",
		path: "/sync",
		authenticationClass: "firebase",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/login-event",
		authenticationClass: "firebase",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/me",
		authenticationClass: "firebase",
		csrfRequired: false,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

type AuthVariables = {
	firebaseIdentity: AuthenticatedUser;
	appUser: AppUserPayload;
};

function appUserPayload(user: {
	id: string;
	firebaseUid: string;
	email: string;
	fullName?: string;
}): AppUserPayload {
	return {
		id: user.id,
		firebaseUid: user.firebaseUid,
		email: user.email,
		fullName: user.fullName,
	};
}

function jsonError(c: Context, error: unknown) {
	return safeJsonError(c, error);
}

function bearerToken(c: Context): string {
	const header = c.req.header("Authorization");
	if (!header) {
		throw new AppError("Authentication required.", 401);
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

function requireFirebaseAuth(
	authVerifier: AuthVerifier,
): MiddlewareHandler<{ Variables: AuthVariables }> {
	return async (c, next) => {
		try {
			try {
				c.set("firebaseIdentity", await authVerifier.verify(bearerToken(c)));
			} catch {
				throw new AppError("Firebase authentication failed.", 401);
			}
			await next();
		} catch (error) {
			return jsonError(c, error);
		}
	};
}

function requireSyncedAppUser(
	appUserRepository: AppUserRepository,
): MiddlewareHandler<{ Variables: AuthVariables }> {
	return async (c, next) => {
		try {
			const appUser = await appUserRepository.findAppUserByFirebaseUid(
				c.var.firebaseIdentity.uid,
			);
			if (!appUser) {
				throw new AppError(
					"App user has not been synced. Call /api/v1/auth/sync first.",
					404,
				);
			}

			c.set("appUser", appUserPayload(appUser));
			await next();
		} catch (error) {
			return jsonError(c, error);
		}
	};
}

function requestIp(c: Context, trustProxyHeaders: boolean): string | undefined {
	if (!trustProxyHeaders) {
		return undefined;
	}

	const forwardedFor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
	if (forwardedFor) {
		return forwardedFor;
	}

	return c.req.header("x-real-ip")?.trim() || undefined;
}

export function buildAuthRouter(
	authVerifier: AuthVerifier,
	appUserRepository: AppUserRepository,
	trustProxyHeaders = false,
) {
	const firebaseAuth = requireFirebaseAuth(authVerifier);
	const syncedAppUser = requireSyncedAppUser(appUserRepository);

	return new Hono<{ Variables: AuthVariables }>()
		.post("/sync", firebaseAuth, async (c) => {
			try {
				const user = await appUserRepository.upsertAppUser(
					appUserInputFromIdentity(c.var.firebaseIdentity),
				);
				return c.json({ user: appUserPayload(user) } satisfies AppUserResponse);
			} catch (error) {
				return jsonError(c, error);
			}
		})
		.post(
			"/login-event",
			firebaseAuth,
			syncedAppUser,
			jsonValidator(LoginEventInputSchema, {
				invalidJsonMessage: "Request body must be valid JSON.",
				fallbackErrorMessage: "Request body must be a JSON object.",
			}),
			async (c) => {
				try {
					const payload = c.req.valid("json");
					await appUserRepository.insertLoginEvent({
						userId: c.var.appUser.id,
						firebaseUid: c.var.firebaseIdentity.uid,
						provider: payload.provider,
						ipAddress: requestIp(c, trustProxyHeaders),
						userAgent:
							c.req.header("user-agent")?.trim().slice(0, 256) || undefined,
					});

					return c.json({ status: "ok" } satisfies LoginEventResponse);
				} catch (error) {
					return jsonError(c, error);
				}
			},
		)
		.get("/me", firebaseAuth, syncedAppUser, (c) => {
			return c.json({ user: c.var.appUser } satisfies AppUserResponse);
		});
}

export type AuthRoutesType = ReturnType<typeof buildAuthRouter>;
