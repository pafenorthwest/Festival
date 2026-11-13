import {
	DropRegistrationBodySchema,
	EvaluateRegistrationEligibilityInputSchema,
	type ProposedPurchaseLineItem,
	RegistrationEligibleClassesQuerySchema,
	RegistrationSearchQuerySchema,
	RegistrationTeachersQuerySchema,
	TransferRegistrationBodySchema,
	UpdateRegistrationMetadataInputSchema,
} from "@festival/common";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { toJsonError } from "../../auth/tenant-context.js";
import type { ClassCheckoutService } from "../../checkout/class-checkout-service.js";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../../customer/customer-account-service.js";
import { AppError } from "../../errors/app-error.js";
import type { DropTransferService } from "../../registration/drop-transfer-service.js";
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
import {
	assertValidRepertoirePieces,
	type BrowserClassCheckoutDto,
	buildCustomerClassCheckoutRoutes,
	CUSTOMER_CLASS_CHECKOUT_ROUTE_SECURITY,
	type CustomerEnv,
	handleClassCheckout,
	handleClassCheckoutStatus,
	readValidJsonOrBody,
	requireCustomerAccountService,
	requireSlug,
	withCustomerAccount,
} from "./customer-class-checkout.routes.js";

const REG_BASE = "/festivals/:festivalShortName/registration";
const REG_ITEM = "/class-registrations/:registrationId";

