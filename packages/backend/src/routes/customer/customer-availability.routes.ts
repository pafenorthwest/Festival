import type { SaveCustomerFestivalAvailabilityRequest } from "@festival/common";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import { CUSTOMER_SESSION_COOKIE } from "../../customer/customer-account-service.js";
import type { CustomerAvailabilityService } from "../../customer/customer-availability-service.js";
import { AppError } from "../../errors/app-error.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "../shared/csrf-guard.js";

export interface CustomerAvailabilityRoutesOptions {
	customerAvailabilityService?: CustomerAvailabilityService;
}

function requireCustomerAvailabilityService(
	service: CustomerAvailabilityService | undefined,
): CustomerAvailabilityService {
	if (!service) {
		throw new AppError("Customer availability is unavailable.", 503);
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

async function readAvailabilityPayload(
	c: Context,
): Promise<SaveCustomerFestivalAvailabilityRequest> {
	try {
		return (await c.req.json()) as SaveCustomerFestivalAvailabilityRequest;
	} catch {
		throw new AppError(
			"Availability request is invalid.",
			400,
			"invalid_availability",
		);
	}
}

async function getAvailabilityHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAvailabilityService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const availabilityService = requireCustomerAvailabilityService(service);
		c.header("Cache-Control", "no-store");
		return c.json(
			await availabilityService.getAvailability(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.query("festivalId"),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function putAvailabilityHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	service?: CustomerAvailabilityService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const availabilityService = requireCustomerAvailabilityService(service);
		const body = await readAvailabilityPayload(c);
		c.header("Cache-Control", "no-store");
		return c.json(
			await availabilityService.saveAvailability(
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

export function buildCustomerAvailabilityRoutes(
	options: CustomerAvailabilityRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { customerAvailabilityService } = options;

	router.get("/availability", (c) =>
		getAvailabilityHandler(c, customerAvailabilityService),
	);
	router.put("/availability", (c) =>
		putAvailabilityHandler(c, customerAvailabilityService),
	);

	return router;
}
