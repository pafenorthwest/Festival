import {
	AcquireAccompanistMembershipRouteBodySchema,
	CustomerMembershipCheckoutPayloadSchema,
} from "@festival/common";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import type { MembershipCheckoutService } from "../../checkout/membership-checkout-service.js";
import type { MembershipStatusService } from "../../commerce/membership-status-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import type { AccompanistMembershipService } from "../../services/accompanist-membership-service.js";
import type { OrganizationService } from "../../services/organization-service.js";
import type { PublicMembershipProductService } from "../../shopify/public-membership-product-service.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "../shared/csrf-guard.js";
import { assertAllowedFields } from "../shared/payload-guard.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
} from "../shared/schema-validator.js";

export const CUSTOMER_MEMBERSHIP_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/membership-purchase/:offeringId",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/checkout",
		authenticationClass: "customer",
		csrfRequired: true,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/membership-status",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/accompanist-membership",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/accompanist-membership",
		authenticationClass: "customer",
		csrfRequired: true,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

type CustomerEnv = { Variables: Partial<ApiVariables> };
type CustomerContext = Context<CustomerEnv>;
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CustomerMembershipRoutesOptions {
	customerAccountService?: CustomerAccountService;
	membershipCheckoutService?: MembershipCheckoutService;
	membershipStatusService?: MembershipStatusService;
	publicMembershipProductService?: PublicMembershipProductService;
	accompanistMembershipService?: AccompanistMembershipService;
	organizationService?: OrganizationService;
}

interface MembershipCheckoutAccessContext {
	customerAccountService: CustomerAccountService;
	membershipCheckoutService: MembershipCheckoutService;
	access: Awaited<ReturnType<CustomerAccountService["checkoutAccess"]>>;
	idempotencyKey: string;
}

interface AccompanistMembershipAccessContext {
	customerAccountService: CustomerAccountService;
	accompanistMembershipService: AccompanistMembershipService;
	access: Awaited<ReturnType<CustomerAccountService["formAccess"]>>;
}

const membershipCheckoutCache = new WeakMap<
	Request,
	MembershipCheckoutAccessContext
>();
const accompanistAccessCache = new WeakMap<
	Request,
	AccompanistMembershipAccessContext
>();

const ACCOMPANIST_ALLOWED_FIELDS = [
	"name",
	"email",
	"city",
	"phone",
	"divisionIds",
	"staffAccessConsent",
] as const;

async function resolveMembershipCheckoutContext(
	c: CustomerContext,
	options: CustomerMembershipRoutesOptions,
): Promise<MembershipCheckoutAccessContext> {
	const cached = membershipCheckoutCache.get(c.req.raw);
	if (cached) {
		return cached;
	}
	assertNoBearerPrincipal(c.req.header("Authorization"));
	const { customerAccountService, membershipCheckoutService } = options;
	if (!customerAccountService || !membershipCheckoutService) {
		throw new AppError("Membership checkout is unavailable.", 503);
	}
	const slug = requireOrganizationSlug(c);
	const access = await customerAccountService.checkoutAccess(
		slug,
		getCookie(c, CUSTOMER_SESSION_COOKIE),
		c.req.header("X-CSRF-Token"),
		resolveRequestOrigin(c),
	);
	const idempotencyKey = requireIdempotencyKey(c);
	const context = {
		customerAccountService,
		membershipCheckoutService,
		access,
		idempotencyKey,
	};
	membershipCheckoutCache.set(c.req.raw, context);
	return context;
}

async function resolveAccompanistContext(
	c: CustomerContext,
	options: CustomerMembershipRoutesOptions,
): Promise<AccompanistMembershipAccessContext> {
	const cached = accompanistAccessCache.get(c.req.raw);
	if (cached) {
		return cached;
	}
	assertNoBearerPrincipal(c.req.header("Authorization"));
	const { customerAccountService, accompanistMembershipService } = options;
	if (!customerAccountService || !accompanistMembershipService) {
		throw new AppError("Accompanist membership is unavailable.", 503);
	}
	const access = await customerAccountService.formAccess(
		requireOrganizationSlug(c),
		getCookie(c, CUSTOMER_SESSION_COOKIE),
		c.req.header("X-CSRF-Token"),
		resolveRequestOrigin(c),
	);
	const context = {
		customerAccountService,
		accompanistMembershipService,
		access,
	};
	accompanistAccessCache.set(c.req.raw, context);
	return context;
}

function requireIdempotencyKey(c: Context): string {
	const key = c.req.header("Idempotency-Key");
	if (!key || !UUID_REGEX.test(key)) {
		throw new AppError("Checkout request is invalid.", 400);
	}
	return key;
}

function requireOrganizationSlug(c: Context): string {
	const slug = c.req.param("slug");
	if (!slug) {
		throw new AppError("Organization slug is required.", 400);
	}
	return slug;
}

