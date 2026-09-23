import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import type { ClassCheckoutService } from "../../checkout/class-checkout-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "../shared/csrf-guard.js";

type CustomerEnv = { Variables: Partial<ApiVariables> };
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CustomerRegistrationRoutesOptions {
	customerAccountService?: CustomerAccountService;
	classCheckoutService?: ClassCheckoutService;
}

function requireCustomerAccountService(
	service: CustomerAccountService | undefined,
): CustomerAccountService {
	if (!service) throw new AppError("Customer Account is unavailable.", 503);
	return service;
}

function requireIdempotencyKey(c: Context): string {
	const key = c.req.header("Idempotency-Key");
	if (!key || !UUID_REGEX.test(key))
		throw new AppError("Checkout request is invalid.", 400);
	return key;
}

function requireSlug(c: Context): string {
	const slug = c.req.param("slug");
	if (!slug) throw new AppError("Organization slug is required.", 400);
	return slug;
}

async function listTeachersHandler(
	c: Context<CustomerEnv>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const s = requireCustomerAccountService(service);
		return c.json(
			await s.listRegistrationTeachers(
				requireSlug(c),
				c.req.param("festivalShortName") ?? "",
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.query("childId") ?? "",
				c.req.query("divisionId") ?? "",
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function listEligibleClassesHandler(
	c: Context<CustomerEnv>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const s = requireCustomerAccountService(service);
		return c.json(
			await s.listRegistrationEligibleClasses(
				requireSlug(c),
				c.req.param("festivalShortName") ?? "",
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.query("childId") ?? "",
				c.req.query("divisionId") ?? "",
				c.req.query("teacherId") ?? "",
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function listAccompanistsHandler(
	c: Context<CustomerEnv>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const s = requireCustomerAccountService(service);
		return c.json(
			await s.listRegistrationAccompanists(
				requireSlug(c),
				c.req.param("festivalShortName") ?? "",
				getCookie(c, CUSTOMER_SESSION_COOKIE),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function listClassRegistrationsHandler(
	c: Context<CustomerEnv>,
	service?: CustomerAccountService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const s = requireCustomerAccountService(service);
		return c.json(
			await s.listClassRegistrations(
				requireSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE) ?? "",
				c.req.param("festivalShortName"),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

export async function handleClassCheckout(
	c: Context<CustomerEnv>,
	accountService?: CustomerAccountService,
	checkoutService?: ClassCheckoutService,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		if (!accountService || !checkoutService) {
			throw new AppError("Class checkout is unavailable.", 503);
		}
		const idempotencyKey = requireIdempotencyKey(c);
		const origin = resolveRequestOrigin(c);
		const access = await accountService.checkoutAccess(
			requireSlug(c),
			getCookie(c, CUSTOMER_SESSION_COOKIE),
			c.req.header("X-CSRF-Token"),
			origin,
		);
		const festivalShortName = c.req.param("festivalShortName");
		const payload = await c.req.json();
		c.header("Cache-Control", "no-store");
		return c.json(
			await checkoutService.start({
				...payload,
				...access,
				festivalShortName: festivalShortName || payload.festivalShortName,
				buyerAccessToken: access.shopifyCustomerAccessToken,
				idempotencyKey,
			}),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildCustomerRegistrationRoutes(
	options: CustomerRegistrationRoutesOptions,
): Hono<CustomerEnv> {
	const router = new Hono<CustomerEnv>();
	const { customerAccountService: cas, classCheckoutService: ccs } = options;
	const reg = "/festivals/:festivalShortName/registration";

	router.get(`${reg}/teachers`, (c) => listTeachersHandler(c, cas));
	router.get(`${reg}/eligible-classes`, (c) =>
		listEligibleClassesHandler(c, cas),
	);
	router.get(`${reg}/accompanists`, (c) => listAccompanistsHandler(c, cas));
	router.post("/class-checkout", (c) => handleClassCheckout(c, cas, ccs));
	router.post(`${reg}/checkout`, (c) => handleClassCheckout(c, cas, ccs));
	const listRegs = (c: Context<CustomerEnv>) =>
		listClassRegistrationsHandler(c, cas);
	router.get("/class-registrations", listRegs);
	router.get(`${reg}/class-registrations`, listRegs);

	return router;
}
