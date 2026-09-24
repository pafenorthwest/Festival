import { Hono } from "hono";
import {
	type ApiVariables,
	requireAuth,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import {
	getRequiredVolunteerScope,
	requireVolunteerScope,
} from "../auth/volunteer-context.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { VolunteerRepository } from "../volunteers/volunteer-repository.js";
import { validateEnrollVolunteerRequest } from "../volunteers/volunteer-validation.js";

export interface VolunteerRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	volunteerRepository?: VolunteerRepository;
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

	// A volunteer is never required to be an organization member. Scope is
	// resolved from the organization + festival named in the URL (both already
	// present on this sub-router's mount path), per VOLUNTEER-PORTAL.md's
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
				return c.json(
					await options.volunteerRepository.upsertVolunteer({
						organizationId: scope.organization.id,
						festivalId: scope.festival.id,
						firebaseUid: scope.identity.uid,
						accountEmail: scope.identity.email,
						...validated.request,
					}),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