function requireOfferingId(c: Context): string {
	const offeringId = c.req.param("offeringId");
	if (!offeringId) {
		throw new AppError("Offering ID is required.", 400);
	}
	return offeringId;
}

async function getMembershipPurchaseHandler(
	c: CustomerContext,
	options: CustomerMembershipRoutesOptions,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const { customerAccountService, publicMembershipProductService } = options;
		if (!customerAccountService || !publicMembershipProductService) {
			throw new AppError("Membership purchase is unavailable.", 503);
		}
		const slug = requireOrganizationSlug(c);
		const session = await customerAccountService.session(
			slug,
			getCookie(c, CUSTOMER_SESSION_COOKIE),
		);
		if (!session.session.authenticated) {
			throw new AppError("Customer session is invalid.", 401);
		}
		c.header("Cache-Control", "no-store");
		return c.json(
			await publicMembershipProductService.resolvePurchasable(
				slug,
				requireOfferingId(c),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function postMembershipCheckoutHandler(
	c: CustomerContext,
	options: CustomerMembershipRoutesOptions,
	payload: { offeringId: string; divisionId: string; staffAccessConsent: true },
) {
	try {
		const {
			customerAccountService,
			membershipCheckoutService,
			access,
			idempotencyKey,
		} = await resolveMembershipCheckoutContext(c, options);
		await customerAccountService.recordCheckoutStaffAccessConsent(
			access.organizationId,
			access.customerId,
		);
		c.header("Cache-Control", "no-store");
		return c.json(
			await membershipCheckoutService.start({
				...access,
				buyerAccessToken: access.shopifyCustomerAccessToken,
				idempotencyKey,
				...payload,
			}),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function getMembershipStatusHandler(
	c: CustomerContext,
	options: CustomerMembershipRoutesOptions,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const { customerAccountService, membershipStatusService } = options;
		if (!customerAccountService || !membershipStatusService) {
			throw new AppError("Membership status is unavailable.", 503);
		}
		const access = await customerAccountService.customerReadAccess(
			requireOrganizationSlug(c),
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
}

async function getAccompanistMembershipHandler(
	c: CustomerContext,
	options: CustomerMembershipRoutesOptions,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const { customerAccountService, organizationService } = options;
		if (!customerAccountService || !organizationService) {
			throw new AppError("Accompanist membership is unavailable.", 503);
		}
		const access = await customerAccountService.customerReadAccess(
			requireOrganizationSlug(c),
			getCookie(c, CUSTOMER_SESSION_COOKIE),
		);
		const orgId = access.organizationId;
		return c.json({
			policy: await organizationService.getAccompanistDivisionPolicy(orgId),
			divisions: await organizationService.listDivisions(orgId, true),
		});
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function postAccompanistMembershipHandler(
	c: CustomerContext,
	options: CustomerMembershipRoutesOptions,
	payload: unknown,
) {
	try {
		const { customerAccountService, accompanistMembershipService, access } =
			await resolveAccompanistContext(c, options);
		await customerAccountService.recordCheckoutStaffAccessConsent(
			access.organizationId,
			access.customerId,
		);
		c.header("Cache-Control", "no-store");
		return c.json(
			await accompanistMembershipService.acquire({ ...access, payload }),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildCustomerMembershipRoutes(
	options: CustomerMembershipRoutesOptions,
) {
	const guardCheckout = preValidationGuard<CustomerEnv>(async (c) => {
		await resolveMembershipCheckoutContext(c, options);
	});
	const guardAccompanist = preValidationGuard<CustomerEnv>(async (c) => {
		await resolveAccompanistContext(c, options);
	});

	return new Hono<CustomerEnv>()
		.get("/membership-purchase/:offeringId", (c) =>
			getMembershipPurchaseHandler(c, options),
		)
		.post(
			"/checkout",
			guardCheckout,
			jsonValidator(CustomerMembershipCheckoutPayloadSchema, {
				invalidJsonMessage: "Checkout request is invalid.",
			}),
			(c) => postMembershipCheckoutHandler(c, options, c.req.valid("json")),
		)
		.get("/membership-status", (c) => getMembershipStatusHandler(c, options))
		.get("/accompanist-membership", (c) =>
			getAccompanistMembershipHandler(c, options),
		)
		.post(
			"/accompanist-membership",
			guardAccompanist,
			jsonValidator(AcquireAccompanistMembershipRouteBodySchema, {
				invalidJsonMessage: "Accompanist form is invalid.",
				preCheck: (raw) => {
					assertAllowedFields(
						raw,
						ACCOMPANIST_ALLOWED_FIELDS,
						"Accompanist form",
					);
				},
			}),
			(c) => postAccompanistMembershipHandler(c, options, c.req.valid("json")),
		);
}

export type CustomerMembershipRoutesType = ReturnType<
	typeof buildCustomerMembershipRoutes
>;
