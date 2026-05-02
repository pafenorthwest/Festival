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
	if (error instanceof AppError) {
		c.status(error.status as 400 | 401 | 403 | 404 | 409 | 500);
		return c.json({ error: error.message });
	}

	c.status(500);
	return c.json({ error: (error as Error).message });
}

function bearerToken(c: Context): string {
	const header = c.req.header("Authorization");
	if (!header) {
		throw new AppError("Authentication required.", 401);
	}

	const [scheme, token] = header.split(" ");
	if (scheme !== "Bearer" || !token) {
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
			} catch (error) {
				if (error instanceof AppError) {
					throw error;
				}

				throw new AppError(
					`Failed to verify Firebase ID token: ${(error as Error).message}`,
					401,
				);
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

	const provider = (payload as { provider?: unknown }).provider;
	if (!isAuthLoginProvider(provider)) {
		throw new AppError("provider must be one of: google, password.", 400);
	}

	return { provider };
}

function requestIp(c: Context): string | undefined {
	const forwardedFor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
	if (forwardedFor) {
		return forwardedFor;
	}

	return c.req.header("x-real-ip")?.trim() || undefined;
}

export function buildAuthRouter(
	authVerifier: AuthVerifier,
	appUserRepository: AppUserRepository,
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
				ipAddress: requestIp(c),
				userAgent: c.req.header("user-agent")?.trim() || undefined,
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
