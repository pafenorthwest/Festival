import {
	DropRegistrationBodySchema,
	PromoteWaitlistBodySchema,
	TransferRegistrationBodySchema,
} from "@festival/common";
import { type Context, Hono } from "hono";
import {
	type ApiVariables,
	getRequiredIdentity,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../../auth/tenant-context.js";
import type { AuthVerifier } from "../../auth/types.js";
import { AppError } from "../../errors/app-error.js";
import type { DropTransferService } from "../../registration/drop-transfer-service.js";
import type { RegistrationChangeRepository } from "../../registration/registration-change-repository.js";
import type { OrganizationRepository } from "../../repo/organization-repository.js";
import type { OrganizationService } from "../../services/organization-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
} from "../shared/schema-validator.js";
import {
	ADMIN_REGISTRATION_CATALOG_ROUTE_SECURITY,
	buildAdminRegistrationCatalogRoutes,
} from "./admin-registration-catalog.routes.js";

type AdminEnv = { Variables: Partial<ApiVariables> };

export interface AdminRegistrationRoutesOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
	dropTransferService?: DropTransferService;
	registrationChangeRepository?: RegistrationChangeRepository;
}

const REG_BASE =
	"/organizations/:slug/festivals/:festivalShortName/registrations";

const adminActionRoute = (
	method: "GET" | "POST",
	suffix: string,
): CoLocatedRouteSecurity =>
	defineRouteSecurity({
		method,
		path: `${REG_BASE}${suffix}`,
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	});

export const ADMIN_REGISTRATION_ACTIONS_ROUTE_SECURITY = [
	adminActionRoute("POST", "/:id/drop"),
	adminActionRoute("POST", "/:id/transfer"),
	adminActionRoute("POST", "/:id/promote"),
	adminActionRoute("GET", "/:id/change-log"),
] as const satisfies readonly CoLocatedRouteSecurity[];

export const ADMIN_REGISTRATION_ROUTE_SECURITY = [
	...ADMIN_REGISTRATION_CATALOG_ROUTE_SECURITY,
	...ADMIN_REGISTRATION_ACTIONS_ROUTE_SECURITY,
] as const satisfies readonly CoLocatedRouteSecurity[];

export {
	ADMIN_REGISTRATION_CATALOG_ROUTE_SECURITY,
	buildAdminRegistrationCatalogRoutes,
};

function requireDropTransferService(
	service: DropTransferService | undefined,
): DropTransferService {
	if (!service) {
		throw new AppError("Feature 'drop_and_transfer' is not enabled.", 404);
	}
	return service;
}

function requireChangeRepository(
	repo: RegistrationChangeRepository | undefined,
): RegistrationChangeRepository {
	if (!repo) {
		throw new AppError("Feature 'drop_and_transfer' is not enabled.", 404);
	}
	return repo;
}

async function resolveFestivalForRegistration(
	c: Context<AdminEnv>,
	repository: OrganizationRepository,
) {
	const tenant = getRequiredTenant(c);
	const festivalShortName = c.req.param("festivalShortName");
	const id = c.req.param("id");
	if (!festivalShortName || !id) {
		throw new AppError(
			"Festival short name and registration ID are required.",
			400,
		);
	}
	const festival = await repository.findFestivalByShortName(
		tenant.organization.id,
		festivalShortName,
	);
	if (!festival) {
		throw new AppError("Festival not found.", 404);
	}
	return { tenant, festival, id };
}

type ResolvedAdminAction = {
	tenant: ReturnType<typeof getRequiredTenant>;
	festival: NonNullable<
		Awaited<ReturnType<OrganizationRepository["findFestivalByShortName"]>>
	>;
	id: string;
	service: DropTransferService;
	entitlement: Awaited<ReturnType<DropTransferService["getEntitlement"]>>;
};

const RESOLVED_ADMIN_ACTION = new WeakMap<Request, ResolvedAdminAction>();

async function resolveScopedEntitlement(input: {
	service: DropTransferService;
	id: string;
	organizationId: string;
	festivalId: string;
}) {
	const entitlement = await input.service.getEntitlement(
		input.id,
		input.organizationId,
	);
	if (
		!entitlement ||
		(entitlement.festivalId && entitlement.festivalId !== input.festivalId)
	) {
		throw new AppError("Registration not found.", 404);
	}
	return entitlement;
}

async function resolveAndCacheAdminAction(
	c: Context<AdminEnv>,
	options: AdminRegistrationRoutesOptions,
): Promise<ResolvedAdminAction> {
	const existing = RESOLVED_ADMIN_ACTION.get(c.req.raw);
	if (existing) return existing;
	const { tenant, festival, id } = await resolveFestivalForRegistration(
		c,
		options.organizationService.repository,
	);
	const service = requireDropTransferService(options.dropTransferService);
	const entitlement = await resolveScopedEntitlement({
		service,
		id,
		organizationId: tenant.organization.id,
		festivalId: festival.id,
	});
	const resolved = { tenant, festival, id, service, entitlement };
	RESOLVED_ADMIN_ACTION.set(c.req.raw, resolved);
	return resolved;
}

function extractTargetFestivalClassId(body: {
	targetFestivalClassId?: string;
	targetClassId?: string;
	destinationFestivalClassId?: string;
}): string {
	const target =
		body.targetFestivalClassId?.trim() ||
		body.targetClassId?.trim() ||
		body.destinationFestivalClassId?.trim() ||
		"";
	if (!target) {
		throw new AppError("Target festival class ID is required.", 400);
	}
	return target;
}

