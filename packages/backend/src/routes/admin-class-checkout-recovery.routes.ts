import {
	AdminResolveClassCheckoutRecoveryPayloadSchema,
	CustomerIdQuerySchema,
} from "@festival/common";
import { type Context, Hono } from "hono";
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
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
	queryValidator,
} from "./shared/schema-validator.js";

export const ADMIN_CLASS_CHECKOUT_RECOVERY_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/admin/class-checkout-recoveries",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/class-checkout-recoveries/reap",
		authenticationClass: "admin",
		csrfRequired: true,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/class-checkout-recoveries/:recoveryReference/resolve",
		authenticationClass: "admin",
		csrfRequired: true,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface AdminClassCheckoutRecoveryOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	classCheckoutService?: ClassCheckoutService;
	publicOrigin?: string;
}

type AdminContext = Context<{ Variables: Partial<ApiVariables> }>;

function assertOperatorCsrf(c: Context, publicOrigin: string | undefined) {
	if (
		!c.req.header("X-CSRF-Token")?.trim() ||
		!(Boolean(publicOrigin) && resolveRequestOrigin(c) === publicOrigin)
	)
		throw new AppError("CSRF validation failed.", 403);
}

interface ResolveRecoveryInput {
	expectedGeneration: number;
	reason: string;
	action: "adopt_cart" | "retry_pre_dispatch" | "abandon_unknown";
	shopifyCartId?: string;
	evidenceEventId?: string;
	acknowledgeUnknown?: boolean;
}

function requireRecoveryService(service: ClassCheckoutService | undefined) {
	if (!service)
		throw new AppError("Class checkout recovery is unavailable.", 503);
	return service;
}

async function listRecoveriesHandler(
	c: AdminContext,
	options: AdminClassCheckoutRecoveryOptions,
	customerIdQuery?: string,
) {
	try {
		c.header("Cache-Control", "no-store");
		const tenant = getRequiredTenant(c);
		const service = requireRecoveryService(options.classCheckoutService);
		const recoveries = await service.listRecoveries({
			organizationId: tenant.organization.id,
			customerId: customerIdQuery?.trim() || undefined,
		});
		return c.json({ recoveries });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function reapRecoveriesHandler(
	c: AdminContext,
	options: AdminClassCheckoutRecoveryOptions,
) {
	try {
		const tenant = getRequiredTenant(c);
		const service = requireRecoveryService(options.classCheckoutService);
		const recoveredCount = await service.reapExpiredRecoveries({
			organizationId: tenant.organization.id,
		});
		return c.json({ recoveredCount });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function resolveRecoveryHandler(
	c: AdminContext,
	options: AdminClassCheckoutRecoveryOptions,
	parsed: ResolveRecoveryInput,
) {
	try {
		const recoveryReference = c.req.param("recoveryReference") ?? "";
		const tenant = getRequiredTenant(c);
		const service = requireRecoveryService(options.classCheckoutService);
		const result = await service.resolveRecovery({
			organizationId: tenant.organization.id,
			recoveryReference,
			expectedGeneration: parsed.expectedGeneration,
			actorId: tenant.identity.uid,
			reason: parsed.reason.trim(),
			action: parsed.action,
			shopifyCartId: parsed.shopifyCartId,
			evidenceEventId: parsed.evidenceEventId,
			acknowledgeUnknown: parsed.acknowledgeUnknown === true,
		});
		return c.json({ recovery: result });
	} catch (error) {
		return toJsonError(c, error);
	}
}

/** Class recovery is deliberately separate from membership recovery tokens. */
export function buildAdminClassCheckoutRecoveryRoutes(
	options: AdminClassCheckoutRecoveryOptions,
) {
	const auth = [
		requireAuth(options.authVerifier),
		requireTenant(options.repository),
		requireTenantRole(["Admin"]),
	] as const;

	const operatorCsrf = [
		...auth,
		preValidationGuard((c) => {
			c.header("Cache-Control", "no-store");
			assertOperatorCsrf(c, options.publicOrigin);
		}),
	] as const;

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/organizations/:slug/admin/class-checkout-recoveries",
			...auth,
			queryValidator(CustomerIdQuerySchema),
			(c) => listRecoveriesHandler(c, options, c.req.valid("query").customerId),
		)
		.post(
			"/organizations/:slug/admin/class-checkout-recoveries/reap",
			...operatorCsrf,
			(c) => reapRecoveriesHandler(c, options),
		)
		.post(
			"/organizations/:slug/admin/class-checkout-recoveries/:recoveryReference/resolve",
			...operatorCsrf,
			jsonValidator(AdminResolveClassCheckoutRecoveryPayloadSchema),
			(c) => resolveRecoveryHandler(c, options, c.req.valid("json")),
		);
}

export type AdminClassCheckoutRecoveryRoutesType = ReturnType<
	typeof buildAdminClassCheckoutRecoveryRoutes
>;