const customerRegRoute = (
	method: "GET" | "POST" | "PATCH",
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

const CUSTOMER_REGISTRATION_CORE_SECURITY = [
	customerRegRoute("GET", `${REG_BASE}/concerto-catalog`, false),
	customerRegRoute("GET", `${REG_BASE}/teachers`, false),
	customerRegRoute("GET", `${REG_BASE}/eligible-classes`, false),
	customerRegRoute("GET", `${REG_BASE}/accompanists`, false),
	customerRegRoute("POST", `${REG_BASE}/eligibility`, true),
	customerRegRoute("GET", "/class-registrations", false),
	customerRegRoute("GET", `${REG_BASE}/class-registrations`, false),
	customerRegRoute("PATCH", `${REG_ITEM}/metadata`, true),
	customerRegRoute("PATCH", `${REG_BASE}${REG_ITEM}/metadata`, true),
	customerRegRoute("POST", `${REG_ITEM}/drop`, true),
	customerRegRoute("POST", `${REG_ITEM}/transfer`, true),
] as const satisfies readonly CoLocatedRouteSecurity[];

export const CUSTOMER_REGISTRATION_ROUTE_SECURITY = [
	...CUSTOMER_REGISTRATION_CORE_SECURITY.slice(0, 4),
	...CUSTOMER_CLASS_CHECKOUT_ROUTE_SECURITY,
	...CUSTOMER_REGISTRATION_CORE_SECURITY.slice(4),
] as const satisfies readonly CoLocatedRouteSecurity[];

export {
	type BrowserClassCheckoutDto,
	buildCustomerClassCheckoutRoutes,
	CUSTOMER_CLASS_CHECKOUT_ROUTE_SECURITY,
	handleClassCheckout,
	handleClassCheckoutStatus,
};

export interface CustomerRegistrationRoutesOptions {
	customerAccountService?: CustomerAccountService;
	classCheckoutService?: ClassCheckoutService;
	dropTransferService?: DropTransferService;
}

function requireDropTransferService(
	service: DropTransferService | undefined,
): DropTransferService {
	if (!service) {
		throw new AppError("Feature 'drop_and_transfer' is not enabled.", 404);
	}
	return service;
}

function withRegAccount<T>(
	c: Context<CustomerEnv>,
	cas: CustomerAccountService | undefined,
	fn: (
		s: CustomerAccountService,
		req: { slug: string; fest?: string; cookie?: string },
	) => Promise<T>,
) {
	return withCustomerAccount(c, cas, (s) =>
		fn(s, {
			slug: requireSlug(c),
			fest: c.req.param("festivalShortName"),
			cookie: getCookie(c, CUSTOMER_SESSION_COOKIE),
		}),
	);
}

function preCheckMetadataPieces(raw: unknown): void {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
	assertValidRepertoirePieces((raw as { pieces?: unknown }).pieces);
}

function handleUpdateRegistrationMetadata(
	c: Context<CustomerEnv>,
	cas: CustomerAccountService | undefined,
	body: unknown,
) {
	return withRegAccount(c, cas, (s, { slug, fest, cookie }) =>
		s.updateRegistrationMetadata(
			slug,
			fest,
			c.req.param("registrationId") ?? "",
			cookie,
			c.req.header("X-CSRF-Token"),
			resolveRequestOrigin(c),
			body,
		),
	);
}

interface DropTransferContext {
	dropService: DropTransferService;
	registrationId: string;
	session: { organizationId: string; customerId: string };
	entitlement: NonNullable<
		Awaited<ReturnType<DropTransferService["getEntitlement"]>>
	>;
}
const dropTransferCache = new WeakMap<Request, DropTransferContext>();

async function resolveDropTransferContext(
	c: Context<CustomerEnv>,
	cas?: CustomerAccountService,
	dts?: DropTransferService,
): Promise<DropTransferContext> {
	const cached = dropTransferCache.get(c.req.raw);
	if (cached) return cached;
	assertNoBearerPrincipal(c.req.header("Authorization"));
	const accountService = requireCustomerAccountService(cas);
	const dropService = requireDropTransferService(dts);
	const registrationId = c.req.param("registrationId") ?? "";
	const session = await accountService.validateSession(
		requireSlug(c),
		getCookie(c, CUSTOMER_SESSION_COOKIE) ?? "",
	);
	const entitlement = await dropService.getEntitlement(
		registrationId,
		session.organizationId,
	);
	if (!entitlement || entitlement.parentCustomerId !== session.customerId) {
		throw new AppError("Registration not found.", 404);
	}
	const context = { dropService, registrationId, session, entitlement };
	dropTransferCache.set(c.req.raw, context);
	return context;
}

async function runDropTransfer(
	c: Context<CustomerEnv>,
	options: CustomerRegistrationRoutesOptions,
	fn: (
		ctx: DropTransferContext,
		body: Record<string, unknown>,
	) => Promise<unknown>,
) {
	try {
		const ctx = await resolveDropTransferContext(
			c,
			options.customerAccountService,
			options.dropTransferService,
		);
		const body = await readValidJsonOrBody<Record<string, unknown>>(
			c,
			"Invalid JSON payload.",
		);
		return c.json(await fn(ctx, body));
	} catch (error) {
		return toJsonError(c, error);
	}
}

function handleDropRegistration(
	c: Context<CustomerEnv>,
	options: CustomerRegistrationRoutesOptions,
) {
	return runDropTransfer(c, options, (ctx, body) => {
		const requestRefund =
			body.requestRefund === true || body.issueRefund === true;
		return ctx.dropService.dropRegistration({
			classEntitlementId: ctx.registrationId,
			organizationId: ctx.session.organizationId,
			festivalId: ctx.entitlement.festivalId,
			actorUid: ctx.session.customerId,
			actorRole: "customer",
			reason: typeof body.reason === "string" ? body.reason : null,
			requestRefund,
			issueRefund: requestRefund,
		});
	});
}

function resolveTransferTargetClassId(body: Record<string, unknown>): string {
	const raw =
		body.targetFestivalClassId ??
		body.targetClassId ??
		body.destinationFestivalClassId;
	const trimmed = typeof raw === "string" ? raw.trim() : "";
	if (!trimmed)
		throw new AppError("Target festival class ID is required.", 400);
	return trimmed;
}

function handleTransferRegistration(
	c: Context<CustomerEnv>,
	options: CustomerRegistrationRoutesOptions,
) {
	return runDropTransfer(c, options, (ctx, body) =>
		ctx.dropService.transferRegistration({
			classEntitlementId: ctx.registrationId,
			targetFestivalClassId: resolveTransferTargetClassId(body),
			organizationId: ctx.session.organizationId,
			festivalId: ctx.entitlement.festivalId,
			sourceFestivalClassId: ctx.entitlement.festivalClassId,
			actorUid: ctx.session.customerId,
			actorRole: "customer",
			reason: typeof body.reason === "string" ? body.reason : null,
		}),
	);
}

interface EligibilityContext {
	checkoutService: ClassCheckoutService;
	session: { organizationId: string; customerId: string };
}
const eligibilityContextCache = new WeakMap<Request, EligibilityContext>();

async function resolveEligibilityContext(
	c: Context<CustomerEnv>,
	accountService?: CustomerAccountService,
	checkoutService?: ClassCheckoutService,
): Promise<EligibilityContext> {
	const cached = eligibilityContextCache.get(c.req.raw);
	if (cached) return cached;
	assertNoBearerPrincipal(c.req.header("Authorization"));
	if (!accountService || !checkoutService) {
		throw new AppError("Class checkout is unavailable.", 503);
	}
	const session = await accountService.customerSession(
		requireSlug(c),
		getCookie(c, CUSTOMER_SESSION_COOKIE),
		c.req.header("X-CSRF-Token"),
		resolveRequestOrigin(c),
	);
	const ctx = { checkoutService, session };
	eligibilityContextCache.set(c.req.raw, ctx);
	return ctx;
}

function parseEligibilityPayload(raw: unknown): {
	items: ProposedPurchaseLineItem[];
} {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new AppError("Eligibility request is invalid.", 400);
	}
	const { items } = raw as { items?: unknown };
	const isNonEmptyStr = (v: unknown) =>
		typeof v === "string" && v.trim() !== "";
	const invalid =
		!Array.isArray(items) ||
		items.length === 0 ||
		items.some(
			(i) =>
				!i ||
				typeof i !== "object" ||
				Array.isArray(i) ||
				!isNonEmptyStr((i as { childId?: unknown }).childId) ||
				!isNonEmptyStr((i as { festivalClassId?: unknown }).festivalClassId),
		);
	if (invalid) throw new AppError("Eligibility request is invalid.", 400);
	return { items: items as ProposedPurchaseLineItem[] };
}

