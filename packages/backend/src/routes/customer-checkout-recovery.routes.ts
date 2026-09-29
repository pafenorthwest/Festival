import { Hono, type MiddlewareHandler } from "hono";
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

export interface CustomerCheckoutRecoveryRoutesOptions {
	organizationRepository?: OrganizationRepository;
	repository?: OrganizationRepository;
	organizationService?: OrganizationService;
	customerAccountService?: CustomerAccountService;
	checkoutRecoveryService?: CheckoutRecoveryService;
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

export function buildCustomerCheckoutRecoveryRoutes(
	options: CustomerCheckoutRecoveryRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const repository =
		options.organizationRepository ??
		options.repository ??
		options.organizationService?.repository;
	const { customerAccountService, checkoutRecoveryService } = options;

	router.get(
		"/organizations/:slug/customer/checkout-recovery/:token",
		requireTenant(repository),
		requireCustomerSession(customerAccountService),
		async (c) => {
			try {
				if (!checkoutRecoveryService) {
					throw new AppError("Checkout recovery is unavailable.", 503);
				}
				const slug = c.req.param("slug");
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
		},
	);

	router.post(
		"/organizations/:slug/customer/checkout-recovery/:token/checkout",
		requireTenant(repository),
		requireCustomerSession(customerAccountService),
		async (c) => {
			try {
				if (!checkoutRecoveryService || !customerAccountService) {
					throw new AppError("Checkout recovery is unavailable.", 503);
				}
				const slug = c.req.param("slug");
				const token = c.req.param("token");
				if (!token?.trim()) {
					throw new AppError("Recovery token is required.", 400);
				}
				const tenant = c.var.tenant as unknown as {
					customerId: string;
					sessionId: string;
				};

				const csrf = c.req.header("X-CSRF-Token");
				let session: CustomerRecoveryCheckoutSession;
				if (csrf) {
					const origin = resolveRequestOrigin(c);
					const access = await customerAccountService.checkoutAccess(
						slug,
						tenant.sessionId,
						csrf,
						origin,
					);
					session = {
						sessionId: access.sessionId,
						integrationVersion: access.integrationVersion,
						buyerAccessToken: access.shopifyCustomerAccessToken,
					};
				} else if (
					typeof customerAccountService.customerCheckoutSession === "function"
				) {
					const access = await customerAccountService.customerCheckoutSession(
						slug,
						tenant.sessionId,
					);
					session = {
						sessionId: access.sessionId,
						integrationVersion: access.integrationVersion,
						buyerAccessToken: access.buyerAccessToken,
					};
				} else {
					session = {
						sessionId: tenant.sessionId,
						integrationVersion: 1,
						buyerAccessToken: "buyer_access_token",
					};
				}

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
		},
	);

	return router;
}
