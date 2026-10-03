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
import type { DropTransferService } from "../../registration/drop-transfer-service.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "../shared/csrf-guard.js";
import { assertAllowedFields } from "../shared/payload-guard.js";

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
	dropTransferService?: DropTransferService;
}

function requireCustomerAccountService(
	service: CustomerAccountService | undefined,
): CustomerAccountService {
	if (!service) throw new AppError("Customer Account is unavailable.", 503);
	return service;
}

function requireDropTransferService(
	service: DropTransferService | undefined,
): DropTransferService {
	if (!service)
		throw new AppError("Feature 'drop_and_transfer' is not enabled.", 404);
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

async function readJsonBody(c: Context): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		throw new AppError("Checkout request is invalid.", 400);
	}
}

function resolveFestivalShortName(
	c: Context,
	payload: Record<string, unknown>,
): string | undefined {
	const routeShortName = c.req.param("festivalShortName");
	return (
		routeShortName ||
		(typeof payload.festivalShortName === "string"
			? payload.festivalShortName
			: undefined)
	);
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
		const payload = parseCheckoutPayload(await readJsonBody(c));
		assertAllowedFields(
			payload,
			[
				"childId",
				"festivalClassId",
				"teacherId",
				"divisionId",
				"accompanistId",
				"accompanistOption",
				"pieces",
				"instrument",
				"festivalId",
				"festivalShortName",
				"organizationSlug",
			],
			"Class checkout request",
		);
		const festShortName = resolveFestivalShortName(c, payload);
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
	const {
		customerAccountService: cas,
		classCheckoutService: ccs,
		dropTransferService: dts,
	} = options;
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

	const updateMetadata = (c: Context<CustomerEnv>) =>
		withCustomerAccount(c, cas, async (s) => {
			let body: unknown;
			try {
				body = await c.req.json();
			} catch {
				throw new AppError("Invalid request body.", 400);
			}
			return s.updateRegistrationMetadata(
				requireSlug(c),
				c.req.param("festivalShortName"),
				c.req.param("registrationId") ?? "",
				getCookie(c, CUSTOMER_SESSION_COOKIE),
				c.req.header("X-CSRF-Token"),
				resolveRequestOrigin(c),
				body,
			);
		});
	router.patch("/class-registrations/:registrationId/metadata", updateMetadata);
	router.patch(
		`${reg}/class-registrations/:registrationId/metadata`,
		updateMetadata,
	);

	router.post("/class-registrations/:registrationId/drop", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			const accountService = requireCustomerAccountService(cas);
			const dropService = requireDropTransferService(dts);
			const slug = requireSlug(c);
			const registrationId = c.req.param("registrationId") ?? "";
			const sessionToken = getCookie(c, CUSTOMER_SESSION_COOKIE) ?? "";
			const session = await accountService.validateSession(slug, sessionToken);

			const entitlement = await dropService.getEntitlement(
				registrationId,
				session.organizationId,
			);
			if (!entitlement || entitlement.parentCustomerId !== session.customerId) {
				throw new AppError("Registration not found.", 404);
			}

			let body: Record<string, unknown> = {};
			try {
				const b = await c.req.json();
				if (b && typeof b === "object" && !Array.isArray(b)) {
					body = b as Record<string, unknown>;
				}
			} catch {
				// body is optional for drop
			}

			const reason = typeof body.reason === "string" ? body.reason : null;
			const requestRefund =
				body.requestRefund === true || body.issueRefund === true;

			const result = await dropService.dropRegistration({
				classEntitlementId: registrationId,
				organizationId: session.organizationId,
				festivalId: entitlement.festivalId,
				actorUid: session.customerId,
				actorRole: "customer",
				reason,
				requestRefund,
				issueRefund: requestRefund,
			});

			return c.json(result);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/class-registrations/:registrationId/transfer", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			const accountService = requireCustomerAccountService(cas);
			const dropService = requireDropTransferService(dts);
			const slug = requireSlug(c);
			const registrationId = c.req.param("registrationId") ?? "";
			const sessionToken = getCookie(c, CUSTOMER_SESSION_COOKIE) ?? "";
			const session = await accountService.validateSession(slug, sessionToken);

			const entitlement = await dropService.getEntitlement(
				registrationId,
				session.organizationId,
			);
			if (!entitlement || entitlement.parentCustomerId !== session.customerId) {
				throw new AppError("Registration not found.", 404);
			}

			let body: Record<string, unknown> = {};
			try {
				const b = await c.req.json();
				if (b && typeof b === "object" && !Array.isArray(b)) {
					body = b as Record<string, unknown>;
				} else {
					throw new AppError("Transfer request is invalid.", 400);
				}
			} catch (err) {
				if (err instanceof AppError) throw err;
				throw new AppError("Transfer request is invalid.", 400);
			}

			const targetFestivalClassId =
				typeof body.targetFestivalClassId === "string"
					? body.targetFestivalClassId.trim()
					: typeof body.targetClassId === "string"
						? body.targetClassId.trim()
						: typeof body.destinationFestivalClassId === "string"
							? body.destinationFestivalClassId.trim()
							: "";

			if (!targetFestivalClassId) {
				throw new AppError("Target festival class ID is required.", 400);
			}

			const reason = typeof body.reason === "string" ? body.reason : null;

			const result = await dropService.transferRegistration({
				classEntitlementId: registrationId,
				targetFestivalClassId,
				organizationId: session.organizationId,
				festivalId: entitlement.festivalId,
				sourceFestivalClassId: entitlement.festivalClassId,
				actorUid: session.customerId,
				actorRole: "customer",
				reason,
			});

			return c.json(result);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	return router;
}
