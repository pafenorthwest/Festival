import type { RepertoirePiece } from "@festival/common";
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

export interface BrowserClassCheckoutDto {
	checkoutUrl: string;
	correlationId: string;
}

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

async function withCustomerAccount(
	c: Context<CustomerEnv>,
	service: CustomerAccountService | undefined,
	fn: (s: CustomerAccountService) => Promise<unknown>,
): Promise<Response> {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		return c.json(await fn(requireCustomerAccountService(service)));
	} catch (error) {
		return toJsonError(c, error);
	}
}

function parseCheckoutPayload(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new AppError("Checkout request is invalid.", 400);
	}
	return raw as Record<string, unknown>;
}

function buildCheckoutInput(
	access: Awaited<ReturnType<CustomerAccountService["checkoutAccess"]>>,
	payload: Record<string, unknown>,
	idempotencyKey: string,
	festivalShortName?: string,
) {
	const opt = (key: string) =>
		payload[key] !== undefined ? { [key]: payload[key] } : {};
	return {
		organizationId: access.organizationId,
		customerId: access.customerId,
		sessionId: access.sessionId,
		integrationVersion: access.integrationVersion,
		buyerAccessToken: access.shopifyCustomerAccessToken,
		idempotencyKey,
		festivalClassId: payload.festivalClassId as string,
		childId: payload.childId as string,
		teacherId: payload.teacherId as string,
		pieces: payload.pieces as RepertoirePiece[],
		...opt("divisionId"),
		...opt("accompanistId"),
		...opt("festivalId"),
		...(festivalShortName !== undefined ? { festivalShortName } : {}),
		...opt("currency"),
		...opt("currencyCode"),
	};
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
		let raw: unknown;
		try {
			raw = await c.req.json();
		} catch {
			throw new AppError("Checkout request is invalid.", 400);
		}
		const payload = parseCheckoutPayload(raw);
		const routeShortName = c.req.param("festivalShortName");
		const festShortName =
			routeShortName ||
			(typeof payload.festivalShortName === "string"
				? payload.festivalShortName
				: undefined);

		const input = buildCheckoutInput(
			access,
			payload,
			idempotencyKey,
			festShortName,
		);
		const result = await checkoutService.start(input);
		c.header("Cache-Control", "no-store");
		const responseDto: BrowserClassCheckoutDto = {
			checkoutUrl: result.checkoutUrl,
			correlationId: result.correlationId,
		};
		return c.json(responseDto);
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

	router.get(`${reg}/teachers`, (c) =>
		withCustomerAccount(c, cas, (s) =>
			s.listRegistrationTeachers(
				requireSlug(c),
				c.req.param("festivalShortName") ?? "",
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.query("childId") ?? "",
				c.req.query("divisionId") ?? "",
			),
		),
	);
	router.get(`${reg}/eligible-classes`, (c) =>
		withCustomerAccount(c, cas, (s) =>
			s.listRegistrationEligibleClasses(
				requireSlug(c),
				c.req.param("festivalShortName") ?? "",
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.query("childId") ?? "",
				c.req.query("divisionId") ?? "",
				c.req.query("teacherId") ?? "",
			),
		),
	);
	router.get(`${reg}/accompanists`, (c) =>
		withCustomerAccount(c, cas, (s) =>
			s.listRegistrationAccompanists(
				requireSlug(c),
				c.req.param("festivalShortName") ?? "",
				getCookie(c, CUSTOMER_SESSION_COOKIE),
			),
		),
	);
	router.post("/class-checkout", (c) => handleClassCheckout(c, cas, ccs));
	router.post(`${reg}/checkout`, (c) => handleClassCheckout(c, cas, ccs));
	const listRegs = (c: Context<CustomerEnv>) =>
		withCustomerAccount(c, cas, (s) =>
			s.listClassRegistrations(
				requireSlug(c),
				getCookie(c, CUSTOMER_SESSION_COOKIE) ?? "",
				c.req.param("festivalShortName"),
			),
		);
	router.get("/class-registrations", listRegs);
	router.get(`${reg}/class-registrations`, listRegs);

	return router;
}