async function handleAdminDropRegistration(
	c: Context<AdminEnv>,
	options: AdminRegistrationRoutesOptions,
	body: {
		requestRefund?: boolean;
		issueRefund?: boolean;
		refund?: boolean;
		refundAmountCents?: number;
		amountCents?: number;
		reason?: string | null;
		refundReason?: string | null;
	},
) {
	try {
		const { tenant, festival, id, service } = await resolveAndCacheAdminAction(
			c,
			options,
		);
		const actor = getRequiredIdentity(c);
		const requestRefund =
			body.requestRefund === true ||
			body.issueRefund === true ||
			body.refund === true;
		const refundAmountCents = body.refundAmountCents ?? body.amountCents;
		return c.json(
			await service.dropRegistration({
				classEntitlementId: id,
				organizationId: tenant.organization.id,
				festivalId: festival.id,
				actorUid: actor.uid,
				actorRole: "admin",
				reason: typeof body.reason === "string" ? body.reason : null,
				requestRefund,
				issueRefund: requestRefund,
				refundAmountCents,
				refundReason:
					typeof body.refundReason === "string" ? body.refundReason : undefined,
			}),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleAdminTransferRegistration(
	c: Context<AdminEnv>,
	options: AdminRegistrationRoutesOptions,
	body: {
		targetFestivalClassId?: string;
		targetClassId?: string;
		destinationFestivalClassId?: string;
		reason?: string | null;
	},
) {
	try {
		const { tenant, festival, id, service, entitlement } =
			await resolveAndCacheAdminAction(c, options);
		const actor = getRequiredIdentity(c);
		const targetFestivalClassId = extractTargetFestivalClassId(body);
		return c.json(
			await service.transferRegistration({
				classEntitlementId: id,
				targetFestivalClassId,
				organizationId: tenant.organization.id,
				festivalId: festival.id,
				sourceFestivalClassId: entitlement?.festivalClassId ?? "",
				actorUid: actor.uid,
				actorRole: "admin",
				reason: typeof body.reason === "string" ? body.reason : null,
			}),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleAdminPromoteRegistration(
	c: Context<AdminEnv>,
	options: AdminRegistrationRoutesOptions,
	body: { reason?: string | null },
) {
	try {
		const { tenant, festival, id, service } = await resolveAndCacheAdminAction(
			c,
			options,
		);
		const actor = getRequiredIdentity(c);
		return c.json(
			await service.promoteRegistration({
				classEntitlementId: id,
				organizationId: tenant.organization.id,
				festivalId: festival.id,
				actorUid: actor.uid,
				actorRole: "admin",
				reason: typeof body.reason === "string" ? body.reason : null,
			}),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleAdminGetChangeLog(
	c: Context<AdminEnv>,
	options: AdminRegistrationRoutesOptions,
) {
	try {
		const { tenant, festival, id } = await resolveFestivalForRegistration(
			c,
			options.organizationService.repository,
		);
		if (options.dropTransferService) {
			await resolveScopedEntitlement({
				service: options.dropTransferService,
				id,
				organizationId: tenant.organization.id,
				festivalId: festival.id,
			});
		}
		const repo = requireChangeRepository(
			options.registrationChangeRepository ??
				options.dropTransferService?.changeRepository,
		);
		const changeLogs = await repo.listChangeLogsForEntitlement(
			tenant.organization.id,
			id,
		);
		return c.json({ changeLogs });
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildAdminRegistrationActionsRoutes(
	options: AdminRegistrationRoutesOptions,
) {
	const auth = requireAuth(options.authVerifier);
	const tenant = requireTenant(options.organizationService.repository);
	const admin = requireTenantRole(["Admin"]);
	const guardAction = preValidationGuard<AdminEnv>(async (c) => {
		await resolveAndCacheAdminAction(c, options);
	});

	return new Hono<AdminEnv>()
		.post(
			`${REG_BASE}/:id/drop`,
			auth,
			tenant,
			admin,
			guardAction,
			jsonValidator(DropRegistrationBodySchema, { allowEmptyJsonObject: true }),
			(c) => handleAdminDropRegistration(c, options, c.req.valid("json")),
		)
		.post(
			`${REG_BASE}/:id/transfer`,
			auth,
			tenant,
			admin,
			guardAction,
			jsonValidator(TransferRegistrationBodySchema, {
				invalidJsonMessage: "Transfer request is invalid.",
				fallbackErrorMessage: "Transfer request is invalid.",
			}),
			(c) => handleAdminTransferRegistration(c, options, c.req.valid("json")),
		)
		.post(
			`${REG_BASE}/:id/promote`,
			auth,
			tenant,
			admin,
			guardAction,
			jsonValidator(PromoteWaitlistBodySchema, { allowEmptyJsonObject: true }),
			(c) => handleAdminPromoteRegistration(c, options, c.req.valid("json")),
		)
		.get(`${REG_BASE}/:id/change-log`, auth, tenant, admin, (c) =>
			handleAdminGetChangeLog(c, options),
		);
}

export function buildAdminRegistrationRoutes(
	options: AdminRegistrationRoutesOptions,
) {
	return new Hono<AdminEnv>()
		.route("/", buildAdminRegistrationCatalogRoutes(options))
		.route("/", buildAdminRegistrationActionsRoutes(options));
}
