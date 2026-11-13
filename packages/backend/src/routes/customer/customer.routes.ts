import {
	CustomerOrdersQuerySchema,
	UpdateCustomerProfileRouteBodySchema,
} from "@festival/common";
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
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
	queryValidator,
} from "../shared/schema-validator.js";

export const CUSTOMER_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/session",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/profile",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/profile",
		authenticationClass: "customer",
		csrfRequired: true,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/orders",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/logout",
		authenticationClass: "customer",
		csrfRequired: true,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface CustomerRoutesOptions {
	customerAccountService?: CustomerAccountService;
}

type CustomerContext = Context<{ Variables: Partial<ApiVariables> }>;

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
	c: CustomerContext,
	service?: CustomerAccountService,
) {
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
	c: CustomerContext,
	service?: CustomerAccountService,
) {
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
	c: CustomerContext,
	service: CustomerAccountService | undefined,
	body: unknown,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.updateCustomerProfile(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.header("X-CSRF-Token"),
				resolveRequestOrigin(c),
				body,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function ordersHandler(
	c: CustomerContext,
	service?: CustomerAccountService,
	after?: string,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.orders(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				after,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function logoutHandler(
	c: CustomerContext,
	service?: CustomerAccountService,
) {
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

export function buildCustomerRoutes(options: CustomerRoutesOptions) {
	const { customerAccountService } = options;
	const guardCustomerAccount = preValidationGuard((c) => {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		requireCustomerAccountService(customerAccountService);
		requireOrganizationSlug(c);
	});
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/session", (c) => sessionHandler(c, customerAccountService))
		.get("/profile", (c) => getProfileHandler(c, customerAccountService))
		.post(
			"/profile",
			guardCustomerAccount,
			jsonValidator(UpdateCustomerProfileRouteBodySchema),
			(c) => postProfileHandler(c, customerAccountService, c.req.valid("json")),
		)
		.get(
			"/orders",
			guardCustomerAccount,
			queryValidator(CustomerOrdersQuerySchema),
			(c) =>
				ordersHandler(c, customerAccountService, c.req.valid("query").after),
		)
		.post("/logout", (c) => logoutHandler(c, customerAccountService));
}

export type CustomerRoutesType = ReturnType<typeof buildCustomerRoutes>;
