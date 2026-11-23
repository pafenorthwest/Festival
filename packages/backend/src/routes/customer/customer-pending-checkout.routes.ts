import {
	ClassCheckoutRecoveryReferenceInputSchema,
	type PendingClassCheckoutDto,
} from "@festival/common";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { safeParse } from "valibot";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import type { PendingClassCheckoutService } from "../../domains/class-checkout/pending-class-checkout-service.js";
import { AppError } from "../../errors/app-error.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "../shared/csrf-guard.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";

type PendingCheckoutEnv = { Variables: Partial<ApiVariables> };

export interface CustomerPendingCheckoutRoutesOptions {
	customerAccountService?: CustomerAccountService;
	pendingClassCheckoutService?: Pick<
		PendingClassCheckoutService,
		"getPending" | "resume"
	>;
}

export const CUSTOMER_PENDING_CHECKOUT_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/pending-checkout",
		authenticationClass: "customer",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/pending-checkout/:reference/resume",
		authenticationClass: "customer",
		csrfRequired: true,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

/** Select browser fields explicitly; provider identifiers stay inside the service. */
function customerCheckout(checkout: PendingClassCheckoutDto) {
	return {
		state: checkout.state,
		recoveryReference: checkout.recoveryReference,
		festivalShortName: checkout.festivalShortName,
		registrationCount: checkout.registrationCount,
		registrations: checkout.registrations.map((line) => ({
			lineId: line.lineId,
			childId: line.childId,
			childName: line.childName,
			divisionId: line.divisionId,
			divisionName: line.divisionName,
			teacherId: line.teacherId,
			teacherName: line.teacherName,
			classId: line.classId,
			className: line.className,
			classSubtypeId: line.classSubtypeId,
			classSubtypeName: line.classSubtypeName,
			minimumAge: line.minimumAge,
			maximumAge: line.maximumAge,
			priceCents: line.priceCents,
			accompanistId: line.accompanistId,
			accompanistName: line.accompanistName,
			instrumentId: line.instrumentId,
			instrumentName: line.instrumentName,
			pieces: line.pieces.map((piece) => ({
				title: piece.title,
				composer: piece.composer,
				movement: piece.movement,
				durationSeconds: piece.durationSeconds,
				durationMinutes: piece.durationMinutes,
				catalogWorkId: piece.catalogWorkId,
			})),
		})),
		resumeAllowed: checkout.resumeAllowed,
		reasonCode: checkout.reasonCode,
		verifiedAtIso: checkout.verifiedAtIso,
		...(checkout.estimatedTotal
			? {
					estimatedTotal: {
						amount: checkout.estimatedTotal.amount,
						currencyCode: checkout.estimatedTotal.currencyCode,
					},
				}
			: {}),
		...(checkout.payment
			? {
					payment: {
						receivedAmount: checkout.payment.receivedAmount,
						outstandingAmount: checkout.payment.outstandingAmount,
						currencyCode: checkout.payment.currencyCode,
					},
				}
			: {}),
	};
}

export function buildCustomerPendingCheckoutRoutes(
	options: CustomerPendingCheckoutRoutesOptions,
) {
	function services(c: Context<PendingCheckoutEnv>) {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		const slug = c.req.param("slug");
		if (!slug) throw new AppError("Organization slug is required.", 400);
		const { customerAccountService, pendingClassCheckoutService } = options;
		if (!customerAccountService || !pendingClassCheckoutService) {
			throw new AppError("Checkout verification is unavailable.", 503);
		}
		return {
			slug,
			session: getCookie(c, CUSTOMER_SESSION_COOKIE),
			accounts: customerAccountService,
			checkouts: pendingClassCheckoutService,
		};
	}

	return new Hono<PendingCheckoutEnv>()
		.get("/pending-checkout", async (c) => {
			c.header("Cache-Control", "no-store");
			try {
				const { slug, session, accounts, checkouts } = services(c);
				const { organizationId, customerId } =
					await accounts.customerReadAccess(slug, session);
				const checkout = await checkouts.getPending({
					organizationId,
					customerId,
				});
				return c.json({
					checkout: checkout ? customerCheckout(checkout) : null,
				});
			} catch (error) {
				return toJsonError(c, error);
			}
		})
		.post("/pending-checkout/:reference/resume", async (c) => {
			c.header("Cache-Control", "no-store");
			try {
				const { slug, session, accounts, checkouts } = services(c);
				const { organizationId, customerId } = await accounts.formAccess(
					slug,
					session,
					c.req.header("X-CSRF-Token"),
					resolveRequestOrigin(c),
				);
				const recoveryReference = c.req.param("reference");
				if (
					!safeParse(ClassCheckoutRecoveryReferenceInputSchema, {
						recoveryReference,
					}).success
				) {
					throw new AppError("Checkout reference is invalid.", 400);
				}
				const submissionKey = c.req.header("Idempotency-Key");
				if (
					submissionKey !== undefined &&
					!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
						submissionKey,
					)
				) {
					throw new AppError("Checkout submission key is invalid.", 400);
				}
				const { checkoutUrl, submissionMatched } = await checkouts.resume({
					organizationId,
					customerId,
					recoveryReference,
					...(submissionKey !== undefined ? { submissionKey } : {}),
					getBuyerAccessToken: async () => {
						const access = await accounts.checkoutAccess(
							slug,
							session,
							c.req.header("X-CSRF-Token"),
							resolveRequestOrigin(c),
						);
						if (
							access.organizationId !== organizationId ||
							access.customerId !== customerId
						) {
							throw new AppError(
								"Customer session changed. Sign in again.",
								401,
							);
						}
						return access.shopifyCustomerAccessToken;
					},
				});
				return c.json({
					checkoutUrl,
					...(submissionKey !== undefined &&
					typeof submissionMatched === "boolean"
						? { submissionMatched }
						: {}),
				});
			} catch (error) {
				return toJsonError(c, error);
			}
		});
}
