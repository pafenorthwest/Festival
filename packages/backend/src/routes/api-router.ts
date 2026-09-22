import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
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
import { buildIdentityRoutes } from "./identity/identity.routes.js";
import { buildOrgInfoRoutes } from "./org-info/org-info.routes.js";
import { buildStaffRoutes } from "./staff/staff.routes.js";
import { buildVolunteerRoutes } from "./volunteers.routes.js";

function assertAllowedFields(
	payload: unknown,
	allowed: readonly string[],
	label: string,
): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
	const allowedFields = new Set(allowed);
	const extraFields = Object.keys(payload).filter(
		(field) => !allowedFields.has(field),
	);
	if (extraFields.length > 0) {
		throw new AppError(
			`${label} cannot include browser-controlled fields: ${extraFields.join(", ")}.`,
			400,
		);
	}
}

function assertNoBearerPrincipal(value: string | undefined): void {
	if (value !== undefined)
		throw new AppError(
			"Bearer authorization is not accepted on customer routes.",
			400,
		);
}

function assertAllowedCustomerAuthStartQuery(url: string): void {
	const allowed = new Set(["returnTo", "offering"]);
	const params = new URL(url).searchParams;
	const unsupported = [...params.keys()].filter((key) => !allowed.has(key));
	const duplicates = [...allowed].filter(
		(key) => params.getAll(key).length > 1,
	);
	if (unsupported.length || duplicates.length) {
		const fields = [...new Set([...unsupported, ...duplicates])];
		throw new AppError(
			`Customer authentication request contains unsupported fields: ${fields.join(", ")}.`,
			400,
		);
	}
}

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

	router.get("/organizations/:slug/customer-auth/start", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			assertAllowedCustomerAuthStartQuery(c.req.url);
			if (!customerAccountService)
				throw new AppError(
					"Customer Account integration is not configured.",
					503,
				);
			const offeringId = c.req.query("offering");
			if (offeringId) {
				if (!publicMembershipProductService)
					throw new AppError("Membership information is unavailable.", 503);
				await publicMembershipProductService.resolvePurchasable(
					c.req.param("slug"),
					offeringId,
				);
			}
			return c.redirect(
				await customerAccountService.start(
					c.req.param("slug"),
					c.req.query("returnTo"),
					offeringId,
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/customer-auth/callback", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService)
				throw new AppError(
					"Customer Account integration is not configured.",
					503,
				);
			if (c.req.query("error") && !c.req.query("code")) {
				return c.redirect(
					await customerAccountService.authenticationFailure(
						c.req.query("state"),
					),
				);
			}
			const result = await customerAccountService.callback(
				c.req.query("state"),
				c.req.query("code"),
				async (slug, offeringId) => {
					if (!publicMembershipProductService)
						throw new AppError("Membership information is unavailable.", 503);
					await publicMembershipProductService.resolvePurchasable(
						slug,
						offeringId,
					);
				},
			);
			setCookie(c, CUSTOMER_SESSION_COOKIE, result.sessionId, {
				httpOnly: true,
				secure: true,
				sameSite: "Lax",
				path: "/api/",
				maxAge: result.maxAgeSeconds,
			});
			return c.redirect(result.returnTo);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/organizations/:slug/customer/session", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService)
				throw new AppError(
					"Customer Account integration is not configured.",
					503,
				);
			return c.json(
				await customerAccountService.session(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE),
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get(
		"/organizations/:slug/customer/membership-purchase/:offeringId",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				if (!customerAccountService || !publicMembershipProductService)
					throw new AppError("Membership purchase is unavailable.", 503);
				const session = await customerAccountService.session(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE),
				);
				if (!session.session.authenticated) {
					throw new AppError("Customer session is invalid.", 401);
				}
				c.header("Cache-Control", "no-store");
				return c.json(
					await publicMembershipProductService.resolvePurchasable(
						c.req.param("slug"),
						c.req.param("offeringId"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post("/organizations/:slug/customer/checkout", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService || !membershipCheckoutService)
				throw new AppError("Membership checkout is unavailable.", 503);
			const idempotencyKey = c.req.header("Idempotency-Key");
			if (
				!idempotencyKey ||
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
					idempotencyKey,
				)
			)
				throw new AppError("Checkout request is invalid.", 400);
			const payload = await c.req.json();
			assertAllowedFields(
				payload,
				["offeringId", "divisionId", "staffAccessConsent"],
				"Checkout request",
			);
			if (
				!payload ||
				typeof payload !== "object" ||
				Array.isArray(payload) ||
				typeof (payload as { offeringId?: unknown }).offeringId !== "string" ||
				typeof (payload as { divisionId?: unknown }).divisionId !== "string" ||
				!(payload as { divisionId: string }).divisionId.trim() ||
				(payload as { staffAccessConsent?: unknown }).staffAccessConsent !==
					true
			)
				throw new AppError("Checkout request is invalid.", 400);
			const referer = c.req.header("Referer");
			let requestOrigin = c.req.header("Origin");
			if (!requestOrigin && referer) {
				try {
					requestOrigin = new URL(referer).origin;
				} catch {
					throw new AppError("CSRF validation failed.", 403);
				}
			}
			const access = await customerAccountService.checkoutAccess(
				c.req.param("slug"),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.header("X-CSRF-Token"),
				requestOrigin,
			);
			if ((payload as { staffAccessConsent: boolean }).staffAccessConsent) {
				await customerAccountService.recordCheckoutStaffAccessConsent(
					access.organizationId,
					access.customerId,
				);
			}
			c.header("Cache-Control", "no-store");
			return c.json(
				await membershipCheckoutService.start({
					...access,
					buyerAccessToken: access.shopifyCustomerAccessToken,
					idempotencyKey,
					offeringId: (payload as { offeringId: string }).offeringId,
					divisionId: (payload as { divisionId: string }).divisionId,
					staffAccessConsent: (payload as { staffAccessConsent: boolean })
						.staffAccessConsent,
				}),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/organizations/:slug/customer/membership-status", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService || !membershipStatusService) {
				throw new AppError("Membership status is unavailable.", 503);
			}
			const access = await customerAccountService.customerReadAccess(
				c.req.param("slug"),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
			);
			c.header("Cache-Control", "no-store");
			return c.json(
				await membershipStatusService.listForCustomer(
					access.organizationId,
					access.customerId,
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/organizations/:slug/customer/children", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService)
				throw new AppError("Customer Account is unavailable.", 503);
			return c.json(
				await customerAccountService.listChildren(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE),
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});
	router.post("/organizations/:slug/customer/children", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService)
				throw new AppError("Customer Account is unavailable.", 503);
			c.status(201);
			return c.json(
				await customerAccountService.createChild(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE),
					c.req.header("X-CSRF-Token"),
					c.req.header("Origin"),
					await c.req.json(),
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});
	router.post(
		"/organizations/:slug/customer/children/:childId/age-snapshot",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				if (!customerAccountService)
					throw new AppError("Customer Account is unavailable.", 503);
				return c.json(
					await customerAccountService.refreshChildAgeSnapshot(
						c.req.param("slug"),
						getCookie(c, CUSTOMER_SESSION_COOKIE),
						c.req.header("X-CSRF-Token"),
						c.req.header("Origin"),
						c.req.param("childId"),
						await c.req.json(),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
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
			const payload = await c.req.json();
			c.header("Cache-Control", "no-store");
			return c.json(
				await classCheckoutService.start({
					...payload,
					...access,
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

	router.post(
		"/organizations/:slug/customer/accompanist-membership",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				if (!customerAccountService || !accompanistMembershipService)
					throw new AppError("Accompanist membership is unavailable.", 503);
				const referer = c.req.header("Referer");
				const origin =
					c.req.header("Origin") ??
					(referer ? new URL(referer).origin : undefined);
				const access = await customerAccountService.formAccess(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE),
					c.req.header("X-CSRF-Token"),
					origin,
				);
				c.header("Cache-Control", "no-store");
				return c.json(
					await accompanistMembershipService.acquire({
						...access,
						payload: await c.req.json(),
					}),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/customer/accompanist-membership",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				if (!customerAccountService)
					throw new AppError("Accompanist membership is unavailable.", 503);
				const access = await customerAccountService.customerReadAccess(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE),
				);
				return c.json({
					policy: await organizationService.getAccompanistDivisionPolicy(
						access.organizationId,
					),
					divisions: await organizationService.listDivisions(
						access.organizationId,
						true,
					),
				});
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

	router.get("/organizations/:slug/customer/profile", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService)
				throw new AppError(
					"Customer Account integration is not configured.",
					503,
				);
			return c.json(
				await customerAccountService.customerProfile(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE),
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/organizations/:slug/customer/profile", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService)
				throw new AppError(
					"Customer Account integration is not configured.",
					503,
				);
			const referer = c.req.header("Referer");
			const requestOrigin =
				c.req.header("Origin") ??
				(referer ? new URL(referer).origin : undefined);
			return c.json(
				await customerAccountService.updateCustomerProfile(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE),
					c.req.header("X-CSRF-Token"),
					requestOrigin,
					await c.req.json(),
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/organizations/:slug/customer/orders", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService)
				throw new AppError(
					"Customer Account integration is not configured.",
					503,
				);
			return c.json(
				await customerAccountService.orders(
					c.req.param("slug"),
					getCookie(c, CUSTOMER_SESSION_COOKIE),
					c.req.query("after"),
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/organizations/:slug/customer/logout", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService)
				throw new AppError(
					"Customer Account integration is not configured.",
					503,
				);
			const body = await c.req.parseBody();
			const referer = c.req.header("Referer");
			const requestOrigin =
				c.req.header("Origin") ??
				(referer ? new URL(referer).origin : undefined);
			const redirect = await customerAccountService.logout(
				c.req.param("slug"),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				typeof body.csrfToken === "string" ? body.csrfToken : undefined,
				requestOrigin,
			);
			deleteCookie(c, CUSTOMER_SESSION_COOKIE, { path: "/api/", secure: true });
			return c.redirect(redirect);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

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
