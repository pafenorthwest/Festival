import { type Context, Hono } from "hono";
import { setCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import type { PublicMembershipProductService } from "../../shopify/public-membership-product-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";

export const CUSTOMER_AUTH_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/customer-auth/start",
		authenticationClass: "customer-auth-start",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/customer-auth/callback",
		authenticationClass: "customer-oauth-callback",
		csrfRequired: false,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export function assertNoBearerPrincipal(value: string | undefined): void {
	if (value !== undefined)
		throw new AppError(
			"Bearer authorization is not accepted on customer routes.",
			400,
		);
}

export function assertAllowedCustomerAuthStartQuery(url: string): void {
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

export interface CustomerAuthRoutesOptions {
	customerAccountService?: CustomerAccountService;
	publicMembershipProductService?: PublicMembershipProductService;
}

type CustomerAuthContext = Context<{ Variables: Partial<ApiVariables> }>;

function requireOrganizationSlug(c: CustomerAuthContext): string {
	const slug = c.req.param("slug");
	if (!slug) {
		throw new AppError("Organization is required.", 400);
	}
	return slug;
}

async function startCustomerAuthHandler(
	c: CustomerAuthContext,
	options: CustomerAuthRoutesOptions,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		assertAllowedCustomerAuthStartQuery(c.req.url);
		const { customerAccountService, publicMembershipProductService } = options;
		if (!customerAccountService)
			throw new AppError(
				"Customer Account integration is not configured.",
				503,
			);
		const slug = requireOrganizationSlug(c);
		const offeringId = c.req.query("offering");
		if (offeringId) {
			if (!publicMembershipProductService)
				throw new AppError("Membership information is unavailable.", 503);
			await publicMembershipProductService.resolvePurchasable(slug, offeringId);
		}
		return c.redirect(
			await customerAccountService.start(
				slug,
				c.req.query("returnTo"),
				offeringId,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function callbackCustomerAuthHandler(
	c: CustomerAuthContext,
	options: CustomerAuthRoutesOptions,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const { customerAccountService, publicMembershipProductService } = options;
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
}

export function buildCustomerAuthRoutes(options: CustomerAuthRoutesOptions) {
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/organizations/:slug/customer-auth/start", (c) =>
			startCustomerAuthHandler(c, options),
		)
		.get("/customer-auth/callback", (c) =>
			callbackCustomerAuthHandler(c, options),
		);
}

export type CustomerAuthRoutesType = ReturnType<typeof buildCustomerAuthRoutes>;
