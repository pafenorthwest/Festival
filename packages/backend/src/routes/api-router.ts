import type {
	AcceptInviteInput,
	CreateFestivalInput,
	CreateInviteInput,
	CreateOrganizationInput,
} from "@festival/common";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	type ApiVariables,
	assertTenantRole,
	getRequiredIdentity,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	resolveTenantContext,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../customer/customer-account-service.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationService } from "../services/organization-service.js";
import type { ShopifyIntegrationService } from "../shopify/shopify-integration-service.js";
import type { ShopifyMembershipProductService } from "../shopify/shopify-membership-product-service.js";

const FORBIDDEN_MEMBERSHIP_PRODUCT_FIELDS = [
	"organizationId",
	"shopifyProductGid",
	"shopifyVariantGid",
	"variantName",
	"storeDomain",
	"clientId",
	"clientSecret",
	"credentials",
	"shopGid",
	"verifiedShopGid",
	"verifiedShopDomain",
	"grantedScopes",
	"scope",
	"capability",
	"accessToken",
	"token",
	"integrationVersion",
] as const;

const ALLOWED_SHOPIFY_SETTINGS_FIELDS = new Set([
	"storeUrl",
	"clientId",
	"clientSecret",
]);

function assertNoExtraShopifySettingsFields(payload: unknown): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return;
	}
	const extraFields = Object.keys(payload).filter(
		(field) => !ALLOWED_SHOPIFY_SETTINGS_FIELDS.has(field),
	);
	if (extraFields.length > 0) {
		throw new AppError(
			`Shopify settings cannot include browser-controlled fields: ${extraFields.join(", ")}.`,
			400,
		);
	}
}

function assertNoForbiddenMembershipProductFields(payload: unknown): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return;
	}

	const forbiddenFields = FORBIDDEN_MEMBERSHIP_PRODUCT_FIELDS.filter((field) =>
		Object.hasOwn(payload, field),
	);
	if (forbiddenFields.length > 0) {
		throw new AppError(
			`Membership product request cannot include browser-controlled fields: ${forbiddenFields.join(", ")}.`,
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

export function buildApiRouter(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
	shopifyIntegrationService?: ShopifyIntegrationService,
	shopifyMembershipProductService?: ShopifyMembershipProductService,
	customerAccountService?: CustomerAccountService,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const repository = organizationService.repository;

	router.get("/bootstrap", async (c) => {
		try {
			if (c.req.header("Authorization") !== undefined) {
				throw new AppError(
					"Authorization is not accepted on the bootstrap route.",
					400,
				);
			}

			return c.json(await organizationService.getSession());
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/firebase-session", requireAuth(authVerifier), async (c) => {
		try {
			return c.json(
				await organizationService.getSession(getRequiredIdentity(c)),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/organizations", requireAuth(authVerifier), async (c) => {
		try {
			const payload = (await c.req.json()) as CreateOrganizationInput;
			c.status(201);
			return c.json(
				await organizationService.createOrganization(
					getRequiredIdentity(c),
					payload,
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/memberships", requireAuth(authVerifier), async (c) => {
		try {
			return c.json(
				await organizationService.listMemberships(getRequiredIdentity(c)),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/invites", requireAuth(authVerifier), async (c) => {
		try {
			const payload = (await c.req.json()) as CreateInviteInput;
			const tenant = await resolveTenantContext(
				c,
				repository,
				payload.organizationSlug,
			);
			assertTenantRole(tenant, ["Admin"]);
			c.status(201);
			return c.json(
				await organizationService.createInviteForTenant(tenant, payload),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/invites/:token", async (c) => {
		try {
			return c.json(await organizationService.getInvite(c.req.param("token")));
		} catch (error) {
			return toJsonError(c, error);
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
						getRequiredIdentity(c),
						c.req.param("token"),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				return c.json(
					organizationService.getOrganizationLandingForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/welcome/dismiss",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole([
			"Admin",
			"Division Chair",
			"Music Reviewer",
			"Concert Chair",
			"Read Only",
		]),
		async (c) => {
			try {
				return c.json(
					await organizationService.dismissWelcomeForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/users",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listAdminUsersForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.delete(
		"/organizations/:slug/admin/memberships/:membershipId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.deleteMembershipForTenant(
						getRequiredTenant(c),
						c.req.param("membershipId"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.delete(
		"/organizations/:slug/admin/invites/:inviteId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.cancelInviteForTenant(
						getRequiredTenant(c),
						c.req.param("inviteId"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/festivals",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listFestivalsForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/festivals",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = (await c.req.json()) as CreateFestivalInput;
				c.status(201);
				return c.json(
					await organizationService.createFestivalForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/shopify",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyIntegrationService) {
					throw new AppError("Shopify integration is not configured.", 503);
				}

				return c.json(
					await shopifyIntegrationService.getSettingsForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/shopify",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyIntegrationService) {
					throw new AppError("Shopify integration is not configured.", 503);
				}

				const payload = await c.req.json();
				assertNoExtraShopifySettingsFields(payload);
				return c.json(
					await shopifyIntegrationService.saveAndTestForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/shopify-customer-account",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!customerAccountService)
					throw new AppError(
						"Customer Account integration is not configured.",
						503,
					);
				const tenant = getRequiredTenant(c);
				return c.json(
					await customerAccountService.getSettings(
						tenant.organization.id,
						tenant.organization.slug,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/shopify-customer-account",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!customerAccountService)
					throw new AppError(
						"Customer Account integration is not configured.",
						503,
					);
				const tenant = getRequiredTenant(c);
				return c.json(
					await customerAccountService.saveAndVerify(
						tenant.organization.id,
						tenant.organization.slug,
						await c.req.json(),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get("/organizations/:slug/customer-auth/start", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService)
				throw new AppError(
					"Customer Account integration is not configured.",
					503,
				);
			return c.redirect(
				await customerAccountService.start(
					c.req.param("slug"),
					c.req.query("returnTo"),
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
			const result = await customerAccountService.callback(
				c.req.query("state"),
				c.req.query("code"),
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

	router.get(
		"/organizations/:slug/admin/customers",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!customerAccountService)
					throw new AppError(
						"Customer Account integration is not configured.",
						503,
					);
				return c.json(
					await customerAccountService.searchAdminCustomers(
						getRequiredTenant(c).organization.id,
						c.req.query("query"),
						getRequiredIdentity(c).uid,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/customers/:customerId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!customerAccountService)
					throw new AppError(
						"Customer Account integration is not configured.",
						503,
					);
				return c.json(
					await customerAccountService.adminCustomerProfile(
						getRequiredTenant(c).organization.id,
						c.req.param("customerId"),
						getRequiredIdentity(c).uid,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/membership-products",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyMembershipProductService) {
					throw new AppError("Shopify integration is not configured.", 503);
				}

				const membershipProducts =
					await shopifyMembershipProductService.listMembershipProductsForOrganization(
						getRequiredTenant(c),
					);
				return c.json({ membershipProducts });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/membership-products",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyMembershipProductService) {
					throw new AppError("Shopify integration is not configured.", 503);
				}

				const payload = await c.req.json();
				assertNoForbiddenMembershipProductFields(payload);
				const membershipProduct =
					await shopifyMembershipProductService.createMembershipProduct(
						getRequiredTenant(c),
						payload,
					);
				c.status(201);
				return c.json({ membershipProduct });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get("/organizations/:slug/membership-products", async (c) => {
		c.status(403);
		return c.json({ error: "Forbidden." });
	});

	return router;
}
