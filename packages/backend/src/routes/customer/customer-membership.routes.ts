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

type CustomerEnv = { Variables: Partial<ApiVariables> };
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

interface CheckoutPayload {
	offeringId: string;
	divisionId: string;
	staffAccessConsent: boolean;
}

function validateCheckoutPayload(payload: unknown): CheckoutPayload {
	assertAllowedFields(
		payload,
		["offeringId", "divisionId", "staffAccessConsent"],
		"Checkout request",
	);
	const p = payload as Record<string, unknown> | null;
	const invalid =
		!p ||
		typeof p !== "object" ||
		Array.isArray(p) ||
		typeof p.offeringId !== "string" ||
		typeof p.divisionId !== "string" ||
		!p.divisionId.trim() ||
		p.staffAccessConsent !== true;
	if (invalid) throw new AppError("Checkout request is invalid.", 400);
	return payload as CheckoutPayload;
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

export function buildCustomerMembershipRoutes({
	customerAccountService,
	membershipCheckoutService,
	membershipStatusService,
	publicMembershipProductService,
	accompanistMembershipService,
	organizationService,
}: CustomerMembershipRoutesOptions): Hono<CustomerEnv> {
	const router = new Hono<CustomerEnv>();

	router.get("/membership-purchase/:offeringId", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
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
	});

	router.post("/checkout", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService || !membershipCheckoutService) {
				throw new AppError("Membership checkout is unavailable.", 503);
			}
			const idempotencyKey = requireIdempotencyKey(c);
			const payload = validateCheckoutPayload(await c.req.json());
			const access = await customerAccountService.checkoutAccess(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.header("X-CSRF-Token"),
				resolveRequestOrigin(c),
			);
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
	});

	router.get("/membership-status", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
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
	});

	router.get("/accompanist-membership", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
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
	});

	router.post("/accompanist-membership", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			if (!customerAccountService || !accompanistMembershipService) {
				throw new AppError("Accompanist membership is unavailable.", 503);
			}
			const access = await customerAccountService.formAccess(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.header("X-CSRF-Token"),
				resolveRequestOrigin(c),
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
	});

	return router;
}
