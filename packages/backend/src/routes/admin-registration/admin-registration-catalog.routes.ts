import {
	CreateClassSubtypeInputSchema,
	CreateInstrumentInputSchema,
	ReorderCatalogValuesInputSchema,
	UpdateAccompanistPolicyInputSchema,
	UpdateClassSubtypeInputSchema,
	UpdateInstrumentInputSchema,
	UpdateRegistrationAgeDateInputSchema,
} from "@festival/common";
import { type Context, Hono } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../../auth/tenant-context.js";
import type { AuthVerifier } from "../../auth/types.js";
import { AppError } from "../../errors/app-error.js";
import type { OrganizationService } from "../../services/organization-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import { jsonValidator } from "../shared/schema-validator.js";

type AdminEnv = { Variables: Partial<ApiVariables> };

export interface AdminRegistrationCatalogRoutesOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
}

const adminRoute = (
	method: "GET" | "POST",
	path: string,
): CoLocatedRouteSecurity =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	});

export const ADMIN_REGISTRATION_CATALOG_ROUTE_SECURITY = [
	adminRoute("GET", "/organizations/:slug/admin/accompanist-policy"),
	adminRoute("POST", "/organizations/:slug/admin/accompanist-policy"),
	adminRoute("GET", "/organizations/:slug/admin/registration-configuration"),
	adminRoute("POST", "/organizations/:slug/admin/registration-age-date"),
	adminRoute("POST", "/organizations/:slug/admin/class-subtypes"),
	adminRoute("POST", "/organizations/:slug/admin/instruments"),
	adminRoute("POST", "/organizations/:slug/admin/class-subtypes/reorder"),
	adminRoute("POST", "/organizations/:slug/admin/instruments/reorder"),
	adminRoute("POST", "/organizations/:slug/admin/class-subtypes/:id"),
	adminRoute("POST", "/organizations/:slug/admin/instruments/:id"),
] as const satisfies readonly CoLocatedRouteSecurity[];

function assertAllowedFields(
	payload: unknown,
	allowed: readonly string[],
	label: string,
): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
	const allowedFields = new Set(allowed);
	const extraFields = Object.keys(payload).filter(
		(field) => !allowedFields.has(field),
	);
	if (extraFields.length > 0) {
		throw new AppError(
			`${label} cannot include browser-controlled fields: ${extraFields.join(", ")}.`,
			400,
		);
	}
}

