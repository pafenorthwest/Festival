import {
	AdminCustomerSearchQuerySchema,
	AdminRevokeEntitlementPayloadSchema,
	SaveCustomerAccountSettingsRouteBodySchema,
	SaveShopifyIntegrationPayloadSchema,
	validateShopifySettingsInput,
} from "@festival/common";
import { type Context, Hono } from "hono";
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
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
	queryValidator,
} from "../shared/schema-validator.js";
import {
	ADMIN_SHOPIFY_PRODUCTS_ROUTE_SECURITY,
	assertAllowedFields,
	assertNoForbiddenMembershipProductFields,
	buildAdminShopifyProductRoutes,
} from "./admin-shopify-products.routes.js";

export { assertAllowedFields, assertNoForbiddenMembershipProductFields };

export const ADMIN_SHOPIFY_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/entitlements/:entitlementId/revoke",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/admin/shopify",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/shopify",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/shopify/diagnostics",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/admin/shopify-customer-account",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/shopify-customer-account",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/admin/customers",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/admin/customers/:customerId",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	...ADMIN_SHOPIFY_PRODUCTS_ROUTE_SECURITY,
] as const satisfies readonly CoLocatedRouteSecurity[];

export const ALLOWED_SHOPIFY_SETTINGS_FIELDS = new Set([
	"storeUrl",
	"clientId",
	"clientSecret",
	"storefrontPrivateToken",
]);

export function assertNoExtraShopifySettingsFields(payload: unknown): void {
	assertAllowedFields(
		payload,
		[...ALLOWED_SHOPIFY_SETTINGS_FIELDS],
		"Shopify settings",
	);
}

function preCheckShopifySettingsPayload(payload: unknown): void {
	assertNoExtraShopifySettingsFields(payload);
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		const validation = validateShopifySettingsInput(payload, {
			requireClientSecret: true,
		});
		if (!validation.valid) {
			throw new AppError(validation.errors.join(" "), 400);
		}
	}
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

type AdminContext = Context<{ Variables: Partial<ApiVariables> }>;

function requireCustomerAccountService(
	service: CustomerAccountService | undefined,
): CustomerAccountService {
	if (!service) {
		throw new AppError("Customer Account integration is not configured.", 503);
	}
	return service;
}

function requirePathParam(
	c: AdminContext,
	name: string,
	label: string,
): string {
	const value = c.req.param(name);
	if (!value) {
		throw new AppError(`${label} is required.`, 400);
	}
	return value;
}

function parseRevokeReason(payload: unknown): string {
	assertAllowedFields(
		payload,
		["confirmed", "reason"],
		"Entitlement revocation request",
	);
	if (
		payload &&
		typeof payload === "object" &&
		"confirmed" in payload &&
		(payload as { confirmed?: unknown }).confirmed !== true
	) {
		throw new AppError("Revocation confirmation is required.", 400);
	}
	const reason =
		payload && typeof payload === "object"
			? (payload as { reason?: unknown }).reason
			: undefined;
	if (
		typeof reason !== "string" ||
		!reason.trim() ||
		reason.trim().length > 500
	) {
		throw new AppError("A revocation reason is required.", 400);
	}
	return reason.trim();
}

