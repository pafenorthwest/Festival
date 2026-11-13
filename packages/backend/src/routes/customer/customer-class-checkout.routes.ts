import {
	type ClassCheckoutLineItemInput,
	ClassCheckoutRecoveryReferenceInputSchema,
	type ClassCheckoutRecoveryStatusDto,
	type ClassCheckoutRestartDto,
	type RepertoirePiece,
	StartClassCheckoutInputSchema,
	stripCandidateMarker,
} from "@festival/common";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import {
	ClassCheckoutRecoveryRequiredError,
	type ClassCheckoutService,
} from "../../checkout/class-checkout-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import { assertNoBearerPrincipal } from "../customer-auth/customer-auth.routes.js";
import { resolveRequestOrigin } from "../shared/csrf-guard.js";
import { assertAllowedFields } from "../shared/payload-guard.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
} from "../shared/schema-validator.js";

export type CustomerEnv = { Variables: Partial<ApiVariables> };

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_CHECKOUT_FIELDS =
	"childId,festivalClassId,teacherId,divisionId,accompanistId,accompanistOption,pieces,instrument,instrumentId,festivalId,festivalShortName,organizationSlug,lineItems".split(
		",",
	);

const REG_BASE = "/festivals/:festivalShortName/registration";
const REG_CHECKOUT = `${REG_BASE}/checkout`;

export const CUSTOMER_CLASS_CHECKOUT_ROUTE_SECURITY = (
	[
		["POST", "/class-checkout", true],
		["POST", REG_CHECKOUT, true],
		["POST", `${REG_CHECKOUT}/status`, true],
		["GET", `${REG_CHECKOUT}/restart`, false],
		["POST", `${REG_CHECKOUT}/restart`, true],
	] as const
).map(([method, path, csrfRequired]) =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "customer",
		csrfRequired,
		browserAllowed: true,
	}),
) satisfies readonly CoLocatedRouteSecurity[];

export interface BrowserClassCheckoutDto {
	checkoutUrl: string;
	correlationId: string;
}

export interface CustomerClassCheckoutRoutesOptions {
	customerAccountService?: CustomerAccountService;
	classCheckoutService?: ClassCheckoutService;
}

function recoveryDto(
	r: ClassCheckoutRecoveryStatusDto,
): ClassCheckoutRecoveryStatusDto {
	return {
		status: r.status,
		recoveryReference: r.recoveryReference,
		...(r.festivalShortName ? { festivalShortName: r.festivalShortName } : {}),
		reasonCode: r.reasonCode,
		retryAllowed: r.retryAllowed,
		...(r.restartAllowed === true ? { restartAllowed: true } : {}),
		...(r.checkoutUrl ? { checkoutUrl: r.checkoutUrl } : {}),
		...(r.correlationId ? { correlationId: r.correlationId } : {}),
		...(r.recordedAtIso ? { recordedAtIso: r.recordedAtIso } : {}),
	};
}

const pick = <T extends object>(src: T, keys: string) =>
	Object.fromEntries(keys.split(",").map((k) => [k, src[k as keyof T]]));

function restartDto(result: ClassCheckoutRestartDto): ClassCheckoutRestartDto {
	const lineKeys =
		"lineId,childId,childName,divisionId,divisionName,teacherId,teacherName,classId,className,classSubtypeId,classSubtypeName,minimumAge,maximumAge,priceCents,accompanistId,accompanistName,instrumentId,instrumentName";
	const pieceKeys =
		"title,composer,movement,durationSeconds,durationMinutes,catalogWorkId";
	type LineDto = ClassCheckoutRestartDto["registrations"][number];
	type PieceDto = LineDto["pieces"][number];
	return {
		replacementKey: result.replacementKey,
		registrations: result.registrations.map((line) => ({
			...(pick(line, lineKeys) as unknown as LineDto),
			pieces: line.pieces.map((p) => pick(p, pieceKeys) as unknown as PieceDto),
		})),
	};
}

function checkoutError(c: Context<CustomerEnv>, error: unknown) {
	if (error instanceof ClassCheckoutRecoveryRequiredError) {
		c.header("Cache-Control", "no-store");
		return c.json(
			{
				error: error.message,
				code: error.code,
				recovery: recoveryDto(error.recovery),
			},
			409,
		);
	}
	return toJsonError(c, error);
}

