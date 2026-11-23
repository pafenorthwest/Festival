import {
	JoinWaitlistBodySchema,
	type JoinWaitlistInput,
	validateJoinWaitlistInput,
	validateWithdrawWaitlistInput,
	WaitlistClassQuerySchema,
	WithdrawWaitlistBodySchema,
	type WithdrawWaitlistInput,
} from "@festival/common";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import type { WaitlistService } from "../../waitlist/waitlist-service.js";
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

type CustomerEnv = { Variables: Partial<ApiVariables> };

const customerWaitlistRoute = (
	method: "GET" | "POST",
	path: string,
	csrfRequired: boolean,
): CoLocatedRouteSecurity =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "customer",
		csrfRequired,
		browserAllowed: true,
	});

export const CUSTOMER_WAITLIST_ROUTE_SECURITY = [
	customerWaitlistRoute(
		"POST",
		"/festivals/:festivalShortName/classes/:classId/waitlist",
		true,
	),
	customerWaitlistRoute(
		"POST",
		"/festivals/:festivalShortName/classes/:classId/waitlist/withdraw",
		true,
	),
	customerWaitlistRoute(
		"GET",
		"/festivals/:festivalShortName/classes/:classId/waitlist",
		false,
	),
	customerWaitlistRoute("GET", "/festivals/:festivalShortName/waitlist", false),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface CustomerWaitlistRoutesDeps {
	waitlistService?: WaitlistService;
	customerAccountService?: CustomerAccountService;
}

function requireWaitlistService(
	service: WaitlistService | undefined,
): WaitlistService {
	if (!service) {
		throw new AppError("Waitlist service is unavailable.", 503);
	}
	return service;
}

function requireCustomerAccountService(
	service: CustomerAccountService | undefined,
): CustomerAccountService {
	if (!service) {
		throw new AppError("Customer Account is unavailable.", 503);
	}
	return service;
}

function requireSlug(c: Context): string {
	const slug = c.req.param("slug");
	if (!slug) {
		throw new AppError("Organization slug is required.", 400);
	}
	return slug;
}

function requireFestivalShortName(c: Context): string {
	const festivalShortName = c.req.param("festivalShortName");
	if (!festivalShortName) {
		throw new AppError("Festival short name is required.", 400);
	}
	return festivalShortName;
}

function requireClassId(c: Context): string {
	const classId = c.req.param("classId");
	if (!classId) {
		throw new AppError("Class ID is required.", 400);
	}
	return classId;
}

interface WaitlistPostContext {
	service: WaitlistService;
	festivalShortName: string;
	classId: string;
	session: { organizationId: string; customerId: string };
}

interface WaitlistGetContext {
	service: WaitlistService;
	festivalShortName: string;
	session: { organizationId: string; customerId: string };
}

const waitlistPostContextCache = new WeakMap<Request, WaitlistPostContext>();
const waitlistGetContextCache = new WeakMap<Request, WaitlistGetContext>();

async function resolveWaitlistPostSession(
	c: Context<CustomerEnv>,
	deps: CustomerWaitlistRoutesDeps,
): Promise<WaitlistPostContext> {
	const cached = waitlistPostContextCache.get(c.req.raw);
	if (cached) {
		return cached;
	}
	assertNoBearerPrincipal(c.req.header("Authorization"));
	const service = requireWaitlistService(deps.waitlistService);
	const accountService = requireCustomerAccountService(
		deps.customerAccountService,
	);
	const slug = requireSlug(c);
	const festivalShortName = requireFestivalShortName(c);
	const classId = requireClassId(c);

	const session = await accountService.customerSession(
		slug,
		getCookie(c, CUSTOMER_SESSION_COOKIE),
		c.req.header("X-CSRF-Token"),
		resolveRequestOrigin(c),
	);
	const context = { service, festivalShortName, classId, session };
	waitlistPostContextCache.set(c.req.raw, context);
	return context;
}

async function resolveWaitlistGetSession(
	c: Context<CustomerEnv>,
	deps: CustomerWaitlistRoutesDeps,
): Promise<WaitlistGetContext> {
	const cached = waitlistGetContextCache.get(c.req.raw);
	if (cached) {
		return cached;
	}
	assertNoBearerPrincipal(c.req.header("Authorization"));
	const service = requireWaitlistService(deps.waitlistService);
	const accountService = requireCustomerAccountService(
		deps.customerAccountService,
	);
	const slug = requireSlug(c);
	const festivalShortName = requireFestivalShortName(c);

	const sessionToken = getCookie(c, CUSTOMER_SESSION_COOKIE);
	if (!sessionToken) {
		throw new AppError("Customer session is invalid.", 401);
	}

	const session = await accountService.validateSession(slug, sessionToken);
	const context = { service, festivalShortName, session };
	waitlistGetContextCache.set(c.req.raw, context);
	return context;
}

async function handleJoinWaitlist(
	c: Context<CustomerEnv>,
	deps: CustomerWaitlistRoutesDeps,
	body: unknown,
) {
	try {
		const { service, festivalShortName, classId, session } =
			await resolveWaitlistPostSession(c, deps);

		let input: JoinWaitlistInput;
		try {
			input = validateJoinWaitlistInput(body);
		} catch (err) {
			throw new AppError(
				err instanceof Error ? err.message : "Join waitlist input is invalid.",
				400,
			);
		}

		const result = await service.joinWaitlist({
			organizationId: session.organizationId,
			festivalId: festivalShortName,
			festivalClassId: classId,
			parentCustomerId: session.customerId,
			childId: input.childId,
			parentName: input.parentName,
			parentEmail: input.parentEmail,
			parentPhone: input.parentPhone,
			staffAccessConsent: input.staffAccessConsent,
		});

		return c.json(result);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleWithdrawWaitlist(
	c: Context<CustomerEnv>,
	deps: CustomerWaitlistRoutesDeps,
	body: unknown,
) {
	try {
		const { service, festivalShortName, classId, session } =
			await resolveWaitlistPostSession(c, deps);

		let input: WithdrawWaitlistInput;
		try {
			input = validateWithdrawWaitlistInput(body);
		} catch (err) {
			throw new AppError(
				err instanceof Error
					? err.message
					: "Waitlist withdrawal input is invalid.",
				400,
			);
		}

		const result = await service.withdrawWaitlist({
			organizationId: session.organizationId,
			festivalId: festivalShortName,
			parentCustomerId: session.customerId,
			...(input.childId ? { childId: input.childId } : {}),
			...(input.waitlistEntryId
				? { waitlistEntryId: input.waitlistEntryId }
				: {}),
			festivalClassId: classId,
			actorType: "parent",
			actorId: session.customerId,
		});

		return c.json(result);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleListClassWaitlist(
	c: Context<CustomerEnv>,
	deps: CustomerWaitlistRoutesDeps,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const service = requireWaitlistService(deps.waitlistService);
		const accountService = requireCustomerAccountService(
			deps.customerAccountService,
		);
		const slug = requireSlug(c);
		const festivalShortName = requireFestivalShortName(c);
		const classId = requireClassId(c);

		const sessionToken = getCookie(c, CUSTOMER_SESSION_COOKIE);
		if (!sessionToken) {
			throw new AppError("Customer session is invalid.", 401);
		}

		const session = await accountService.validateSession(slug, sessionToken);
		const entries = await service.listParentWaitlistEntries({
			organizationId: session.organizationId,
			parentCustomerId: session.customerId,
			festivalId: festivalShortName,
			classId,
		});

		c.header("Cache-Control", "no-store");
		return c.json({ entries });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleListFestivalWaitlist(
	c: Context<CustomerEnv>,
	deps: CustomerWaitlistRoutesDeps,
	classId?: string,
) {
	try {
		const { service, festivalShortName, session } =
			await resolveWaitlistGetSession(c, deps);
		const entries = await service.listParentWaitlistEntries({
			organizationId: session.organizationId,
			parentCustomerId: session.customerId,
			festivalId: festivalShortName,
			classId: classId?.trim() ? classId.trim() : undefined,
		});

		c.header("Cache-Control", "no-store");
		return c.json({ entries });
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildCustomerWaitlistRoutes(deps: CustomerWaitlistRoutesDeps) {
	const guardPostSession = preValidationGuard<CustomerEnv>(async (c) => {
		await resolveWaitlistPostSession(c, deps);
	});
	const guardGetSession = preValidationGuard<CustomerEnv>(async (c) => {
		await resolveWaitlistGetSession(c, deps);
	});

	return new Hono<CustomerEnv>()
		.post(
			"/festivals/:festivalShortName/classes/:classId/waitlist",
			guardPostSession,
			jsonValidator(JoinWaitlistBodySchema, {
				invalidJsonMessage: "Join waitlist input is invalid.",
			}),
			(c) => handleJoinWaitlist(c, deps, c.req.valid("json")),
		)
		.post(
			"/festivals/:festivalShortName/classes/:classId/waitlist/withdraw",
			guardPostSession,
			jsonValidator(WithdrawWaitlistBodySchema, {
				invalidJsonMessage: "Waitlist withdrawal input is invalid.",
			}),
			(c) => handleWithdrawWaitlist(c, deps, c.req.valid("json")),
		)
		.get("/festivals/:festivalShortName/classes/:classId/waitlist", (c) =>
			handleListClassWaitlist(c, deps),
		)
		.get(
			"/festivals/:festivalShortName/waitlist",
			guardGetSession,
			queryValidator(WaitlistClassQuerySchema),
			(c) => handleListFestivalWaitlist(c, deps, c.req.valid("query").classId),
		);
}
