import {
	CustomerAvailabilityQuerySchema,
	SaveCustomerFestivalAvailabilityInputSchema,
	type SaveCustomerFestivalAvailabilityRequest,
} from "@festival/common";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import { CUSTOMER_SESSION_COOKIE } from "../../customer/customer-account-service.js";
import type { CustomerAvailabilityService } from "../../customer/customer-availability-service.js";
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

export const CUSTOMER_AVAILABILITY_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/availability",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "PUT",
		path: "/availability",
		authenticationClass: "customer",
		csrfRequired: true,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface CustomerAvailabilityRoutesOptions {
	customerAvailabilityService?: CustomerAvailabilityService;
}

type AvailabilityContext = Context<{ Variables: Partial<ApiVariables> }>;

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

async function getAvailabilityHandler(
	c: AvailabilityContext,
	service: CustomerAvailabilityService | undefined,
	festivalId?: string,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const availabilityService = requireCustomerAvailabilityService(service);
		c.header("Cache-Control", "no-store");
		return c.json(
			await availabilityService.getAvailability(
				requireOrganizationSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				festivalId,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function putAvailabilityHandler(
	c: AvailabilityContext,
	service: CustomerAvailabilityService | undefined,
	body: SaveCustomerFestivalAvailabilityRequest,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const availabilityService = requireCustomerAvailabilityService(service);
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
) {
	const { customerAvailabilityService } = options;
	const guardAvailability = preValidationGuard((c) => {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		requireCustomerAvailabilityService(customerAvailabilityService);
		requireOrganizationSlug(c);
	});
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/availability",
			guardAvailability,
			queryValidator(CustomerAvailabilityQuerySchema),
			(c) =>
				getAvailabilityHandler(
					c,
					customerAvailabilityService,
					c.req.valid("query").festivalId,
				),
		)
		.put(
			"/availability",
			guardAvailability,
			jsonValidator(SaveCustomerFestivalAvailabilityInputSchema, {
				invalidJsonMessage: "Availability request is invalid.",
				errorCode: "invalid_availability",
			}),
			(c) =>
				putAvailabilityHandler(
					c,
					customerAvailabilityService,
					c.req.valid("json"),
				),
		);
}

export type CustomerAvailabilityRoutesType = ReturnType<
	typeof buildCustomerAvailabilityRoutes
>;
