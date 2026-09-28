import { Hono, type MiddlewareHandler } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import type { CheckoutRecoveryService } from "../checkout/checkout-recovery-service.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { OrganizationService } from "../services/organization-service.js";
import { resolveRequestOrigin } from "./shared/csrf-guard.js";

function requireAdminCsrf(): MiddlewareHandler<{
	Variables: Partial<ApiVariables>;
}> {
	return async (c, next) => {
		try {
			const csrf = c.req.header("X-CSRF-Token");
			if (!csrf?.trim()) {
				throw new AppError("CSRF validation failed.", 403);
			}
			resolveRequestOrigin(c);
			await next();
		} catch (error) {
			return toJsonError(c, error);
		}
	};
}

export interface AdminCheckoutRecoveryRoutesOptions {
	authVerifier: AuthVerifier;
	checkoutRecoveryService: CheckoutRecoveryService;
	repository?: OrganizationRepository;
	organizationService?: OrganizationService;
}

export function buildAdminCheckoutRecoveryRoutes(
	options: AdminCheckoutRecoveryRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { authVerifier, checkoutRecoveryService } = options;
	const repository =
		options.repository ?? options.organizationService?.repository;

	if (!repository) {
		throw new Error(
			"OrganizationRepository is required to build admin checkout recovery routes.",
		);
	}

	router.get(
		"/organizations/:slug/admin/customers/:customerId/checkout-intents",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const customerId = c.req.param("customerId");
				if (!customerId?.trim()) {
					throw new AppError("Customer ID is required.", 400);
				}

				const intents = await checkoutRecoveryService.listRecoverableIntents({
					organizationId: tenant.organization.id,
					customerId: customerId.trim(),
					actorUid: tenant.identity.uid,
				});

				return c.json({ intents });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/checkout-intents/:intentId/invalidate",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		requireAdminCsrf(),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const intentId = c.req.param("intentId");
				if (!intentId?.trim()) {
					throw new AppError("Checkout intent ID is required.", 400);
				}

				let reason: string | undefined;
				try {
					const body = await c.req.json();
					if (
						body &&
						typeof body === "object" &&
						typeof body.reason === "string"
					) {
						reason = body.reason.trim();
					}
				} catch {
					// Body is optional
				}

				await checkoutRecoveryService.invalidateIntent({
					organizationId: tenant.organization.id,
					intentId: intentId.trim(),
					actorUid: tenant.identity.uid,
					reason,
				});

				return c.json({ success: true, intentId: intentId.trim() });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/checkout-intents/:intentId/recover",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		requireAdminCsrf(),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const intentId = c.req.param("intentId");
				if (!intentId?.trim()) {
					throw new AppError("Checkout intent ID is required.", 400);
				}

				let customerId: string | undefined;
				let expiresInHours: number | undefined;
				try {
					const body = await c.req.json();
					if (body && typeof body === "object") {
						if (typeof body.customerId === "string") {
							customerId = body.customerId.trim();
						}
						if (typeof body.expiresInHours === "number") {
							expiresInHours = body.expiresInHours;
						}
					}
				} catch {
					// Body is optional
				}

				const result = await checkoutRecoveryService.createRecovery({
					organizationId: tenant.organization.id,
					organizationSlug: tenant.organization.slug,
					intentId: intentId.trim(),
					customerId,
					actorUid: tenant.identity.uid,
					expiresInHours,
				});

				return c.json({
					recoveryUrl: result.recoveryUrl,
					rawToken: result.rawToken,
					tokenHash: result.tokenHash,
					recoveryRequest: result.recoveryRequest,
				});
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
