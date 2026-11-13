import {
	AccompanistOfferingPayloadSchema,
	MembershipProductPayloadSchema,
	RetireMembershipProductPayloadSchema,
} from "@festival/common";
import { type Context, Hono } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../../auth/tenant-context.js";
import type { AuthVerifier } from "../../auth/types.js";
import { AppError } from "../../errors/app-error.js";
import type { OrganizationRepository } from "../../repo/organization-repository.js";
import type { ShopifyMembershipProductService } from "../../shopify/shopify-membership-product-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
} from "../shared/schema-validator.js";

export const ADMIN_SHOPIFY_PRODUCTS_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/admin/membership-products",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/membership-products",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/membership-products/:offeringId",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/membership-products/:offeringId/retire",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/accompanist-offering",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/accompanist-offering/:offeringId",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

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

export function assertNoForbiddenMembershipProductFields(
	payload: unknown,
): void {
	assertAllowedFields(
		payload,
		["name", "description", "price"],
		"Membership product request",
	);
}

export interface AdminShopifyProductRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	shopifyMembershipProductService?: ShopifyMembershipProductService;
}

type AdminContext = Context<{ Variables: Partial<ApiVariables> }>;

function assertRetireOfferingPayload(payload: unknown): void {
	assertAllowedFields(
		payload,
		["confirmed"],
		"Membership offering retirement request",
	);
	if (
		!payload ||
		typeof payload !== "object" ||
		Array.isArray(payload) ||
		(payload as { confirmed?: unknown }).confirmed !== true
	) {
		throw new AppError(
			"Membership offering retirement must be confirmed.",
			400,
		);
	}
}

function assertAccompanistOfferingFields(payload: unknown): void {
	assertAllowedFields(
		payload,
		["name", "description", "price", "durationDays"],
		"Accompanist offering request",
	);
}

interface MembershipProductPayload {
	name?: string;
	description?: string;
	price?: string | number;
}

interface AccompanistOfferingPayload extends MembershipProductPayload {
	durationDays?: string | number;
}

function requireProductService(
	service: ShopifyMembershipProductService | undefined,
): ShopifyMembershipProductService {
	if (!service) {
		throw new AppError("Shopify integration is not configured.", 503);
	}
	return service;
}

function requireOfferingId(c: AdminContext): string {
	const offeringId = c.req.param("offeringId");
	if (!offeringId) {
		throw new AppError("Offering ID is required.", 400);
	}
	return offeringId;
}

async function listMembershipProductsHandler(
	c: AdminContext,
	service?: ShopifyMembershipProductService,
) {
	try {
		const membershipProducts = await requireProductService(
			service,
		).listMembershipProductsForOrganization(getRequiredTenant(c));
		return c.json({ membershipProducts });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function createMembershipProductHandler(
	c: AdminContext,
	service: ShopifyMembershipProductService | undefined,
	payload: MembershipProductPayload,
) {
	try {
		const productService = requireProductService(service);
		const membershipProduct = await productService.createMembershipProduct(
			getRequiredTenant(c),
			payload,
		);
		c.status(201);
		return c.json({ membershipProduct });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function updateMembershipProductHandler(
	c: AdminContext,
	service: ShopifyMembershipProductService | undefined,
	payload: MembershipProductPayload,
) {
	try {
		const productService = requireProductService(service);
		return c.json({
			membershipProduct: await productService.updateMembershipProduct(
				getRequiredTenant(c),
				requireOfferingId(c),
				payload,
			),
		});
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function retireMembershipProductHandler(
	c: AdminContext,
	service?: ShopifyMembershipProductService,
) {
	try {
		const productService = requireProductService(service);
		await productService.retireMembershipOffering(
			getRequiredTenant(c),
			requireOfferingId(c),
		);
		return c.json({ retired: true });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function createAccompanistOfferingHandler(
	c: AdminContext,
	service: ShopifyMembershipProductService | undefined,
	payload: AccompanistOfferingPayload,
) {
	try {
		const productService = requireProductService(service);
		const membershipProduct = await productService.createAccompanistOffering(
			getRequiredTenant(c),
			payload,
		);
		c.status(201);
		return c.json({ membershipProduct });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function updateAccompanistOfferingHandler(
	c: AdminContext,
	service: ShopifyMembershipProductService | undefined,
	payload: AccompanistOfferingPayload,
) {
	try {
		const productService = requireProductService(service);
		return c.json({
			membershipProduct: await productService.updateAccompanistOffering(
				getRequiredTenant(c),
				requireOfferingId(c),
				payload,
			),
		});
	} catch (error) {
		return toJsonError(c, error);
	}
}

const membershipProductValidator = jsonValidator(
	MembershipProductPayloadSchema,
	{ preCheck: assertNoForbiddenMembershipProductFields },
);
const retireOfferingValidator = jsonValidator(
	RetireMembershipProductPayloadSchema,
	{ preCheck: assertRetireOfferingPayload },
);
const accompanistOfferingValidator = jsonValidator(
	AccompanistOfferingPayloadSchema,
	{ preCheck: assertAccompanistOfferingFields },
);

export function buildAdminShopifyProductRoutes(
	options: AdminShopifyProductRoutesOptions,
) {
	const {
		authVerifier,
		repository,
		shopifyMembershipProductService: svc,
	} = options;
	const admin = [
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
	] as const;
	const requireServiceGuard = preValidationGuard(() => {
		requireProductService(svc);
	});

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/organizations/:slug/admin/membership-products", ...admin, (c) =>
			listMembershipProductsHandler(c, svc),
		)
		.post(
			"/organizations/:slug/admin/membership-products",
			...admin,
			requireServiceGuard,
			membershipProductValidator,
			(c) => createMembershipProductHandler(c, svc, c.req.valid("json")),
		)
		.post(
			"/organizations/:slug/admin/membership-products/:offeringId",
			...admin,
			requireServiceGuard,
			membershipProductValidator,
			(c) => updateMembershipProductHandler(c, svc, c.req.valid("json")),
		)
		.post(
			"/organizations/:slug/admin/membership-products/:offeringId/retire",
			...admin,
			requireServiceGuard,
			retireOfferingValidator,
			(c) => retireMembershipProductHandler(c, svc),
		)
		.post(
			"/organizations/:slug/admin/accompanist-offering",
			...admin,
			requireServiceGuard,
			accompanistOfferingValidator,
			(c) => createAccompanistOfferingHandler(c, svc, c.req.valid("json")),
		)
		.post(
			"/organizations/:slug/admin/accompanist-offering/:offeringId",
			...admin,
			requireServiceGuard,
			accompanistOfferingValidator,
			(c) => updateAccompanistOfferingHandler(c, svc, c.req.valid("json")),
		);
}

export type AdminShopifyProductRoutesType = ReturnType<
	typeof buildAdminShopifyProductRoutes
>;
