import { type Context, Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "../shared/csrf-guard.js";

export interface CustomerRoutesOptions {
	customerAccountService?: CustomerAccountService;
}

function requireCustomerAccountService(
	service: CustomerAccountService | undefined,
): CustomerAccountService {
	if (!service) {
		throw new AppError("Customer Account integration is not configured.", 503);
	}
	return service;
}

function requireOrganizationSlug(c: Context): string {
	const slug = c.req.param("slug");
	if (!slug) {
		throw new AppError("Organization is required.", 400);
	}
	return slug;
}

async function sessionHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.session(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function getProfileHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.customerProfile(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function postProfileHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.updateCustomerProfile(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.header("X-CSRF-Token"),
				resolveRequestOrigin(c),
				await c.req.json(),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function ordersHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.orders(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.query("after"),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function logoutHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		const body = await c.req.parseBody();
		const redirect = await accountService.logout(
			requireOrganizationSlug(c),
			getCookie(c, CUSTOMER_SESSION_COOKIE),
			typeof body.csrfToken === "string" ? body.csrfToken : undefined,
			resolveRequestOrigin(c),
		);
		deleteCookie(c, CUSTOMER_SESSION_COOKIE, { path: "/api/", secure: true });
		return c.redirect(redirect);
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildCustomerRoutes(
	options: CustomerRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { customerAccountService } = options;

	router.get("/session", (c) => sessionHandler(c, customerAccountService));
	router.get("/profile", (c) => getProfileHandler(c, customerAccountService));
	router.post("/profile", (c) => postProfileHandler(c, customerAccountService));
	router.get("/orders", (c) => ordersHandler(c, customerAccountService));
	router.post("/logout", (c) => logoutHandler(c, customerAccountService));

	return router;
}