export async function handleEvaluateEligibility(
	c: Context<CustomerEnv>,
	accountService?: CustomerAccountService,
	checkoutService?: ClassCheckoutService,
) {
	try {
		const { checkoutService: service, session } =
			await resolveEligibilityContext(c, accountService, checkoutService);
		const { items } = parseEligibilityPayload(
			await readValidJsonOrBody(c, "Eligibility request is invalid."),
		);
		const result = await service.evaluateEligibility({
			organizationId: session.organizationId,
			customerId: session.customerId,
			festivalShortName: c.req.param("festivalShortName"),
			items,
			mode: "advisory",
		});
		return c.json({ results: result.results });
	} catch (error) {
		return toJsonError(c, error);
	}
}

function makeReadGuard(cas: CustomerAccountService | undefined) {
	return preValidationGuard((c) => {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		requireCustomerAccountService(cas);
		requireSlug(c);
	});
}

function buildRegistrationSearchRoutes(
	cas: CustomerAccountService | undefined,
) {
	const guardAccount = makeReadGuard(cas);
	return new Hono<CustomerEnv>()
		.get(
			`${REG_BASE}/teachers`,
			guardAccount,
			queryValidator(RegistrationTeachersQuerySchema),
			(c) => {
				const q = c.req.valid("query");
				return withRegAccount(c, cas, (s, { slug, fest, cookie }) =>
					s.listRegistrationTeachers(
						slug,
						fest ?? "",
						cookie,
						q.childId ?? "",
						q.divisionId ?? "",
					),
				);
			},
		)
		.get(
			`${REG_BASE}/eligible-classes`,
			guardAccount,
			queryValidator(RegistrationEligibleClassesQuerySchema),
			(c) => {
				const q = c.req.valid("query");
				return withRegAccount(c, cas, (s, { slug, fest, cookie }) =>
					s.listRegistrationEligibleClasses(
						slug,
						fest ?? "",
						cookie,
						q.childId ?? "",
						q.divisionId ?? "",
						q.teacherId ?? "",
					),
				);
			},
		);
}

