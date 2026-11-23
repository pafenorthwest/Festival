import {
	CreateVolunteerRoleInputSchema,
	CreateVolunteerShiftInputSchema,
	calculateCoverageGaps,
	UpdateVolunteerRoleInputSchema,
	UpdateVolunteerShiftInputSchema,
} from "@festival/common";
import { type Context, Hono } from "hono";
import type { CustomClaimsWriter } from "../auth/custom-claims.js";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import {
	getRequiredVolunteerScope,
	requireAdminIntent,
	requireVolunteerScope,
} from "../auth/volunteer-context.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type {
	VolunteerAssignmentRecord,
	VolunteerRepository,
} from "../volunteers/volunteer-repository.js";
import {
	validateCreateRoleRequest,
	validateCreateShiftRequest,
	validateUpdateRoleRequest,
	validateUpdateShiftRequest,
} from "../volunteers/volunteer-validation.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
} from "./shared/schema-validator.js";

export type VolunteerEnv = { Variables: Partial<ApiVariables> };

export interface VolunteerRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	volunteerRepository?: VolunteerRepository;
	customClaimsWriter?: CustomClaimsWriter;
}

const volunteerAdminRoute = (
	method: "GET" | "POST" | "PATCH" | "DELETE",
	path: string,
): CoLocatedRouteSecurity =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "volunteer-admin",
		csrfRequired: false,
		browserAllowed: true,
	});

export const VOLUNTEERS_ADMIN_ROUTE_SECURITY = [
	volunteerAdminRoute("POST", "/roles"),
	volunteerAdminRoute("PATCH", "/roles/:roleId"),
	volunteerAdminRoute("DELETE", "/roles/:roleId"),
	volunteerAdminRoute("GET", "/roles/:roleId/shifts"),
	volunteerAdminRoute("POST", "/roles/:roleId/shifts"),
	volunteerAdminRoute("PATCH", "/roles/:roleId/shifts/:shiftId"),
	volunteerAdminRoute("DELETE", "/roles/:roleId/shifts/:shiftId"),
	volunteerAdminRoute("GET", "/coverage-gaps"),
] as const satisfies readonly CoLocatedRouteSecurity[];

function requireVolunteerRepo(
	repo: VolunteerRepository | undefined,
	unavailableMessage: string,
): VolunteerRepository {
	if (!repo) {
		throw new AppError(unavailableMessage, 503);
	}
	return repo;
}

function requireRouteParam(c: Context, name: string, label: string): string {
	const value = c.req.param(name);
	if (!value) {
		throw new AppError(`${label} is required.`, 400);
	}
	return value;
}

async function resolveAdminRoleScope(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
) {
	const volunteerRepo = requireVolunteerRepo(
		options.volunteerRepository,
		"Volunteer roles are unavailable.",
	);
	const tenant = getRequiredTenant(c);
	const scope = getRequiredVolunteerScope(c);
	const roleId = requireRouteParam(c, "roleId", "Role ID");
	const role = await volunteerRepo.getRole(
		tenant.organization.id,
		scope.festival.id,
		roleId,
	);
	if (!role) {
		throw new AppError("Volunteer role not found.", 404);
	}
	return { volunteerRepo, tenant, scope, role };
}

const resolvedRoleScopeCache = new WeakMap<
	Request,
	Awaited<ReturnType<typeof resolveAdminRoleScope>>
>();

