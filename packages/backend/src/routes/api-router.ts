import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import type { ClassCheckoutService } from "../checkout/class-checkout-service.js";
import type { MembershipCheckoutService } from "../checkout/membership-checkout-service.js";
import type { MembershipStatusService } from "../commerce/membership-status-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../customer/customer-account-service.js";
import { AppError } from "../errors/app-error.js";
import type { AccompanistMembershipService } from "../services/accompanist-membership-service.js";
import type { OrganizationService } from "../services/organization-service.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import type { ShopifyIntegrationDiagnosticService } from "../shopify/shopify-integration-diagnostic-service.js";
import type { ShopifyIntegrationService } from "../shopify/shopify-integration-service.js";
import type { ShopifyMembershipProductService } from "../shopify/shopify-membership-product-service.js";
import type { VolunteerRepository } from "../volunteers/volunteer-repository.js";
import { buildAdminOrgRoutes } from "./admin-org/admin-org.routes.js";
import { buildAdminRegistrationRoutes } from "./admin-registration/admin-registration.routes.js";
import { buildAdminShopifyRoutes } from "./admin-shopify/admin-shopify.routes.js";
import { buildCatalogRoutes } from "./catalog/catalog.routes.js";
import { buildCustomerRoutes } from "./customer/customer.routes.js";
import { buildCustomerChildrenRoutes } from "./customer/customer-children.routes.js";
import { buildCustomerMembershipRoutes } from "./customer/customer-membership.routes.js";
import {
	assertNoBearerPrincipal,
	buildCustomerAuthRoutes,
} from "./customer-auth/customer-auth.routes.js";
import { buildIdentityRoutes } from "./identity/identity.routes.js";
import { buildOrgInfoRoutes } from "./org-info/org-info.routes.js";
import { buildStaffRoutes } from "./staff/staff.routes.js";
import { buildVolunteerRoutes } from "./volunteers.routes.js";

export interface ApiRouterOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
	shopifyIntegrationService?: ShopifyIntegrationService;
	shopifyMembershipProductService?: ShopifyMembershipProductService;
	customerAccountService?: CustomerAccountService;
	publicMembershipProductService?: PublicMembershipProductService;
	shopifyIntegrationDiagnosticService?: ShopifyIntegrationDiagnosticService;
	membershipCheckoutService?: MembershipCheckoutService;
	membershipStatusService?: MembershipStatusService;
	accompanistMembershipService?: AccompanistMembershipService;
	volunteerRepository?: VolunteerRepository;
	classCheckoutService?: ClassCheckoutService;
}

