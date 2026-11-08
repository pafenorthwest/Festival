import { Hono } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import type { ClassCheckoutService } from "../checkout/class-checkout-service.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import { resolveRequestOrigin } from "./shared/csrf-guard.js";

export interface AdminClassCheckoutRecoveryOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	classCheckoutService?: ClassCheckoutService;
}

/** Class recovery is deliberately separate from membership recovery tokens. */
export function buildAdminClassCheckoutRecoveryRoutes(
	options: AdminClassCheckoutRecoveryOptions,
) {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const base = "/organizations/:slug/admin/class-checkout-recoveries";
	const auth = [
		requireAuth(options.authVerifier),
		requireTenant(options.repository),
		requireTenantRole(["Admin"]),
	] as const;
	function service() {
		if (!options.classCheckoutService)
			throw new AppError("Class checkout recovery is unavailable.", 503);
		return options.classCheckoutService;
	}
	router.get(base, ...auth, async (c) => {
		try {
			c.header("Cache-Control", "no-store");
			const tenant = getRequiredTenant(c);
			const recoveries = await service().listRecoveries({
				organizationId: tenant.organization.id,
				customerId: c.req.query("customerId")?.trim() || undefined,
			});
			return c.json({ recoveries });
		} catch (error) {
			return toJsonError(c, error);
		}
	});
	router.post(`${base}/reap`, ...auth, async (c) => {
		try {
			c.header("Cache-Control", "no-store");
			if (!c.req.header("X-CSRF-Token")?.trim() || !resolveRequestOrigin(c))
				throw new AppError("CSRF validation failed.", 403);
			const tenant = getRequiredTenant(c);
			const recoveredCount = await service().reapExpiredRecoveries({
				organizationId: tenant.organization.id,
			});
			return c.json({ recoveredCount });
		} catch (error) {
			return toJsonError(c, error);
		}
	});
	router.post(`${base}/:recoveryReference/resolve`, ...auth, async (c) => {
		try {
			c.header("Cache-Control", "no-store");
			if (!c.req.header("X-CSRF-Token")?.trim() || !resolveRequestOrigin(c))
				throw new AppError("CSRF validation failed.", 403);
			const tenant = getRequiredTenant(c);
			const raw: unknown = await c.req.json().catch(() => null);
			if (!raw || typeof raw !== "object" || Array.isArray(raw))
				throw new AppError("Recovery resolution is invalid.", 400);
			const body = raw as Record<string, unknown>;
			const action = body.action;
			if (
				action !== "adopt_cart" &&
				action !== "retry_pre_dispatch" &&
				action !== "abandon_unknown"
			)
				throw new AppError("Recovery action is invalid.", 400);
			if (
				typeof body.expectedGeneration !== "number" ||
				!Number.isSafeInteger(body.expectedGeneration) ||
				body.expectedGeneration < 0 ||
				typeof body.reason !== "string" ||
				!body.reason.trim() ||
				body.reason.length > 500 ||
				(body.shopifyCartId !== undefined &&
					typeof body.shopifyCartId !== "string") ||
				(body.evidenceEventId !== undefined &&
					typeof body.evidenceEventId !== "string")
			)
				throw new AppError("Recovery resolution is invalid.", 400);
			const result = await service().resolveRecovery({
				organizationId: tenant.organization.id,
				recoveryReference: c.req.param("recoveryReference"),
				expectedGeneration: body.expectedGeneration,
				actorId: tenant.identity.uid,
				reason: body.reason.trim(),
				action,
				shopifyCartId: body.shopifyCartId as string | undefined,
				evidenceEventId: body.evidenceEventId as string | undefined,
				acknowledgeUnknown: body.acknowledgeUnknown === true,
			});
			return c.json({ recovery: result });
		} catch (error) {
			return toJsonError(c, error);
		}
	});
	return router;
}
