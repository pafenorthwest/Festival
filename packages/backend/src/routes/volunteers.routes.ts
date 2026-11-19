import {
	BookShiftsInputSchema,
	EnrollVolunteerInputSchema,
	VolunteerShiftsQuerySchema,
} from "@festival/common";
import { type Context, Hono } from "hono";
import { requireAuth, toJsonError } from "../auth/tenant-context.js";
import {
	getRequiredVolunteerScope,
	isCallerVolunteerAdmin,
	requireVolunteerScope,
} from "../auth/volunteer-context.js";
import { AppError } from "../errors/app-error.js";
import {
	validateBookShiftsRequest,
	validateEnrollVolunteerRequest,
} from "../volunteers/volunteer-validation.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
	queryValidator,
} from "./shared/schema-validator.js";
import {
	buildVolunteerAdminRoutes,
	VOLUNTEERS_ADMIN_ROUTE_SECURITY,
	type VolunteerEnv,
	type VolunteerRoutesOptions,
} from "./volunteers-admin.routes.js";

export type { VolunteerRoutesOptions };
export { buildVolunteerAdminRoutes, VOLUNTEERS_ADMIN_ROUTE_SECURITY };

const volunteerFirebaseRoute = (
	method: "GET" | "POST",
	path: string,
): CoLocatedRouteSecurity =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "firebase",
		csrfRequired: false,
		browserAllowed: true,
	});

const VOLUNTEER_MEMBER_SECURITY = [
	volunteerFirebaseRoute("POST", "/enroll"),
	volunteerFirebaseRoute("GET", "/shifts"),
	volunteerFirebaseRoute("POST", "/book"),
	volunteerFirebaseRoute("GET", "/my-schedule"),
	volunteerFirebaseRoute("POST", "/assignments/:assignmentId/cancel"),
] as const satisfies readonly CoLocatedRouteSecurity[];

const [
	POST_ROLES_SEC,
	PATCH_ROLE_SEC,
	DELETE_ROLE_SEC,
	GET_ROLE_SHIFTS_SEC,
	POST_ROLE_SHIFTS_SEC,
	PATCH_ROLE_SHIFT_SEC,
	DELETE_ROLE_SHIFT_SEC,
	GET_COVERAGE_GAPS_SEC,
] = VOLUNTEERS_ADMIN_ROUTE_SECURITY;

export const VOLUNTEERS_ROUTE_SECURITY = [
	volunteerFirebaseRoute("GET", "/roles"),
	POST_ROLES_SEC,
	PATCH_ROLE_SEC,
	DELETE_ROLE_SEC,
	GET_ROLE_SHIFTS_SEC,
	POST_ROLE_SHIFTS_SEC,
	PATCH_ROLE_SHIFT_SEC,
	DELETE_ROLE_SHIFT_SEC,
	...VOLUNTEER_MEMBER_SECURITY,
	GET_COVERAGE_GAPS_SEC,
] as const satisfies readonly CoLocatedRouteSecurity[];