async function handleCreateRole(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
	payload: unknown,
) {
	try {
		const volunteerRepo = requireVolunteerRepo(
			options.volunteerRepository,
			"Volunteer roles are unavailable.",
		);
		const tenant = getRequiredTenant(c);
		const scope = getRequiredVolunteerScope(c);
		const validated = validateCreateRoleRequest(payload);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
		const created = await volunteerRepo.createRole({
			organizationId: tenant.organization.id,
			festivalId: scope.festival.id,
			...validated.request,
		});
		return c.json(created, 201);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleUpdateRole(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
	payload: unknown,
) {
	try {
		const volunteerRepo = requireVolunteerRepo(
			options.volunteerRepository,
			"Volunteer roles are unavailable.",
		);
		const tenant = getRequiredTenant(c);
		const scope = getRequiredVolunteerScope(c);
		const roleId = requireRouteParam(c, "roleId", "Role ID");
		const validated = validateUpdateRoleRequest(payload);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
		const updated = await volunteerRepo.updateRole({
			organizationId: tenant.organization.id,
			festivalId: scope.festival.id,
			roleId,
			...validated.request,
		});
		if (!updated) {
			throw new AppError("Volunteer role not found.", 404);
		}
		return c.json(updated);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleDeleteRole(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
) {
	try {
		const volunteerRepo = requireVolunteerRepo(
			options.volunteerRepository,
			"Volunteer roles are unavailable.",
		);
		const tenant = getRequiredTenant(c);
		const scope = getRequiredVolunteerScope(c);
		const roleId = requireRouteParam(c, "roleId", "Role ID");
		const deleted = await volunteerRepo.deleteRole(
			tenant.organization.id,
			scope.festival.id,
			roleId,
		);
		if (!deleted) {
			throw new AppError("Volunteer role not found.", 404);
		}
		return c.json({ status: "deleted" });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleListRoleShifts(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
) {
	try {
		const { volunteerRepo, tenant, scope, role } = await resolveAdminRoleScope(
			c,
			options,
		);
		return c.json(
			await volunteerRepo.listShiftsForRole(
				tenant.organization.id,
				scope.festival.id,
				role.id,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleCreateShift(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
	payload: unknown,
) {
	try {
		const { volunteerRepo, tenant, scope, role } =
			resolvedRoleScopeCache.get(c.req.raw) ??
			(await resolveAdminRoleScope(c, options));
		const validated = validateCreateShiftRequest(payload, role);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
		const created = await volunteerRepo.createShift({
			organizationId: tenant.organization.id,
			festivalId: scope.festival.id,
			roleId: role.id,
			...validated.request,
		});
		return c.json(created, 201);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleUpdateShift(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
	payload: unknown,
) {
	try {
		const { volunteerRepo, tenant, scope, role } =
			resolvedRoleScopeCache.get(c.req.raw) ??
			(await resolveAdminRoleScope(c, options));
		const shiftId = requireRouteParam(c, "shiftId", "Shift ID");
		const validated = validateUpdateShiftRequest(payload, role);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
		const updated = await volunteerRepo.updateShift({
			organizationId: tenant.organization.id,
			festivalId: scope.festival.id,
			roleId: role.id,
			shiftId,
			...validated.request,
		});
		if (!updated) {
			throw new AppError("Volunteer shift not found.", 404);
		}
		return c.json(updated);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleDeleteShift(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
) {
	try {
		const volunteerRepo = requireVolunteerRepo(
			options.volunteerRepository,
			"Volunteer roles are unavailable.",
		);
		const tenant = getRequiredTenant(c);
		const scope = getRequiredVolunteerScope(c);
		const roleId = requireRouteParam(c, "roleId", "Role ID");
		const shiftId = requireRouteParam(c, "shiftId", "Shift ID");
		const deleted = await volunteerRepo.deleteShift(
			tenant.organization.id,
			scope.festival.id,
			roleId,
			shiftId,
		);
		if (!deleted) {
			throw new AppError("Volunteer shift not found.", 404);
		}
		return c.json({ status: "deleted" });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleGetCoverageGaps(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
) {
	try {
		const volunteerRepo = requireVolunteerRepo(
			options.volunteerRepository,
			"Volunteer schedule is unavailable.",
		);
		const tenant = getRequiredTenant(c);
		const scope = getRequiredVolunteerScope(c);
		const schedule = await volunteerRepo.listScheduleForOrganization(
			tenant.organization.id,
			scope.festival.id,
		);
		const roles = await volunteerRepo.listRoles(
			tenant.organization.id,
			scope.festival.id,
		);
		const shifts = schedule.map((entry) => entry.shift);
		const assignments = schedule
			.map((entry) => entry.assignment)
			.filter((a): a is VolunteerAssignmentRecord => a !== null);

		const summary = calculateCoverageGaps(shifts, roles, assignments);
		return c.json({
			...summary,
			totalShifts: summary.totalShifts,
			filledShifts: summary.filledShifts,
			openShifts: summary.unfilledShifts,
			coveragePercentage: summary.coveragePercentage,
			unfilled: summary.gaps,
			gaps: summary.gaps,
			// Every slot in the festival, each with a server-computed
			// Open/Filled status — powers the filterable slot list on
			// the admin page. See calculateCoverageGaps in
			// @festival/common.
			slots: summary.slots,
		});
	} catch (error) {
		return toJsonError(c, error);
	}
}

/**
 * Builds the admin volunteer routes sub-router.
 *
 * Creating roles and shifts is the "admin build screen" from VOLUNTEER-PORTAL.md,
 * requiring requireAdminIntent (Admin, Division Chair, or Concert Chair) rather
 * than narrower requireTenantRole(["Admin"]) checks elsewhere in the app.
 */
const createRoleValidator = jsonValidator(CreateVolunteerRoleInputSchema, {
	preCheck: (raw) => {
		const validated = validateCreateRoleRequest(raw);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
	},
});

const updateRoleValidator = jsonValidator(UpdateVolunteerRoleInputSchema, {
	preCheck: (raw) => {
		const validated = validateUpdateRoleRequest(raw);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
	},
});

const createShiftValidator = jsonValidator(CreateVolunteerShiftInputSchema);
const updateShiftValidator = jsonValidator(UpdateVolunteerShiftInputSchema);

export function buildVolunteerAdminRoutes(options: VolunteerRoutesOptions) {
	const adminAuth = [
		requireAuth(options.authVerifier),
		requireTenant(options.repository),
		requireAdminIntent(),
		requireVolunteerScope(options.repository),
	] as const;
	const requireRoleRepoGuard = preValidationGuard(() => {
		requireVolunteerRepo(
			options.volunteerRepository,
			"Volunteer roles are unavailable.",
		);
	});
	const resolveRoleScopeGuard = preValidationGuard<VolunteerEnv>(async (c) => {
		resolvedRoleScopeCache.set(
			c.req.raw,
			await resolveAdminRoleScope(c, options),
		);
	});

	return new Hono<VolunteerEnv>()
		.post(
			"/roles",
			...adminAuth,
			requireRoleRepoGuard,
			createRoleValidator,
			(c) => handleCreateRole(c, options, c.req.valid("json")),
		)
		.patch(
			"/roles/:roleId",
			...adminAuth,
			requireRoleRepoGuard,
			updateRoleValidator,
			(c) => handleUpdateRole(c, options, c.req.valid("json")),
		)
		.delete("/roles/:roleId", ...adminAuth, (c) => handleDeleteRole(c, options))
		.get("/roles/:roleId/shifts", ...adminAuth, (c) =>
			handleListRoleShifts(c, options),
		)
		.post(
			"/roles/:roleId/shifts",
			...adminAuth,
			resolveRoleScopeGuard,
			createShiftValidator,
			(c) => handleCreateShift(c, options, c.req.valid("json")),
		)
		.patch(
			"/roles/:roleId/shifts/:shiftId",
			...adminAuth,
			resolveRoleScopeGuard,
			updateShiftValidator,
			(c) => handleUpdateShift(c, options, c.req.valid("json")),
		)
		.delete("/roles/:roleId/shifts/:shiftId", ...adminAuth, (c) =>
			handleDeleteShift(c, options),
		)
		.get("/coverage-gaps", ...adminAuth, (c) =>
			handleGetCoverageGaps(c, options),
		);
}
