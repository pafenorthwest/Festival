import type {
	AcceptInviteInput,
	AuthenticatedUser,
	CreateInviteInput,
	CreateOrganizationInput,
} from "@festival/common";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AuthVerifier } from "../auth/types.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationService } from "../services/organization-service.js";

type AppVariables = {
	identity: AuthenticatedUser;
};

function jsonError(c: Context, error: unknown) {
	if (error instanceof AppError) {
		c.status(error.status as 400 | 401 | 403 | 404 | 409 | 500);
		return c.json({ error: error.message });
	}

	c.status(500);
	return c.json({ error: (error as Error).message });
}

async function readIdentity(
	c: Context<{ Variables: AppVariables }>,
	authVerifier: AuthVerifier,
): Promise<AuthenticatedUser | null> {
	const header = c.req.header("Authorization");
	if (!header) {
		return null;
	}

	const [scheme, token] = header.split(" ");
	if (scheme !== "Bearer" || !token) {
		throw new AppError(
			"Authorization header must use Bearer token format.",
			401,
		);
	}

	return authVerifier.verify(token);
}

function requireAuth(
	authVerifier: AuthVerifier,
): MiddlewareHandler<{ Variables: AppVariables }> {
	return async (c, next) => {
		const identity = await readIdentity(c, authVerifier);
		if (!identity) {
			c.status(401);
			return c.json({ error: "Authentication required." });
		}

		c.set("identity", identity);
		await next();
	};
}

export function buildApiRouter(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
): Hono<{ Variables: AppVariables }> {
	const router = new Hono<{ Variables: AppVariables }>();

	router.get("/session", async (c) => {
		try {
			const identity = await readIdentity(c, authVerifier);
			return c.json(
				await organizationService.getSession(identity ?? undefined),
			);
		} catch (error) {
			return jsonError(c, error);
		}
	});

	router.post("/organizations", requireAuth(authVerifier), async (c) => {
		try {
			const payload = (await c.req.json()) as CreateOrganizationInput;
			c.status(201);
			return c.json(
				await organizationService.createOrganization(c.var.identity, payload),
			);
		} catch (error) {
			return jsonError(c, error);
		}
	});

	router.get("/memberships", requireAuth(authVerifier), async (c) => {
		try {
			return c.json(await organizationService.listMemberships(c.var.identity));
		} catch (error) {
			return jsonError(c, error);
		}
	});

	router.post("/invites", requireAuth(authVerifier), async (c) => {
		try {
			const payload = (await c.req.json()) as CreateInviteInput;
			c.status(201);
			return c.json(
				await organizationService.createInvite(c.var.identity, payload),
			);
		} catch (error) {
			return jsonError(c, error);
		}
	});

	router.get("/invites/:token", async (c) => {
		try {
			return c.json(await organizationService.getInvite(c.req.param("token")));
		} catch (error) {
			return jsonError(c, error);
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
						c.var.identity,
						c.req.param("token"),
						payload,
					),
				);
			} catch (error) {
				return jsonError(c, error);
			}
		},
	);

	router.get("/organizations/:slug", requireAuth(authVerifier), async (c) => {
		try {
			return c.json(
				await organizationService.getOrganizationLanding(
					c.var.identity,
					c.req.param("slug"),
				),
			);
		} catch (error) {
			return jsonError(c, error);
		}
	});

	router.post(
		"/organizations/:slug/welcome/dismiss",
		requireAuth(authVerifier),
		async (c) => {
			try {
				return c.json(
					await organizationService.dismissWelcome(
						c.var.identity,
						c.req.param("slug"),
					),
				);
			} catch (error) {
				return jsonError(c, error);
			}
		},
	);

	return router;
}