export function buildApiRouter(
	options: ApiRouterOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const {
		organizationService,
		authVerifier,
		shopifyIntegrationService,
		shopifyMembershipProductService,
		customerAccountService,
		publicMembershipProductService,
		shopifyIntegrationDiagnosticService,
		membershipCheckoutService,
		membershipStatusService,
		accompanistMembershipService,
		volunteerRepository,
		classCheckoutService,
	} = options;
	const repository = organizationService.repository;

	router.route("/", buildIdentityRoutes({ organizationService, authVerifier }));
	router.route("/", buildAdminOrgRoutes({ organizationService, authVerifier }));

	router.route(
		"/",
		buildAdminRegistrationRoutes({ organizationService, authVerifier }),
	);
	router.route(
		"/",
		buildAdminShopifyRoutes({
			authVerifier,
			organizationService,
			shopifyIntegrationService,
			shopifyIntegrationDiagnosticService,
			shopifyMembershipProductService,
			customerAccountService,
		}),
	);

	router.route(
		"/",
		buildCustomerAuthRoutes({
			customerAccountService,
			publicMembershipProductService,
		}),
	);

	router.route(
		"/organizations/:slug/customer",
		buildCustomerRoutes({ customerAccountService }),
	);
	router.route(
		"/organizations/:slug/customer",
		buildCustomerChildrenRoutes({ customerAccountService }),
	);
	router.route(
		"/organizations/:slug/customer",
		buildCustomerMembershipRoutes({
			customerAccountService,
			membershipCheckoutService,
			membershipStatusService,
			publicMembershipProductService,
			accompanistMembershipService,
			organizationService,
		}),
	);

	router.get(
		"/organizations/:slug/customer/festivals/:festivalShortName/registration/teachers",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				if (!customerAccountService)
					throw new AppError("Customer Account is unavailable.", 503);
				return c.json(
					await customerAccountService.listRegistrationTeachers(
						c.req.param("slug"),
						c.req.param("festivalShortName"),
						getCookie(c, CUSTOMER_SESSION_COOKIE),
						c.req.query("childId") ?? "",
						c.req.query("divisionId") ?? "",
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/customer/festivals/:festivalShortName/registration/eligible-classes",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				if (!customerAccountService)
					throw new AppError("Customer Account is unavailable.", 503);
				return c.json(
					await customerAccountService.listRegistrationEligibleClasses(
						c.req.param("slug"),
						c.req.param("festivalShortName"),
						getCookie(c, CUSTOMER_SESSION_COOKIE),
						c.req.query("childId") ?? "",
						c.req.query("divisionId") ?? "",
						c.req.query("teacherId") ?? "",
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/customer/festivals/:festivalShortName/registration/accompanists",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				if (!customerAccountService)
					throw new AppError("Customer Account is unavailable.", 503);
				return c.json(
					await customerAccountService.listRegistrationAccompanists(
						c.req.param("slug"),
						c.req.param("festivalShortName"),
						getCookie(c, CUSTOMER_SESSION_COOKIE),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	const handleClassCheckout = async (
		c: Context<{ Variables: Partial<ApiVariables> }>,
	) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService || !classCheckoutService) {
				throw new AppError("Class checkout is unavailable.", 503);
			}
			const idempotencyKey = c.req.header("Idempotency-Key");
			if (
				!idempotencyKey ||
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
					idempotencyKey,
				)
			) {
				throw new AppError("Checkout request is invalid.", 400);
			}
			const referer = c.req.header("Referer");
			let requestOrigin = c.req.header("Origin");
			if (!requestOrigin && referer) {
				try {
					requestOrigin = new URL(referer).origin;
				} catch {
					throw new AppError("CSRF validation failed.", 403);
				}
			}
			const slug = c.req.param("slug");
			if (!slug) throw new AppError("Organization slug is required.", 400);
			const access = await customerAccountService.checkoutAccess(
				slug,
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.header("X-CSRF-Token"),
				requestOrigin,
			);
			const festivalShortName = c.req.param("festivalShortName");
			const payload = await c.req.json();
			c.header("Cache-Control", "no-store");
			return c.json(
				await classCheckoutService.start({
					...payload,
					...access,
					festivalShortName: festivalShortName || payload.festivalShortName,
					buyerAccessToken: access.shopifyCustomerAccessToken,
					idempotencyKey,
				}),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	};

	router.post(
		"/organizations/:slug/customer/class-checkout",
		handleClassCheckout,
	);
	router.post(
		"/organizations/:slug/customer/festivals/:festivalShortName/registration/checkout",
		handleClassCheckout,
	);

	router.get("/organizations/:slug/customer/class-registrations", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService) {
				throw new AppError("Customer Account is unavailable.", 503);
			}
			return c.json(
				await customerAccountService.listClassRegistrations(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE) ?? "",
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get(
		"/organizations/:slug/customer/festivals/:festivalShortName/registration/class-registrations",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				if (!customerAccountService) {
					throw new AppError("Customer Account is unavailable.", 503);
				}
				return c.json(
					await customerAccountService.listClassRegistrations(
						c.req.param("slug"),
						getCookie(c, CUSTOMER_SESSION_COOKIE) ?? "",
						c.req.param("festivalShortName"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.route(
		"/",
		buildStaffRoutes({
			repository,
			authVerifier,
			accompanistMembershipService,
		}),
	);

	router.route(
		"/organizations/:slug",
		buildCatalogRoutes({ publicMembershipProductService }),
	);

	router.route(
		"/organizations/:slug",
		buildOrgInfoRoutes({ organizationService, authVerifier, repository }),
	);

	router.route(
		"/organizations/:slug/festivals/:festivalShortName/volunteers",
		buildVolunteerRoutes({
			authVerifier,
			repository,
			volunteerRepository,
		}),
	);

	return router;
}
