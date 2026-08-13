import type {
	AppUserPayload,
	AppUserResponse,
	AuthenticatedUser,
	LoginEventInput,
	LoginEventResponse,
} from "@festival/common";
import { isAuthLoginProvider } from "@festival/common";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AuthVerifier } from "../auth/types.js";
import { AppError } from "../errors/app-error.js";
import { jsonError as safeJsonError } from "../errors/json-error.js";
import type { AppUserRepository } from "../repo/app-user-repository.js";
import { appUserInputFromIdentity } from "../repo/app-user-repository.js";

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

async function readLoginEventInput(c: Context): Promise<LoginEventInput> {
	let payload: unknown;
	try {
		payload = await c.req.json();
	} catch {
		throw new AppError("Request body must be valid JSON.", 400);
	}

	if (!payload || typeof payload !== "object") {
		throw new AppError("Request body must be a JSON object.", 400);
	}

	const provider = (payload as { provider?: unknown }).provider;
	if (!isAuthLoginProvider(provider)) {
		throw new AppError("provider must be one of: google, password.", 400);
	}

	return { provider };
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
): Hono<{ Variables: AuthVariables }> {
	const router = new Hono<{ Variables: AuthVariables }>();
	const firebaseAuth = requireFirebaseAuth(authVerifier);
	const syncedAppUser = requireSyncedAppUser(appUserRepository);

	router.post("/sync", firebaseAuth, async (c) => {
		try {
			const user = await appUserRepository.upsertAppUser(
				appUserInputFromIdentity(c.var.firebaseIdentity),
			);
			return c.json({ user: appUserPayload(user) } satisfies AppUserResponse);
		} catch (error) {
			return jsonError(c, error);
		}
	});

	router.post("/login-event", firebaseAuth, syncedAppUser, async (c) => {
		try {
			const payload = await readLoginEventInput(c);
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
	});

	router.get("/me", firebaseAuth, syncedAppUser, (c) => {
		return c.json({ user: c.var.appUser } satisfies AppUserResponse);
	});

	return router;
}
