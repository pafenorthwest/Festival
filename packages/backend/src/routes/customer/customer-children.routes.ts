import {
	CreateCustomerChildInputSchema,
	RefreshCustomerChildAgeSnapshotInputSchema,
} from "@festival/common";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
} from "../shared/schema-validator.js";

export const CUSTOMER_CHILDREN_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/children",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/children",
		authenticationClass: "customer",
		csrfRequired: true,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/children/:childId/age-snapshot",
		authenticationClass: "customer",
		csrfRequired: true,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface CustomerChildrenRoutesOptions {
	customerAccountService?: CustomerAccountService;
}

type ChildrenContext = Context<{ Variables: Partial<ApiVariables> }>;

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
	c: ChildrenContext,
	service?: CustomerAccountService,
) {
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
	c: ChildrenContext,
	service: CustomerAccountService | undefined,
	body: unknown,
) {
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
				body,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function refreshChildAgeSnapshotHandler(
	c: ChildrenContext,
	service: CustomerAccountService | undefined,
	body: unknown,
) {
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
				body,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildCustomerChildrenRoutes(
	options: CustomerChildrenRoutesOptions,
) {
	const { customerAccountService } = options;
	const guardChildren = preValidationGuard((c) => {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		requireCustomerAccountService(customerAccountService);
		requireOrganizationSlug(c);
	});
	const guardChildAgeSnapshot = preValidationGuard((c) => {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		requireCustomerAccountService(customerAccountService);
		requireOrganizationSlug(c);
		requireChildId(c);
	});
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/children", (c) => listChildrenHandler(c, customerAccountService))
		.post(
			"/children",
			guardChildren,
			jsonValidator(CreateCustomerChildInputSchema),
			(c) => createChildHandler(c, customerAccountService, c.req.valid("json")),
		)
		.post(
			"/children/:childId/age-snapshot",
			guardChildAgeSnapshot,
			jsonValidator(RefreshCustomerChildAgeSnapshotInputSchema),
			(c) =>
				refreshChildAgeSnapshotHandler(
					c,
					customerAccountService,
					c.req.valid("json"),
				),
		);
}

export type CustomerChildrenRoutesType = ReturnType<
	typeof buildCustomerChildrenRoutes
>;