function buildRegistrationListRoutes(cas: CustomerAccountService | undefined) {
	const listRegs = (c: Context<CustomerEnv>) =>
		withRegAccount(c, cas, (s, { slug, fest, cookie }) =>
			s.listClassRegistrations(slug, cookie ?? "", fest),
		);
	return new Hono<CustomerEnv>()
		.get(
			`${REG_BASE}/concerto-catalog`,
			makeReadGuard(cas),
			queryValidator(RegistrationSearchQuerySchema),
			(c) =>
				withRegAccount(c, cas, (s, { slug, fest, cookie }) =>
					s.searchRegistrationConcertoCatalog(
						slug,
						fest ?? "",
						cookie,
						c.req.valid("query").q ?? "",
					),
				),
		)
		.get(`${REG_BASE}/accompanists`, (c) =>
			withRegAccount(c, cas, (s, { slug, fest, cookie }) =>
				s.listRegistrationAccompanists(slug, fest ?? "", cookie),
			),
		)
		.get("/class-registrations", listRegs)
		.get(`${REG_BASE}/class-registrations`, listRegs);
}

function buildMetadataRoutes(cas: CustomerAccountService | undefined) {
	const guardMetadata = preValidationGuard(async (c) => {
		assertNoBearerPrincipal(c.req.header("Authorization"));
		await requireCustomerAccountService(cas).checkoutAccess(
			requireSlug(c),
			getCookie(c, CUSTOMER_SESSION_COOKIE),
			c.req.header("X-CSRF-Token"),
			resolveRequestOrigin(c),
		);
	});
	const metadataValidator = jsonValidator(
		UpdateRegistrationMetadataInputSchema,
		{
			invalidJsonMessage: "Invalid request body.",
			preCheck: preCheckMetadataPieces,
		},
	);
	return new Hono<CustomerEnv>()
		.patch(`${REG_ITEM}/metadata`, guardMetadata, metadataValidator, (c) =>
			handleUpdateRegistrationMetadata(c, cas, c.req.valid("json")),
		)
		.patch(
			`${REG_BASE}${REG_ITEM}/metadata`,
			guardMetadata,
			metadataValidator,
			(c) => handleUpdateRegistrationMetadata(c, cas, c.req.valid("json")),
		);
}

function buildDropTransferRoutes(options: CustomerRegistrationRoutesOptions) {
	const { customerAccountService: cas, dropTransferService: dts } = options;
	const guardDropTransfer = preValidationGuard<CustomerEnv>(async (c) => {
		await resolveDropTransferContext(c, cas, dts);
	});
	return new Hono<CustomerEnv>()
		.post(
			`${REG_ITEM}/drop`,
			guardDropTransfer,
			jsonValidator(DropRegistrationBodySchema, { allowEmptyJsonObject: true }),
			(c) => handleDropRegistration(c, options),
		)
		.post(
			`${REG_ITEM}/transfer`,
			guardDropTransfer,
			jsonValidator(TransferRegistrationBodySchema, {
				invalidJsonMessage: "Transfer request is invalid.",
			}),
			(c) => handleTransferRegistration(c, options),
		);
}

export function buildCustomerRegistrationRoutes(
	options: CustomerRegistrationRoutesOptions,
) {
	const { customerAccountService: cas, classCheckoutService: ccs } = options;
	return new Hono<CustomerEnv>()
		.route("/", buildRegistrationSearchRoutes(cas))
		.route("/", buildRegistrationListRoutes(cas))
		.route("/", buildCustomerClassCheckoutRoutes(options))
		.post(
			`${REG_BASE}/eligibility`,
			preValidationGuard<CustomerEnv>(async (c) => {
				await resolveEligibilityContext(c, cas, ccs);
			}),
			jsonValidator(EvaluateRegistrationEligibilityInputSchema, {
				invalidJsonMessage: "Eligibility request is invalid.",
				preCheck: parseEligibilityPayload,
			}),
			(c) => handleEvaluateEligibility(c, cas, ccs),
		)
		.route("/", buildMetadataRoutes(cas))
		.route("/", buildDropTransferRoutes(options));
}