export function requireCustomerAccountService(
	service: CustomerAccountService | undefined,
): CustomerAccountService {
	if (!service) throw new AppError("Customer Account is unavailable.", 503);
	return service;
}

export function requireSlug(c: Context): string {
	const slug = c.req.param("slug");
	if (!slug) throw new AppError("Organization slug is required.", 400);
	return slug;
}

export async function withCustomerAccount<T>(
	c: Context<CustomerEnv>,
	service: CustomerAccountService | undefined,
	fn: (s: CustomerAccountService) => Promise<T>,
) {
	try {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		return c.json(await fn(requireCustomerAccountService(service)));
	} catch (error) {
		return toJsonError(c, error);
	}
}

function requireIdempotencyKey(c: Context): string {
	const key = c.req.header("Idempotency-Key");
	if (!key || !UUID_REGEX.test(key)) {
		throw new AppError("Checkout request is invalid.", 400);
	}
	return key;
}

function parseCheckoutPayload(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new AppError("Checkout request is invalid.", 400);
	}
	return raw as Record<string, unknown>;
}

export async function readValidJsonOrBody<T>(
	c: Context,
	invalidMessage = "Checkout request is invalid.",
): Promise<T> {
	const valid = (c.req as { valid: (t: "json") => T | undefined }).valid(
		"json",
	);
	if (valid !== undefined) return valid;
	try {
		return (await c.req.json()) as T;
	} catch {
		throw new AppError(invalidMessage, 400);
	}
}

interface CheckoutAccessInput {
	organizationId: string;
	customerId: string;
	sessionId?: string;
	integrationVersion?: number;
	shopifyCustomerAccessToken?: string;
}
interface FormAccessContext {
	ccs: ClassCheckoutService;
	sessionCookie: string | undefined;
	access: Awaited<ReturnType<CustomerAccountService["formAccess"]>>;
	idempotencyKey: string;
	getCheckoutAccess: () => ReturnType<CustomerAccountService["checkoutAccess"]>;
}

const formAccessCache = new WeakMap<Request, FormAccessContext>();

function pickDefined(src: Record<string, unknown>, keys: readonly string[]) {
	return Object.fromEntries(
		keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]),
	);
}

function buildCheckoutInput(options: {
	access: CheckoutAccessInput;
	payload: Record<string, unknown>;
	idempotencyKey: string;
	festivalShortName?: string;
}) {
	const { access, payload, idempotencyKey, festivalShortName } = options;
	const base = {
		organizationId: access.organizationId,
		customerId: access.customerId,
		sessionId: access.sessionId ?? "",
		integrationVersion: access.integrationVersion ?? 0,
		buyerAccessToken: access.shopifyCustomerAccessToken ?? "",
		idempotencyKey,
		...pickDefined(payload, ["festivalId"]),
		...(festivalShortName !== undefined ? { festivalShortName } : {}),
	};
	if (Array.isArray(payload.lineItems)) {
		return {
			...base,
			lineItems: (payload.lineItems as ClassCheckoutLineItemInput[]).map(
				(item) => stripCandidateMarker(item) as ClassCheckoutLineItemInput,
			),
		};
	}
	return {
		...base,
		festivalClassId: payload.festivalClassId as string,
		childId: payload.childId as string,
		teacherId: payload.teacherId as string,
		pieces: payload.pieces as RepertoirePiece[],
		...pickDefined(payload, ["divisionId", "accompanistId", "instrumentId"]),
	};
}

export function assertValidRepertoirePieces(pieces: unknown): void {
	if (!Array.isArray(pieces)) return;
	for (const piece of pieces) {
		if (!piece || typeof piece !== "object" || Array.isArray(piece)) continue;
		const { composer, durationSeconds } = piece as Record<string, unknown>;
		if (typeof composer !== "string" || !composer.trim()) {
			throw new AppError(
				"Each repertoire piece must have a valid composer.",
				400,
			);
		}
		if (
			typeof durationSeconds !== "number" ||
			!Number.isInteger(durationSeconds) ||
			durationSeconds <= 0
		) {
			throw new AppError(
				"Each repertoire piece must have a positive whole-number duration in seconds.",
				400,
			);
		}
	}
}

