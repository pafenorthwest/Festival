import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";

export interface CustomerChildrenRoutesOptions {
	customerAccountService?: CustomerAccountService;
}

function requireCustomerAccountService(
	service: CustomerAccountService | undefined,
): CustomerAccountService {
	if (!service) {
		throw new AppError("Customer Account is unavailable.", 503);
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

function requireChildId(c: Context): string {
	const childId = c.req.param("childId");
	if (!childId) {
		throw new AppError("Child ID is required.", 400);
	}
	return childId;
}

async function listChildrenHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.listChildren(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function createChildHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		c.status(201);
		return c.json(
			await accountService.createChild(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.header("X-CSRF-Token"),
				c.req.header("Origin"),
				await c.req.json(),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function refreshChildAgeSnapshotHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const accountService = requireCustomerAccountService(service);
		return c.json(
			await accountService.refreshChildAgeSnapshot(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.header("X-CSRF-Token"),
				c.req.header("Origin"),
				requireChildId(c),
				await c.req.json(),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildCustomerChildrenRoutes(
	options: CustomerChildrenRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { customerAccountService } = options;

	router.get("/children", (c) =>
		listChildrenHandler(c, customerAccountService),
	);
	router.post("/children", (c) =>
		createChildHandler(c, customerAccountService),
	);
	router.post("/children/:childId/age-snapshot", (c) =>
		refreshChildAgeSnapshotHandler(c, customerAccountService),
	);

	return router;
}