async function handleGetAccompanistPolicy(
	c: Context<AdminEnv>,
	organizationService: OrganizationService,
) {
	try {
		const tenant = getRequiredTenant(c);
		return c.json({
			policy: await organizationService.getAccompanistDivisionPolicy(
				tenant.organization.id,
			),
		});
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleUpdateAccompanistPolicy(
	c: Context<AdminEnv>,
	organizationService: OrganizationService,
	payload: { policy: "exactly_one" | "one_to_two" | "one_to_all" },
) {
	try {
		const tenant = getRequiredTenant(c);
		return c.json({
			policy: await organizationService.updateAccompanistDivisionPolicy({
				organizationId: tenant.organization.id,
				policy: payload.policy,
			}),
		});
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleGetRegistrationConfiguration(
	c: Context<AdminEnv>,
	organizationService: OrganizationService,
) {
	try {
		return c.json(
			await organizationService.getRegistrationConfigurationForTenant(
				getRequiredTenant(c),
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleUpdateRegistrationAgeDate(
	c: Context<AdminEnv>,
	organizationService: OrganizationService,
	payload: { registrationAgeDate: string },
) {
	try {
		return c.json(
			await organizationService.updateRegistrationAgeDateForTenant(
				getRequiredTenant(c),
				payload.registrationAgeDate,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleCreateCatalogValue(
	c: Context<AdminEnv>,
	organizationService: OrganizationService,
	options: {
		kind: "class_subtype" | "instrument";
		payload: { displayName: string; requiredSubtypeId?: string | null };
	},
) {
	try {
		const created =
			await organizationService.createRegistrationCatalogValueForTenant(
				getRequiredTenant(c),
				options.kind,
				options.payload.displayName,
				options.payload.requiredSubtypeId,
			);
		return c.json(created, 201);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleReorderCatalogValues(
	c: Context<AdminEnv>,
	organizationService: OrganizationService,
	options: { kind: "class_subtype" | "instrument"; ids: string[] },
) {
	try {
		return c.json(
			await organizationService.reorderRegistrationCatalogValuesForTenant(
				getRequiredTenant(c),
				options.kind,
				options.ids,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleUpdateCatalogValue(
	c: Context<AdminEnv>,
	organizationService: OrganizationService,
	options: {
		kind: "class_subtype" | "instrument";
		payload: {
			displayName?: string;
			isActive?: boolean;
			requiredSubtypeId?: string | null;
		};
	},
) {
	try {
		const id = c.req.param("id");
		if (!id) {
			throw new AppError("Catalog value ID is required.", 400);
		}
		return c.json(
			await organizationService.updateRegistrationCatalogValueForTenant(
				getRequiredTenant(c),
				options.kind,
				id,
				options.payload,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

function allowedFieldsCheck(fields: readonly string[], label: string) {
	return {
		preCheck: (raw: unknown) => {
			assertAllowedFields(raw, fields, label);
			if (
				fields.includes("requiredSubtypeId") &&
				typeof raw === "object" &&
				raw !== null &&
				"requiredSubtypeId" in raw &&
				raw.requiredSubtypeId !== undefined &&
				raw.requiredSubtypeId !== null &&
				typeof raw.requiredSubtypeId !== "string"
			) {
				throw new AppError(
					"Required class subtype must be a string or null.",
					400,
				);
			}
		},
	};
}

function buildCatalogPolicyRoutes(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
) {
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<AdminEnv>()
		.get(
			"/organizations/:slug/admin/accompanist-policy",
			auth,
			tenant,
			admin,
			(c) => handleGetAccompanistPolicy(c, organizationService),
		)
		.post(
			"/organizations/:slug/admin/accompanist-policy",
			auth,
			tenant,
			admin,
			jsonValidator(UpdateAccompanistPolicyInputSchema, {
				fallbackErrorMessage: "Accompanist division policy is invalid.",
				...allowedFieldsCheck(["policy"], "Accompanist policy request"),
			}),
			(c) =>
				handleUpdateAccompanistPolicy(
					c,
					organizationService,
					c.req.valid("json"),
				),
		)
		.get(
			"/organizations/:slug/admin/registration-configuration",
			auth,
			tenant,
			admin,
			(c) => handleGetRegistrationConfiguration(c, organizationService),
		)
		.post(
			"/organizations/:slug/admin/registration-age-date",
			auth,
			tenant,
			admin,
			jsonValidator(
				UpdateRegistrationAgeDateInputSchema,
				allowedFieldsCheck(
					["registrationAgeDate"],
					"Registration age configuration",
				),
			),
			(c) =>
				handleUpdateRegistrationAgeDate(
					c,
					organizationService,
					c.req.valid("json"),
				),
		);
}

function buildCatalogCreateRoutes(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
) {
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<AdminEnv>()
		.post(
			"/organizations/:slug/admin/class-subtypes",
			auth,
			tenant,
			admin,
			jsonValidator(
				CreateClassSubtypeInputSchema,
				allowedFieldsCheck(
					["displayName", "requiredSubtypeId"],
					"Registration catalog request",
				),
			),
			(c) =>
				handleCreateCatalogValue(c, organizationService, {
					kind: "class_subtype",
					payload: c.req.valid("json"),
				}),
		)
		.post(
			"/organizations/:slug/admin/instruments",
			auth,
			tenant,
			admin,
			jsonValidator(
				CreateInstrumentInputSchema,
				allowedFieldsCheck(["displayName"], "Registration catalog request"),
			),
			(c) =>
				handleCreateCatalogValue(c, organizationService, {
					kind: "instrument",
					payload: c.req.valid("json"),
				}),
		);
}

function buildCatalogReorderRoutes(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
) {
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);
	const reorderOpts = allowedFieldsCheck(
		["ids"],
		"Registration catalog reorder request",
	);

	return buildCatalogCreateRoutes(organizationService, authVerifier)
		.post(
			"/organizations/:slug/admin/class-subtypes/reorder",
			auth,
			tenant,
			admin,
			jsonValidator(ReorderCatalogValuesInputSchema, reorderOpts),
			(c) =>
				handleReorderCatalogValues(c, organizationService, {
					kind: "class_subtype",
					ids: c.req.valid("json").ids,
				}),
		)
		.post(
			"/organizations/:slug/admin/instruments/reorder",
			auth,
			tenant,
			admin,
			jsonValidator(ReorderCatalogValuesInputSchema, reorderOpts),
			(c) =>
				handleReorderCatalogValues(c, organizationService, {
					kind: "instrument",
					ids: c.req.valid("json").ids,
				}),
		);
}

function buildCatalogValuesRoutes(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
) {
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(organizationService.repository);
	const admin = requireTenantRole(["Admin"]);

	return buildCatalogReorderRoutes(organizationService, authVerifier)
		.post(
			"/organizations/:slug/admin/class-subtypes/:id",
			auth,
			tenant,
			admin,
			jsonValidator(
				UpdateClassSubtypeInputSchema,
				allowedFieldsCheck(
					["displayName", "isActive", "requiredSubtypeId"],
					"Registration catalog update request",
				),
			),
			(c) =>
				handleUpdateCatalogValue(c, organizationService, {
					kind: "class_subtype",
					payload: c.req.valid("json"),
				}),
		)
		.post(
			"/organizations/:slug/admin/instruments/:id",
			auth,
			tenant,
			admin,
			jsonValidator(
				UpdateInstrumentInputSchema,
				allowedFieldsCheck(
					["displayName", "isActive"],
					"Registration catalog update request",
				),
			),
			(c) =>
				handleUpdateCatalogValue(c, organizationService, {
					kind: "instrument",
					payload: c.req.valid("json"),
				}),
		);
}

export function buildAdminRegistrationCatalogRoutes(
	options: AdminRegistrationCatalogRoutesOptions,
) {
	const { organizationService, authVerifier } = options;
	return new Hono<AdminEnv>()
		.route("/", buildCatalogPolicyRoutes(organizationService, authVerifier))
		.route("/", buildCatalogValuesRoutes(organizationService, authVerifier));
}