function preCheckCheckoutPayload(raw: unknown): Record<string, unknown> {
	const payload = parseCheckoutPayload(raw);
	assertAllowedFields(
		payload,
		ALLOWED_CHECKOUT_FIELDS,
		"Class checkout request",
	);
	assertValidRepertoirePieces(payload.pieces);
	if (Array.isArray(payload.lineItems)) {
		for (const item of payload.lineItems) {
			if (item && typeof item === "object" && !Array.isArray(item)) {
				assertValidRepertoirePieces((item as { pieces?: unknown }).pieces);
			}
		}
	}
	return payload;
}

function requireCheckoutServices(
	c: Context<CustomerEnv>,
	cas?: CustomerAccountService,
	ccs?: ClassCheckoutService,
) {
	assertNoBearerPrincipal(c.req.header("Authorization"));
	if (!cas || !ccs) throw new AppError("Class checkout is unavailable.", 503);
	return {
		cas,
		ccs,
		slug: requireSlug(c),
		sessionCookie: getCookie(c, CUSTOMER_SESSION_COOKIE),
	};
}

async function resolveFormAccess(options: {
	c: Context<CustomerEnv>;
	cas?: CustomerAccountService;
	ccs?: ClassCheckoutService;
	requireIdempotency?: boolean;
}): Promise<FormAccessContext> {
	const { c, cas, ccs, requireIdempotency } = options;
	const cached = formAccessCache.get(c.req.raw);
	if (cached) {
		if (requireIdempotency && !cached.idempotencyKey) {
			cached.idempotencyKey = requireIdempotencyKey(c);
		}
		return cached;
	}
	const svc = requireCheckoutServices(c, cas, ccs);
	const csrfToken = c.req.header("X-CSRF-Token");
	const origin = resolveRequestOrigin(c);
	const ctx: FormAccessContext = {
		ccs: svc.ccs,
		sessionCookie: svc.sessionCookie,
		access: await svc.cas.formAccess(
			svc.slug,
			svc.sessionCookie,
			csrfToken,
			origin,
		),
		idempotencyKey: requireIdempotency ? requireIdempotencyKey(c) : "",
		getCheckoutAccess: () =>
			svc.cas.checkoutAccess(svc.slug, svc.sessionCookie, csrfToken, origin),
	};
	formAccessCache.set(c.req.raw, ctx);
	return ctx;
}

export async function handleClassCheckout(
	c: Context<CustomerEnv>,
	cas?: CustomerAccountService,
	ccs?: ClassCheckoutService,
) {
	try {
		const ctx = await resolveFormAccess({
			c,
			cas,
			ccs,
			requireIdempotency: true,
		});
		const payload = preCheckCheckoutPayload(await readValidJsonOrBody(c));
		const festivalShortName =
			c.req.param("festivalShortName") ||
			(typeof payload.festivalShortName === "string"
				? payload.festivalShortName
				: undefined);
		const inputFor = (access: CheckoutAccessInput) =>
			buildCheckoutInput({
				access,
				payload,
				idempotencyKey: ctx.idempotencyKey,
				festivalShortName,
			});
		if (ctx.ccs.preflightRecovery) {
			await ctx.ccs.preflightRecovery(
				inputFor({ ...ctx.access, sessionId: ctx.sessionCookie ?? "" }),
			);
		}
		const result = await ctx.ccs.start(inputFor(await ctx.getCheckoutAccess()));
		c.header("Cache-Control", "no-store");
		return c.json({
			checkoutUrl: result.checkoutUrl,
			correlationId: result.correlationId,
		});
	} catch (error) {
		return checkoutError(c, error);
	}
}