async function revokeEntitlementHandler(
	c: AdminContext,
	repository: OrganizationRepository,
	payload: { confirmed?: true; reason: string },
) {
	try {
		const reason = payload.reason.trim();
		const tenant = getRequiredTenant(c);
		const nowFn =
			(repository as { now?: () => Date }).now ?? (() => new Date());
		c.header("Cache-Control", "no-store");
		return c.json(
			await repository.revokeEntitlement({
				organizationId: tenant.organization.id,
				entitlementId: requirePathParam(c, "entitlementId", "Entitlement ID"),
				actorUserId: tenant.user.id,
				reason,
				revokedAtIso: nowFn().toISOString(),
			}),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function getShopifySettingsHandler(
	c: AdminContext,
	service?: ShopifyIntegrationService,
) {
	try {
		if (!service) {
			throw new AppError("Shopify integration is not configured.", 503);
		}
		return c.json(await service.getSettingsForTenant(getRequiredTenant(c)));
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function saveShopifySettingsHandler(
	c: AdminContext,
	service: ShopifyIntegrationService | undefined,
	payload: {
		storeUrl?: string;
		clientId?: string;
		clientSecret?: string;
		storefrontPrivateToken?: string;
	},
) {
	try {
		if (!service) {
			throw new AppError("Shopify integration is not configured.", 503);
		}
		return c.json(
			await service.saveAndTestForTenant(getRequiredTenant(c), payload),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function shopifyDiagnosticsHandler(
	c: AdminContext,
	service?: ShopifyIntegrationDiagnosticService,
) {
	try {
		assertBodylessDiagnostic(
			c.req.header("Content-Length"),
			c.req.raw.body !== null,
		);
		if (!service) {
			throw new AppError("Shopify diagnostics are unavailable.", 503);
		}
		return c.json(await service.runForTenant(getRequiredTenant(c)));
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function getCustomerAccountSettingsHandler(
	c: AdminContext,
	service?: CustomerAccountService,
) {
	try {
		const accountService = requireCustomerAccountService(service);
		const tenant = getRequiredTenant(c);
		return c.json(
			await accountService.getSettings(
				tenant.organization.id,
				tenant.organization.slug,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function saveCustomerAccountSettingsHandler(
	c: AdminContext,
	service: CustomerAccountService | undefined,
	payload: {
		storefrontDomain?: string;
		clientId?: string;
		clientSecret?: string;
	},
) {
	try {
		const accountService = requireCustomerAccountService(service);
		const tenant = getRequiredTenant(c);
		return c.json(
			await accountService.saveAndVerify(
				tenant.organization.id,
				tenant.organization.slug,
				payload,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function searchAdminCustomersHandler(
	c: AdminContext,
	service: CustomerAccountService | undefined,
	query?: string,
) {
	try {
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.searchAdminCustomers(
				getRequiredTenant(c).organization.id,
				query,
				getRequiredIdentity(c).uid,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function getAdminCustomerProfileHandler(
	c: AdminContext,
	service?: CustomerAccountService,
) {
	try {
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.adminCustomerProfile(
				getRequiredTenant(c).organization.id,
				requirePathParam(c, "customerId", "Customer ID"),
				getRequiredIdentity(c).uid,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

function resolveAdminShopifyRepository(options: AdminShopifyRoutesOptions) {
	const repository =
		options.repository ?? options.organizationService?.repository;
	if (!repository) {
		throw new Error(
			"OrganizationRepository is required to build admin Shopify routes.",
		);
	}
	return repository;
}

const revokeEntitlementValidator = jsonValidator(
	AdminRevokeEntitlementPayloadSchema,
	{
		preCheck: (raw) => {
			parseRevokeReason(raw);
		},
	},
);

const saveShopifySettingsValidator = jsonValidator(
	SaveShopifyIntegrationPayloadSchema,
	{ preCheck: preCheckShopifySettingsPayload },
);

const saveCustomerAccountSettingsValidator = jsonValidator(
	SaveCustomerAccountSettingsRouteBodySchema,
);

const customerSearchQueryValidator = queryValidator(
	AdminCustomerSearchQuerySchema,
);

function buildAdminCustomerRoutes(
	options: AdminShopifyRoutesOptions,
	repository: OrganizationRepository,
) {
	const { authVerifier, customerAccountService } = options;
	const admin = [
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
	] as const;
	const requireCustomerAccountGuard = preValidationGuard(() => {
		requireCustomerAccountService(customerAccountService);
	});

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/organizations/:slug/admin/shopify-customer-account", ...admin, (c) =>
			getCustomerAccountSettingsHandler(c, customerAccountService),
		)
		.post(
			"/organizations/:slug/admin/shopify-customer-account",
			...admin,
			requireCustomerAccountGuard,
			saveCustomerAccountSettingsValidator,
			(c) =>
				saveCustomerAccountSettingsHandler(
					c,
					customerAccountService,
					c.req.valid("json"),
				),
		)
		.get(
			"/organizations/:slug/admin/customers",
			...admin,
			requireCustomerAccountGuard,
			customerSearchQueryValidator,
			(c) =>
				searchAdminCustomersHandler(
					c,
					customerAccountService,
					c.req.valid("query").query,
				),
		)
		.get("/organizations/:slug/admin/customers/:customerId", ...admin, (c) =>
			getAdminCustomerProfileHandler(c, customerAccountService),
		);
}

export function buildAdminShopifyRoutes(options: AdminShopifyRoutesOptions) {
	const {
		authVerifier,
		shopifyIntegrationService,
		shopifyIntegrationDiagnosticService,
		shopifyMembershipProductService,
	} = options;
	const repository = resolveAdminShopifyRepository(options);
	const admin = [
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
	] as const;
	const requireShopifyGuard = preValidationGuard(() => {
		if (!shopifyIntegrationService) {
			throw new AppError("Shopify integration is not configured.", 503);
		}
	});
	const productRoutes = buildAdminShopifyProductRoutes({
		authVerifier,
		repository,
		shopifyMembershipProductService,
	});
	const customerRoutes = buildAdminCustomerRoutes(options, repository);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.post(
			"/organizations/:slug/admin/entitlements/:entitlementId/revoke",
			...admin,
			revokeEntitlementValidator,
			(c) => revokeEntitlementHandler(c, repository, c.req.valid("json")),
		)
		.get("/organizations/:slug/admin/shopify", ...admin, (c) =>
			getShopifySettingsHandler(c, shopifyIntegrationService),
		)
		.post(
			"/organizations/:slug/admin/shopify",
			...admin,
			requireShopifyGuard,
			saveShopifySettingsValidator,
			(c) =>
				saveShopifySettingsHandler(
					c,
					shopifyIntegrationService,
					c.req.valid("json"),
				),
		)
		.post("/organizations/:slug/admin/shopify/diagnostics", ...admin, (c) =>
			shopifyDiagnosticsHandler(c, shopifyIntegrationDiagnosticService),
		)
		.route("/", customerRoutes)
		.route("/", productRoutes);
}

export type AdminShopifyRoutesType = ReturnType<typeof buildAdminShopifyRoutes>;
