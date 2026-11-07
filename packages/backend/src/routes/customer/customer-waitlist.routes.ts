import {
	type JoinWaitlistInput,
	validateJoinWaitlistInput,
	validateWithdrawWaitlistInput,
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

type CustomerEnv = { Variables: Partial<ApiVariables> };

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

export function buildCustomerWaitlistRoutes(
	deps: CustomerWaitlistRoutesDeps,
): Hono<CustomerEnv> {
	const router = new Hono<CustomerEnv>();
	const { waitlistService, customerAccountService } = deps;

	router.post(
		"/festivals/:festivalShortName/classes/:classId/waitlist",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				const service = requireWaitlistService(waitlistService);
				const accountService = requireCustomerAccountService(
					customerAccountService,
				);
				const slug = requireSlug(c);
				const festivalShortName = requireFestivalShortName(c);
				const classId = requireClassId(c);

				const sessionToken = getCookie(c, CUSTOMER_SESSION_COOKIE);
				const csrfToken = c.req.header("X-CSRF-Token");
				const origin = resolveRequestOrigin(c);
				const session = await accountService.customerSession(
					slug,
					sessionToken,
					csrfToken,
					origin,
				);

				let body: unknown;
				try {
					body = await c.req.json();
				} catch {
					throw new AppError("Join waitlist input is invalid.", 400);
				}

				let input: JoinWaitlistInput;
				try {
					input = validateJoinWaitlistInput(body);
				} catch (err) {
					throw new AppError(
						err instanceof Error
							? err.message
							: "Join waitlist input is invalid.",
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
		},
	);

	router.post(
		"/festivals/:festivalShortName/classes/:classId/waitlist/withdraw",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				const service = requireWaitlistService(waitlistService);
				const accountService = requireCustomerAccountService(
					customerAccountService,
				);
				const slug = requireSlug(c);
				const festivalShortName = requireFestivalShortName(c);
				const classId = requireClassId(c);

				const sessionToken = getCookie(c, CUSTOMER_SESSION_COOKIE);
				const csrfToken = c.req.header("X-CSRF-Token");
				const origin = resolveRequestOrigin(c);
				const session = await accountService.customerSession(
					slug,
					sessionToken,
					csrfToken,
					origin,
				);

				let body: unknown;
				try {
					body = await c.req.json();
				} catch {
					throw new AppError("Waitlist withdrawal input is invalid.", 400);
				}

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
		},
	);

	router.get(
		"/festivals/:festivalShortName/classes/:classId/waitlist",
		async (c) => {
			try {
				assertNoBearerPrincipal(c.req.header("Authorization"));
				const service = requireWaitlistService(waitlistService);
				const accountService = requireCustomerAccountService(
					customerAccountService,
				);
				const slug = requireSlug(c);
				const festivalShortName = requireFestivalShortName(c);
				const classId = requireClassId(c);

				const sessionToken = getCookie(c, CUSTOMER_SESSION_COOKIE);
				if (!sessionToken) {
					throw new AppError("Customer session is invalid.", 401);
				}

				const session = await accountService.validateSession(
					slug,
					sessionToken,
				);

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
		},
	);

	router.get("/festivals/:festivalShortName/waitlist", async (c) => {
		try {
			assertNoBearerPrincipal(c.req.header("Authorization"));
			const service = requireWaitlistService(waitlistService);
			const accountService = requireCustomerAccountService(
				customerAccountService,
			);
			const slug = requireSlug(c);
			const festivalShortName = requireFestivalShortName(c);

			const sessionToken = getCookie(c, CUSTOMER_SESSION_COOKIE);
			if (!sessionToken) {
				throw new AppError("Customer session is invalid.", 401);
			}

			const session = await accountService.validateSession(slug, sessionToken);

			const classId = c.req.query("classId");
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
	});

	return router;
}