async function handleRecoveryAction(options: {
	c: Context<CustomerEnv>;
	cas?: CustomerAccountService;
	ccs?: ClassCheckoutService;
	mode: "status" | "restart";
}) {
	const { c, cas, ccs, mode } = options;
	const isStatus = mode === "status";
	if (!isStatus) c.header("Cache-Control", "no-store");
	try {
		const {
			ccs: checkout,
			sessionCookie,
			access,
			idempotencyKey,
		} = await resolveFormAccess({ c, cas, ccs, requireIdempotency: isStatus });
		const { recoveryReference } = await readValidJsonOrBody<{
			recoveryReference: string;
		}>(c, `Checkout ${mode} request is invalid.`);
		const base = {
			organizationId: access.organizationId,
			customerId: access.customerId,
			recoveryReference,
		};
		const fest = c.req.param("festivalShortName");
		if (!isStatus) {
			const res = await checkout.restartUnissuedCart({
				...base,
				festivalShortName: fest ?? "",
			});
			return c.json(restartDto(res));
		}
		const res = await checkout.recoveryStatus({
			...base,
			sessionId: sessionCookie ?? "",
			festivalShortName: fest,
			idempotencyKey,
		});
		c.header("Cache-Control", "no-store");
		return c.json(recoveryDto(res));
	} catch (error) {
		return checkoutError(c, error);
	}
}

export const handleClassCheckoutStatus = (
	c: Context<CustomerEnv>,
	cas?: CustomerAccountService,
	ccs?: ClassCheckoutService,
) => handleRecoveryAction({ c, cas, ccs, mode: "status" });

export const handleClassCheckoutRestart = (
	c: Context<CustomerEnv>,
	cas?: CustomerAccountService,
	ccs?: ClassCheckoutService,
) => handleRecoveryAction({ c, cas, ccs, mode: "restart" });

export async function handleFindClassCheckoutRestart(
	c: Context<CustomerEnv>,
	cas?: CustomerAccountService,
	ccs?: ClassCheckoutService,
) {
	c.header("Cache-Control", "no-store");
	try {
		const svc = requireCheckoutServices(c, cas, ccs);
		const { organizationId, customerId } = await svc.cas.customerReadAccess(
			svc.slug,
			svc.sessionCookie,
		);
		const { recoveryReference } = await svc.ccs.findUnissuedCartRestart({
			organizationId,
			customerId,
			festivalShortName: c.req.param("festivalShortName") ?? "",
		});
		return c.json({ recoveryReference });
	} catch (error) {
		return toJsonError(c, error);
	}
}

function makeRecoveryValidator(fieldContext: string) {
	return jsonValidator(ClassCheckoutRecoveryReferenceInputSchema, {
		invalidJsonMessage: `${fieldContext} is invalid.`,
		preCheck: (raw) =>
			assertAllowedFields(
				parseCheckoutPayload(raw),
				["recoveryReference"],
				fieldContext,
			),
	});
}

export function buildCustomerClassCheckoutRoutes(
	options: CustomerClassCheckoutRoutesOptions,
) {
	const { customerAccountService: cas, classCheckoutService: ccs } = options;
	const makeGuard = (requireIdempotency = false, setNoStore = false) =>
		preValidationGuard<CustomerEnv>(async (c) => {
			if (setNoStore) c.header("Cache-Control", "no-store");
			await resolveFormAccess({ c, cas, ccs, requireIdempotency });
		});
	const guardIdempotent = makeGuard(true);
	const guardRestart = makeGuard(false, true);
	const checkoutValidator = jsonValidator(StartClassCheckoutInputSchema, {
		invalidJsonMessage: "Checkout request is invalid.",
		preCheck: preCheckCheckoutPayload,
	});
	const onCheckout = (c: Context<CustomerEnv>) =>
		handleClassCheckout(c, cas, ccs);
	return new Hono<CustomerEnv>()
		.post("/class-checkout", guardIdempotent, checkoutValidator, onCheckout)
		.post(REG_CHECKOUT, guardIdempotent, checkoutValidator, onCheckout)
		.post(
			`${REG_CHECKOUT}/status`,
			guardIdempotent,
			makeRecoveryValidator("Checkout status request"),
			(c) => handleClassCheckoutStatus(c, cas, ccs),
		)
		.get(`${REG_CHECKOUT}/restart`, (c) =>
			handleFindClassCheckoutRestart(c, cas, ccs),
		)
		.post(
			`${REG_CHECKOUT}/restart`,
			guardRestart,
			makeRecoveryValidator("Checkout restart request"),
			(c) => handleClassCheckoutRestart(c, cas, ccs),
		);
}