async function handleListRoles(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
) {
	try {
		if (!options.volunteerRepository) {
			throw new AppError("Volunteer roles are unavailable.", 503);
		}
		const scope = getRequiredVolunteerScope(c);
		return c.json(
			await options.volunteerRepository.listRoles(
				scope.organization.id,
				scope.festival.id,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

// Unlike /roles admin routes, /enroll uses requireVolunteerScope rather than
// requireTenant: a volunteer is never required to be an organization
// member. Scope is resolved from the organization + festival named in
// the URL (both already present on this sub-router's mount path), per
// festival-scoping requirement.
interface ResolvedVolunteerBookingContext {
	scope: ReturnType<typeof getRequiredVolunteerScope>;
	volunteerId: string;
}

const resolvedVolunteerBookingCache = new WeakMap<
	Request,
	ResolvedVolunteerBookingContext
>();

async function resolveVolunteerBookingContext(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
): Promise<ResolvedVolunteerBookingContext> {
	if (!options.volunteerRepository) {
		throw new AppError("Volunteer booking is unavailable.", 503);
	}
	const scope = getRequiredVolunteerScope(c);
	const volunteer = await options.volunteerRepository.findVolunteerByUid(
		scope.organization.id,
		scope.festival.id,
		scope.identity.uid,
	);
	if (!volunteer) {
		throw new AppError("Volunteer not found.", 404);
	}
	return { scope, volunteerId: volunteer.id };
}

async function handleEnrollVolunteer(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
	payload: unknown,
) {
	try {
		if (!options.volunteerRepository) {
			throw new AppError("Volunteer roles are unavailable.", 503);
		}
		const scope = getRequiredVolunteerScope(c);
		const validated = validateEnrollVolunteerRequest(payload);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
		const volunteer = await options.volunteerRepository.upsertVolunteer({
			organizationId: scope.organization.id,
			festivalId: scope.festival.id,
			firebaseUid: scope.identity.uid,
			accountEmail: scope.identity.email,
			...validated.request,
		});
		// Best-effort; never blocks the response. See auth/custom-claims.ts.
		void options.customClaimsWriter?.addVolunteerFestival(
			scope.identity.uid,
			scope.organization.id,
			scope.festival.id,
		);
		return c.json(volunteer);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleListShifts(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
	query: { available?: string; open?: string },
) {
	try {
		if (!options.volunteerRepository) {
			throw new AppError("Volunteer shifts are unavailable.", 503);
		}
		const scope = getRequiredVolunteerScope(c);
		const schedule =
			await options.volunteerRepository.listScheduleForOrganization(
				scope.organization.id,
				scope.festival.id,
			);
		const availableOnly = query.available === "true" || query.open === "true";
		const entries = schedule.filter(
			(item) => !availableOnly || item.assignment === null,
		);
		return c.json(
			entries.map((item) => ({
				...item.shift,
				shift: item.shift,
				role: item.role,
				available: item.assignment === null,
			})),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleBookShifts(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
	payload: unknown,
) {
	try {
		if (!options.volunteerRepository) {
			throw new AppError("Volunteer booking is unavailable.", 503);
		}
		const { scope, volunteerId } =
			resolvedVolunteerBookingCache.get(c.req.raw) ??
			(await resolveVolunteerBookingContext(c, options));
		const validated = validateBookShiftsRequest(payload);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
		const outcome = await options.volunteerRepository.bookShifts({
			organizationId: scope.organization.id,
			festivalId: scope.festival.id,
			volunteerId,
			shiftIds: validated.request.shiftIds,
		});
		if (outcome.kind === "conflict") {
			return c.json(
				{ error: "Shift booking conflict.", shiftIds: outcome.shiftIds },
				409,
			);
		}
		return c.json({ kind: "booked", assignments: outcome.assignments });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleGetMySchedule(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
) {
	try {
		if (!options.volunteerRepository) {
			throw new AppError("Volunteer schedule is unavailable.", 503);
		}
		const scope = getRequiredVolunteerScope(c);
		const volunteer = await options.volunteerRepository.findVolunteerByUid(
			scope.organization.id,
			scope.festival.id,
			scope.identity.uid,
		);
		if (!volunteer) {
			return c.json([]);
		}
		return c.json(
			await options.volunteerRepository.listAssignmentsForVolunteer(
				scope.organization.id,
				scope.festival.id,
				volunteer.id,
			),
		);
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function resolveAssignmentForCancel(
	options: VolunteerRoutesOptions,
	scope: ReturnType<typeof getRequiredVolunteerScope>,
	assignmentId: string,
) {
	const volunteerRepo = options.volunteerRepository;
	if (!volunteerRepo) {
		throw new AppError("Volunteer cancellation is unavailable.", 503);
	}
	const schedule = await volunteerRepo.listScheduleForOrganization(
		scope.organization.id,
		scope.festival.id,
	);
	const scheduleEntry = schedule.find(
		(entry) => entry.assignment?.id === assignmentId,
	);
	if (!scheduleEntry?.assignment) {
		throw new AppError("Volunteer assignment not found.", 404);
	}
	const volunteer = await volunteerRepo.findVolunteerByUid(
		scope.organization.id,
		scope.festival.id,
		scope.identity.uid,
	);
	const isOwner =
		volunteer !== null && scheduleEntry.assignment.volunteerId === volunteer.id;
	const isAdmin = await isCallerVolunteerAdmin(options.repository, scope);
	if (!isOwner && !isAdmin) {
		throw new AppError("You can only cancel your own assignments.", 403);
	}
	return volunteerRepo;
}

async function handleCancelAssignment(
	c: Context<VolunteerEnv>,
	options: VolunteerRoutesOptions,
) {
	try {
		if (!options.volunteerRepository) {
			throw new AppError("Volunteer cancellation is unavailable.", 503);
		}
		const scope = getRequiredVolunteerScope(c);
		const assignmentId = c.req.param("assignmentId");
		if (!assignmentId) {
			throw new AppError("Assignment ID is required.", 400);
		}
		const volunteerRepo = await resolveAssignmentForCancel(
			options,
			scope,
			assignmentId,
		);
		const cancelled = await volunteerRepo.cancelAssignment({
			organizationId: scope.organization.id,
			festivalId: scope.festival.id,
			assignmentId,
			cancelledAtIso: new Date().toISOString(),
		});
		if (!cancelled) {
			throw new AppError(
				"Volunteer assignment not found or already cancelled.",
				404,
			);
		}
		return c.json(cancelled);
	} catch (error) {
		return toJsonError(c, error);
	}
}

/**
 * Builds the volunteer sub-router.
 *
 * This router is mounted under `/organizations/:slug/festivals/:festivalShortName/volunteers`.
 * All volunteer activity — roles, slots, assignments, and enrollment — is scoped to a single
 * festival. The `:festivalShortName` param is accessible from handler context via
 * `c.req.param("festivalShortName")` and must be used by future handlers to enforce
 * festival isolation per specs/VOLUNTEER-PORTAL.md.
 */
const enrollVolunteerValidator = jsonValidator(EnrollVolunteerInputSchema, {
	preCheck: (raw) => {
		const validated = validateEnrollVolunteerRequest(raw);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
	},
});

const bookShiftsValidator = jsonValidator(BookShiftsInputSchema, {
	invalidJsonMessage: "Invalid JSON payload.",
	preCheck: (raw) => {
		const validated = validateBookShiftsRequest(raw);
		if ("errors" in validated) {
			throw new AppError(validated.errors.join(" "), 400);
		}
	},
});

export function buildVolunteerRoutes(options: VolunteerRoutesOptions) {
	const memberAuth = [
		requireAuth(options.authVerifier),
		requireVolunteerScope(options.repository),
	] as const;
	const requireRolesRepoGuard = preValidationGuard(() => {
		if (!options.volunteerRepository) {
			throw new AppError("Volunteer roles are unavailable.", 503);
		}
	});
	const requireShiftsRepoGuard = preValidationGuard(() => {
		if (!options.volunteerRepository) {
			throw new AppError("Volunteer shifts are unavailable.", 503);
		}
	});
	const resolveBookingGuard = preValidationGuard<VolunteerEnv>(async (c) => {
		resolvedVolunteerBookingCache.set(
			c.req.raw,
			await resolveVolunteerBookingContext(c, options),
		);
	});

	return new Hono<VolunteerEnv>()
		.get("/roles", ...memberAuth, (c) => handleListRoles(c, options))
		.post(
			"/enroll",
			...memberAuth,
			requireRolesRepoGuard,
			enrollVolunteerValidator,
			(c) => handleEnrollVolunteer(c, options, c.req.valid("json")),
		)
		.get(
			"/shifts",
			...memberAuth,
			requireShiftsRepoGuard,
			queryValidator(VolunteerShiftsQuerySchema),
			(c) => handleListShifts(c, options, c.req.valid("query")),
		)
		.post(
			"/book",
			...memberAuth,
			resolveBookingGuard,
			bookShiftsValidator,
			(c) => handleBookShifts(c, options, c.req.valid("json")),
		)
		.get("/my-schedule", ...memberAuth, (c) => handleGetMySchedule(c, options))
		.post("/assignments/:assignmentId/cancel", ...memberAuth, (c) =>
			handleCancelAssignment(c, options),
		)
		.route("/", buildVolunteerAdminRoutes(options));
}
