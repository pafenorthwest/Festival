import { Hono } from "hono";
import {
	type ApiVariables,
	getRequiredIdentity,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../../auth/tenant-context.js";
import type { AuthVerifier } from "../../auth/types.js";
import type { CustomerAccountService } from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import type { OrganizationRepository } from "../../repo/organization-repository.js";
import type { OrganizationService } from "../../services/organization-service.js";
import type { ShopifyIntegrationDiagnosticService } from "../../shopify/shopify-integration-diagnostic-service.js";
import type { ShopifyIntegrationService } from "../../shopify/shopify-integration-service.js";
import type { ShopifyMembershipProductService } from "../../shopify/shopify-membership-product-service.js";

export const ALLOWED_SHOPIFY_SETTINGS_FIELDS = new Set([
	"storeUrl",
	"clientId",
	"clientSecret",
	"storefrontPrivateToken",
]);

export function assertAllowedFields(
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

export function assertNoExtraShopifySettingsFields(payload: unknown): void {
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

export function assertNoForbiddenMembershipProductFields(
	payload: unknown,
): void {
	assertAllowedFields(
		payload,
		["name", "description", "price"],
		"Membership product request",
	);
}

export function assertBodylessDiagnostic(
	contentLength: string | undefined,
	hasBody: boolean,
): void {
	if (hasBody || (contentLength !== undefined && !/^0+$/.test(contentLength))) {
		throw new AppError("Request body is not accepted for diagnostics.", 400);
	}
}

export interface AdminShopifyRoutesOptions {
	authVerifier: AuthVerifier;
	organizationService?: OrganizationService;
	repository?: OrganizationRepository;
	shopifyIntegrationService?: ShopifyIntegrationService;
	shopifyIntegrationDiagnosticService?: ShopifyIntegrationDiagnosticService;
	shopifyMembershipProductService?: ShopifyMembershipProductService;
	customerAccountService?: CustomerAccountService;
}

export function buildAdminShopifyRoutes(
	options: AdminShopifyRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const {
		authVerifier,
		shopifyIntegrationService,
		shopifyIntegrationDiagnosticService,
		shopifyMembershipProductService,
		customerAccountService,
	} = options;
	const repository =
		options.repository ?? options.organizationService?.repository;
	if (!repository) {
		throw new Error(
			"OrganizationRepository is required to build admin Shopify routes.",
		);
	}

	router.post(
		"/organizations/:slug/admin/entitlements/:entitlementId/revoke",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["reason"],
					"Entitlement revocation request",
				);
				const reason =
					payload && typeof payload === "object"
						? (payload as { reason?: unknown }).reason
						: undefined;
				if (
					typeof reason !== "string" ||
					!reason.trim() ||
					reason.trim().length > 500
				)
					throw new AppError("A revocation reason is required.", 400);
				const tenant = getRequiredTenant(c);
				return c.json(
					await repository.revokeEntitlement({
						organizationId: tenant.organization.id,
						entitlementId: c.req.param("entitlementId"),
						actorUserId: tenant.user.id,
						reason: reason.trim(),
						revokedAtIso: new Date().toISOString(),
					}),
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

	router.post(
		"/organizations/:slug/admin/membership-products/:offeringId/retire",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyMembershipProductService) {
					throw new AppError("Shopify integration is not configured.", 503);
				}
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["confirmed"],
					"Membership offering retirement request",
				);
				if (payload.confirmed !== true) {
					throw new AppError(
						"Membership offering retirement must be confirmed.",
						400,
					);
				}
				await shopifyMembershipProductService.retireMembershipOffering(
					getRequiredTenant(c),
					c.req.param("offeringId"),
				);
				return c.json({ retired: true });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/accompanist-offering",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyMembershipProductService) {
					throw new AppError("Shopify integration is not configured.", 503);
				}
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["name", "description", "price", "durationDays"],
					"Accompanist offering request",
				);
				const membershipProduct =
					await shopifyMembershipProductService.createAccompanistOffering(
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

	router.post(
		"/organizations/:slug/admin/accompanist-offering/:offeringId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyMembershipProductService)
					throw new AppError("Shopify integration is not configured.", 503);
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["name", "description", "price", "durationDays"],
					"Accompanist offering request",
				);
				return c.json({
					membershipProduct:
						await shopifyMembershipProductService.updateAccompanistOffering(
							getRequiredTenant(c),
							c.req.param("offeringId"),
							payload,
						),
				});
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
