import type {
	AcceptInviteInput,
	CreateFestivalInput,
	CreateInviteInput,
	CreateOrganizationInput,
} from "@festival/common";
import { type Context, Hono } from "hono";
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
import type { MembershipCheckoutService } from "../checkout/membership-checkout-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../customer/customer-account-service.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationService } from "../services/organization-service.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import type { ShopifyIntegrationDiagnosticService } from "../shopify/shopify-integration-diagnostic-service.js";
import type { ShopifyIntegrationService } from "../shopify/shopify-integration-service.js";
import type { ShopifyMembershipProductService } from "../shopify/shopify-membership-product-service.js";

const ALLOWED_SHOPIFY_SETTINGS_FIELDS = new Set([
	"storeUrl",
	"clientId",
	"clientSecret",
	"storefrontPrivateToken",
]);

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
	assertAllowedFields(
		payload,
		["name", "description", "price"],
		"Membership product request",
	);
}

function assertNoBearerPrincipal(value: string | undefined): void {
	if (value !== undefined)
		throw new AppError(
			"Bearer authorization is not accepted on customer routes.",
			400,
		);
}

function assertBodylessPublicRead(
	authorization: string | undefined,
	contentLength: string | undefined,
	hasBody: boolean,
): void {
	if (authorization !== undefined) {
		throw new AppError(
			"Authorization is not accepted on this public route.",
			400,
		);
	}
	if (hasBody || (contentLength !== undefined && !/^0+$/.test(contentLength))) {
		throw new AppError(
			"Request body is not accepted on this public route.",
			400,
		);
	}
}

function assertBodylessDiagnostic(
	contentLength: string | undefined,
	hasBody: boolean,
): void {
	if (hasBody || (contentLength !== undefined && !/^0+$/.test(contentLength))) {
		throw new AppError("Request body is not accepted for diagnostics.", 400);
	}
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

export function buildApiRouter(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
	shopifyIntegrationService?: ShopifyIntegrationService,
	shopifyMembershipProductService?: ShopifyMembershipProductService,
	customerAccountService?: CustomerAccountService,
	publicMembershipProductService?: PublicMembershipProductService,
	shopifyIntegrationDiagnosticService?: ShopifyIntegrationDiagnosticService,
	membershipCheckoutService?: MembershipCheckoutService,
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

	router.get("/organizations/:slug/divisions", async (c) => {
		try {
			return c.json(
				await organizationService.listPublicDivisions(c.req.param("slug")),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get(
		"/organizations/:slug/admin/divisions",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listDivisionsForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/divisions",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["displayName"],
					"Division create request",
				);
				c.status(201);
				return c.json(
					await organizationService.createDivisionForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/divisions/reorder",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["divisionIds"],
					"Division reorder request",
				);
				return c.json(
					await organizationService.reorderDivisionsForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/divisions/:divisionId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["displayName", "isActive"],
					"Division update request",
				);
				return c.json(
					await organizationService.updateDivisionForTenant(
						getRequiredTenant(c),
						c.req.param("divisionId"),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/timezone",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.getTimezoneForTenant(getRequiredTenant(c)),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/timezone",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(payload, ["timezone"], "Timezone update request");
				return c.json(
					await organizationService.updateTimezoneForTenant(
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

	router.post(
		"/organizations/:slug/admin/shopify/diagnostics",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				assertBodylessDiagnostic(
					c.req.header("Content-Length"),
					c.req.raw.body !== null,
				);
				if (!shopifyIntegrationDiagnosticService) {
					throw new AppError("Shopify diagnostics are unavailable.", 503);
				}
				return c.json(
					await shopifyIntegrationDiagnosticService.runForTenant(
						getRequiredTenant(c),
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
			const payload = await c.req.json();
			assertAllowedFields(payload, ["offeringId"], "Checkout request");
			if (
				!payload ||
				typeof payload !== "object" ||
				Array.isArray(payload) ||
				typeof (payload as { offeringId?: unknown }).offeringId !== "string"
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
			c.header("Cache-Control", "no-store");
			return c.json(
				await membershipCheckoutService.start({
					...access,
					buyerAccessToken: access.shopifyCustomerAccessToken,
					offeringId: (payload as { offeringId: string }).offeringId,
				}),
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

	const publicMembershipProducts = async (
		c: Context<{ Variables: Partial<ApiVariables> }>,
	) => {
		try {
			assertBodylessPublicRead(
				c.req.header("Authorization"),
				c.req.header("Content-Length"),
				c.req.raw.body !== null,
			);
			if (!publicMembershipProductService)
				throw new AppError("Membership information is unavailable.", 503);
			const slug = c.req.param("slug");
			if (!slug) throw new AppError("Organization is required.", 400);
			c.header("Cache-Control", "no-store");
			return c.json(await publicMembershipProductService.list(slug));
		} catch (error) {
			return toJsonError(c, error);
		}
	};
	router.get(
		"/organizations/:slug/membership-products",
		publicMembershipProducts,
	);
	router.on("HEAD", "/organizations/:slug/membership-products", async (c) => {
		const response = await publicMembershipProducts(c);
		return new Response(null, {
			status: response.status,
			headers: response.headers,
		});
	});

	return router;
}
