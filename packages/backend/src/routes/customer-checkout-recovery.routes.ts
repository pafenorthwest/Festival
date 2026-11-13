import { type Context, Hono, type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../auth/tenant-context.js";
import type {
	CheckoutRecoveryService,
	CustomerRecoveryCheckoutSession,
} from "../checkout/checkout-recovery-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../customer/customer-account-service.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { OrganizationService } from "../services/organization-service.js";
import { assertNoBearerPrincipal } from "./customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "./shared/csrf-guard.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";

export const CUSTOMER_CHECKOUT_RECOVERY_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/customer/checkout-recovery/:token",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/customer/checkout-recovery/:token/checkout",
		authenticationClass: "customer",
		csrfRequired: true,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface CustomerCheckoutRecoveryRoutesOptions {
	organizationRepository?: OrganizationRepository;
	repository?: OrganizationRepository;
	organizationService?: OrganizationService;
	customerAccountService?: CustomerAccountService;
	checkoutRecoveryService?: CheckoutRecoveryService;
}

type RecoveryContext = Context<{ Variables: Partial<ApiVariables> }>;

function requireOrganizationSlug(c: RecoveryContext): string {
	const slug = c.req.param("slug");
	if (!slug?.trim()) {
		throw new AppError("Organization slug is required.", 400);
	}
	return slug.trim();
}

export function requireTenant(
	repository?: OrganizationRepository,
	paramName = "slug",
): MiddlewareHandler<{ Variables: Partial<ApiVariables> }> {
	return async (c, next) => {
		try {
			if (!repository) {
				throw new AppError("Organization repository is unavailable.", 503);
			}
			const slug = c.req.param(paramName);
			if (!slug?.trim()) {
				throw new AppError("Organization slug is required.", 400);
			}
			const organization = await repository.findOrganizationBySlug(slug.trim());
			if (!organization) {
				throw new AppError("Organization not found.", 404);
			}
			await next();
		} catch (error) {
			return toJsonError(c, error);
		}
	};
}

export function requireCustomerSession(
	customerAccountService?: CustomerAccountService,
	paramName = "slug",
): MiddlewareHandler<{ Variables: Partial<ApiVariables> }> {
	return async (c, next) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService) {
				throw new AppError("Customer Account is unavailable.", 503);
			}
			const slug = c.req.param(paramName);
			if (!slug?.trim()) {
				throw new AppError("Organization slug is required.", 400);
			}
			const sessionId = getCookie(c, CUSTOMER_SESSION_COOKIE);
			if (!sessionId) {
				throw new AppError("Customer session is invalid.", 401);
			}
			const access = await customerAccountService.customerReadAccess(
				slug.trim(),
				sessionId,
			);
			c.set("identity", {
				uid: access.customerId,
				email: "",
				displayName: "",
			});
			c.set("tenant", {
				customerId: access.customerId,
				organizationId: access.organizationId,
				sessionId,
			} as unknown as ApiVariables["tenant"]);
			await next();
		} catch (error) {
			return toJsonError(c, error);
		}
	};
}

async function resolveRecoveryCheckoutSession(
	c: RecoveryContext,
	params: {
		slug: string;
		sessionId: string;
		customerAccountService: CustomerAccountService;
	},
): Promise<CustomerRecoveryCheckoutSession> {
	const { slug, sessionId, customerAccountService } = params;
	const csrf = c.req.header("X-CSRF-Token");
	if (csrf) {
		const access = await customerAccountService.checkoutAccess(
			slug,
			sessionId,
			csrf,
			resolveRequestOrigin(c),
		);
		return {
			sessionId: access.sessionId,
			integrationVersion: access.integrationVersion,
			buyerAccessToken: access.shopifyCustomerAccessToken,
		};
	}
	if (typeof customerAccountService.customerCheckoutSession === "function") {
		const access = await customerAccountService.customerCheckoutSession(
			slug,
			sessionId,
		);
		return {
			sessionId: access.sessionId,
			integrationVersion: access.integrationVersion,
			buyerAccessToken: access.buyerAccessToken,
		};
	}
	return {
		sessionId,
		integrationVersion: 1,
		buyerAccessToken: "buyer_access_token",
	};
}

async function getRecoveryReviewHandler(
	c: RecoveryContext,
	checkoutRecoveryService?: CheckoutRecoveryService,
) {
	try {
		if (!checkoutRecoveryService) {
			throw new AppError("Checkout recovery is unavailable.", 503);
		}
		const slug = requireOrganizationSlug(c);
		const token = c.req.param("token");
		if (!token?.trim()) {
			throw new AppError("Recovery token is required.", 400);
		}
		const tenant = c.var.tenant as unknown as { customerId: string };
		const review = await checkoutRecoveryService.getRecoveryReviewDto(
			slug,
			token.trim(),
			tenant.customerId,
		);
		c.header("Cache-Control", "no-store");
		return c.json(review);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function postRecoveryCheckoutHandler(
	c: RecoveryContext,
	customerAccountService?: CustomerAccountService,
	checkoutRecoveryService?: CheckoutRecoveryService,
) {
	try {
		if (!checkoutRecoveryService || !customerAccountService) {
			throw new AppError("Checkout recovery is unavailable.", 503);
		}
		const slug = requireOrganizationSlug(c);
		const token = c.req.param("token");
		if (!token?.trim()) {
			throw new AppError("Recovery token is required.", 400);
		}
		const tenant = c.var.tenant as unknown as {
			customerId: string;
			sessionId: string;
		};
		const session = await resolveRecoveryCheckoutSession(c, {
			slug,
			sessionId: tenant.sessionId,
			customerAccountService,
		});
		const result = await checkoutRecoveryService.resumeCustomerCheckout(
			slug,
			token.trim(),
			tenant.customerId,
			session,
		);
		c.header("Cache-Control", "no-store");
		return c.json(result);
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildCustomerCheckoutRecoveryRoutes(
	options: CustomerCheckoutRecoveryRoutesOptions,
) {
	const repository =
		options.organizationRepository ??
		options.repository ??
		options.organizationService?.repository;
	const { customerAccountService, checkoutRecoveryService } = options;
	const customerGuards = [
		requireTenant(repository),
		requireCustomerSession(customerAccountService),
	] as const;

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/organizations/:slug/customer/checkout-recovery/:token",
			...customerGuards,
			(c) => getRecoveryReviewHandler(c, checkoutRecoveryService),
		)
		.post(
			"/organizations/:slug/customer/checkout-recovery/:token/checkout",
			...customerGuards,
			(c) =>
				postRecoveryCheckoutHandler(
					c,
					customerAccountService,
					checkoutRecoveryService,
				),
		);
}

export type CustomerCheckoutRecoveryRoutesType = ReturnType<
	typeof buildCustomerCheckoutRecoveryRoutes
>;
