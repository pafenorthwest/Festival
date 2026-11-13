import {
	InvalidateCheckoutIntentBodySchema,
	RecoverCheckoutIntentBodySchema,
} from "@festival/common";
import { type Context, Hono, type MiddlewareHandler } from "hono";
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
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";
import { jsonValidator } from "./shared/schema-validator.js";

export const ADMIN_CHECKOUT_RECOVERY_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/admin/customers/:customerId/checkout-intents",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/checkout-intents/:intentId/invalidate",
		authenticationClass: "admin",
		csrfRequired: true,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/checkout-intents/:intentId/recover",
		authenticationClass: "admin",
		csrfRequired: true,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

type AdminContext = Context<{ Variables: Partial<ApiVariables> }>;

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

async function listCheckoutIntentsHandler(
	c: AdminContext,
	checkoutRecoveryService: CheckoutRecoveryService,
) {
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
}

async function invalidateIntentHandler(
	c: AdminContext,
	checkoutRecoveryService: CheckoutRecoveryService,
	body: { reason?: string },
) {
	try {
		const tenant = getRequiredTenant(c);
		const intentId = c.req.param("intentId");
		if (!intentId?.trim()) {
			throw new AppError("Checkout intent ID is required.", 400);
		}
		const reason = body.reason?.trim();
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
}

async function recoverIntentHandler(
	c: AdminContext,
	checkoutRecoveryService: CheckoutRecoveryService,
	body: { customerId?: string; expiresInHours?: number },
) {
	try {
		const tenant = getRequiredTenant(c);
		const intentId = c.req.param("intentId");
		if (!intentId?.trim()) {
			throw new AppError("Checkout intent ID is required.", 400);
		}
		const customerId = body.customerId?.trim();
		const expiresInHours = body.expiresInHours;
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
}

export function buildAdminCheckoutRecoveryRoutes(
	options: AdminCheckoutRecoveryRoutesOptions,
) {
	const { authVerifier, checkoutRecoveryService } = options;
	const repository =
		options.repository ?? options.organizationService?.repository;
	if (!repository) {
		throw new Error(
			"OrganizationRepository is required to build admin checkout recovery routes.",
		);
	}
	const admin = [
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
	] as const;
	const adminCsrf = [...admin, requireAdminCsrf()] as const;

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/organizations/:slug/admin/customers/:customerId/checkout-intents",
			...admin,
			(c) => listCheckoutIntentsHandler(c, checkoutRecoveryService),
		)
		.post(
			"/organizations/:slug/admin/checkout-intents/:intentId/invalidate",
			...adminCsrf,
			jsonValidator(InvalidateCheckoutIntentBodySchema, {
				allowEmptyJsonObject: true,
			}),
			(c) =>
				invalidateIntentHandler(
					c,
					checkoutRecoveryService,
					c.req.valid("json"),
				),
		)
		.post(
			"/organizations/:slug/admin/checkout-intents/:intentId/recover",
			...adminCsrf,
			jsonValidator(RecoverCheckoutIntentBodySchema, {
				allowEmptyJsonObject: true,
			}),
			(c) =>
				recoverIntentHandler(c, checkoutRecoveryService, c.req.valid("json")),
		);
}

export type AdminCheckoutRecoveryRoutesType = ReturnType<
	typeof buildAdminCheckoutRecoveryRoutes
>;
