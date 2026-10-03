import { calculateCoverageGaps } from "@festival/common";
import { Hono } from "hono";
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
	isCallerVolunteerAdmin,
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
	validateBookShiftsRequest,
	validateCreateRoleRequest,
	validateCreateShiftRequest,
	validateEnrollVolunteerRequest,
} from "../volunteers/volunteer-validation.js";

export interface VolunteerRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	volunteerRepository?: VolunteerRepository;
	customClaimsWriter?: CustomClaimsWriter;
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
export function buildVolunteerRoutes(
	options: VolunteerRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();

	router.get(
		"/roles",
		requireAuth(options.authVerifier),
		requireVolunteerScope(options.repository),
		async (c) => {
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
		},
	);

	// The three routes below are admin-only: creating roles and shifts is
	// the "admin build screen" from VOLUNTEER-PORTAL.md, which requires
	// requireAdminIntent (Admin, Division Chair, or Concert Chair) rather
	// than the narrower requireTenantRole(["Admin"]) most admin routes
	// elsewhere in this app use.
	router.post(
		"/roles",
		requireAuth(options.authVerifier),
		requireTenant(options.repository),
		requireAdminIntent(),
		requireVolunteerScope(options.repository),
		async (c) => {
			try {
				if (!options.volunteerRepository) {
					throw new AppError("Volunteer roles are unavailable.", 503);
				}
				const tenant = getRequiredTenant(c);
				const scope = getRequiredVolunteerScope(c);
				const payload = await c.req.json();
				const validated = validateCreateRoleRequest(payload);
				if ("errors" in validated) {
					throw new AppError(validated.errors.join(" "), 400);
				}
				c.status(201);
				return c.json(
					await options.volunteerRepository.createRole({
						organizationId: tenant.organization.id,
						festivalId: scope.festival.id,
						...validated.request,
					}),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/roles/:roleId/shifts",
		requireAuth(options.authVerifier),
		requireTenant(options.repository),
		requireAdminIntent(),
		requireVolunteerScope(options.repository),
		async (c) => {
			try {
				if (!options.volunteerRepository) {
					throw new AppError("Volunteer roles are unavailable.", 503);
				}
				const tenant = getRequiredTenant(c);
				const scope = getRequiredVolunteerScope(c);
				const role = await options.volunteerRepository.getRole(
					tenant.organization.id,
					scope.festival.id,
					c.req.param("roleId"),
				);
				if (!role) throw new AppError("Volunteer role not found.", 404);
				return c.json(
					await options.volunteerRepository.listShiftsForRole(
						tenant.organization.id,
						scope.festival.id,
						role.id,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/roles/:roleId/shifts",
		requireAuth(options.authVerifier),
		requireTenant(options.repository),
		requireAdminIntent(),
		requireVolunteerScope(options.repository),
		async (c) => {
			try {
				if (!options.volunteerRepository) {
					throw new AppError("Volunteer roles are unavailable.", 503);
				}
				const tenant = getRequiredTenant(c);
				const scope = getRequiredVolunteerScope(c);
				const role = await options.volunteerRepository.getRole(
					tenant.organization.id,
					scope.festival.id,
					c.req.param("roleId"),
				);
				if (!role) throw new AppError("Volunteer role not found.", 404);
				const payload = await c.req.json();
				const validated = validateCreateShiftRequest(payload, role);
				if ("errors" in validated) {
					throw new AppError(validated.errors.join(" "), 400);
				}
				c.status(201);
				return c.json(
					await options.volunteerRepository.createShift({
						organizationId: tenant.organization.id,
						festivalId: scope.festival.id,
						roleId: role.id,
						...validated.request,
					}),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// Unlike /roles above, /enroll uses requireVolunteerScope rather than
	// requireTenant: a volunteer is never required to be an organization
	// member. Scope is resolved from the organization + festival named in
	// the URL (both already present on this sub-router's mount path), per
	// festival-scoping requirement.
	router.post(
		"/enroll",
		requireAuth(options.authVerifier),
		requireVolunteerScope(options.repository),
		async (c) => {
			try {
				if (!options.volunteerRepository) {
					throw new AppError("Volunteer roles are unavailable.", 503);
				}
				const scope = getRequiredVolunteerScope(c);
				const payload = await c.req.json();
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
		},
	);

	router.get(
		"/shifts",
		requireAuth(options.authVerifier),
		requireVolunteerScope(options.repository),
		async (c) => {
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
				const availableOnly =
					c.req.query("available") === "true" || c.req.query("open") === "true";
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
		},
	);

	router.post(
		"/book",
		requireAuth(options.authVerifier),
		requireVolunteerScope(options.repository),
		async (c) => {
			try {
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
				let payload: unknown;
				try {
					payload = await c.req.json();
				} catch {
					throw new AppError("Invalid JSON payload.", 400);
				}
				const validated = validateBookShiftsRequest(payload);
				if ("errors" in validated) {
					throw new AppError(validated.errors.join(" "), 400);
				}
				const outcome = await options.volunteerRepository.bookShifts({
					organizationId: scope.organization.id,
					festivalId: scope.festival.id,
					volunteerId: volunteer.id,
					shiftIds: validated.request.shiftIds,
				});
				if (outcome.kind === "conflict") {
					c.status(409);
					return c.json({
						error: "Shift booking conflict.",
						shiftIds: outcome.shiftIds,
					});
				}
				return c.json({
					kind: "booked",
					assignments: outcome.assignments,
				});
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/my-schedule",
		requireAuth(options.authVerifier),
		requireVolunteerScope(options.repository),
		async (c) => {
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
		},
	);

	router.post(
		"/assignments/:assignmentId/cancel",
		requireAuth(options.authVerifier),
		requireVolunteerScope(options.repository),
		async (c) => {
			try {
				if (!options.volunteerRepository) {
					throw new AppError("Volunteer cancellation is unavailable.", 503);
				}
				const scope = getRequiredVolunteerScope(c);
				const assignmentId = c.req.param("assignmentId");
				if (!assignmentId) {
					throw new AppError("Assignment ID is required.", 400);
				}

				const schedule =
					await options.volunteerRepository.listScheduleForOrganization(
						scope.organization.id,
						scope.festival.id,
					);
				const scheduleEntry = schedule.find(
					(entry) => entry.assignment?.id === assignmentId,
				);
				if (!scheduleEntry?.assignment) {
					throw new AppError("Volunteer assignment not found.", 404);
				}

				const volunteer = await options.volunteerRepository.findVolunteerByUid(
					scope.organization.id,
					scope.festival.id,
					scope.identity.uid,
				);
				const isOwner =
					volunteer !== null &&
					scheduleEntry.assignment.volunteerId === volunteer.id;
				const isAdmin = await isCallerVolunteerAdmin(options.repository, scope);

				if (!isOwner && !isAdmin) {
					throw new AppError("You can only cancel your own assignments.", 403);
				}

				const cancelled = await options.volunteerRepository.cancelAssignment({
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
		},
	);

	router.get(
		"/coverage-gaps",
		requireAuth(options.authVerifier),
		requireTenant(options.repository),
		requireAdminIntent(),
		requireVolunteerScope(options.repository),
		async (c) => {
			try {
				if (!options.volunteerRepository) {
					throw new AppError("Volunteer schedule is unavailable.", 503);
				}
				const tenant = getRequiredTenant(c);
				const scope = getRequiredVolunteerScope(c);
				const schedule =
					await options.volunteerRepository.listScheduleForOrganization(
						tenant.organization.id,
						scope.festival.id,
					);
				const roles = await options.volunteerRepository.listRoles(
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
		},
	);

	return router;
}
