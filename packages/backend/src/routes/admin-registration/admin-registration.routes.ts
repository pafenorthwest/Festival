import { isAccompanistDivisionSelectionPolicy } from "@festival/common";
import { Hono } from "hono";
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

export function buildAdminRegistrationRoutes(options: {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
}): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { organizationService, authVerifier } = options;
	const repository = organizationService.repository;

	router.get(
		"/organizations/:slug/admin/accompanist-policy",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
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
		},
	);

	router.post(
		"/organizations/:slug/admin/accompanist-policy",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(payload, ["policy"], "Accompanist policy request");
				if (
					!payload ||
					typeof payload !== "object" ||
					!isAccompanistDivisionSelectionPolicy(
						(payload as { policy?: unknown }).policy,
					)
				) {
					throw new AppError("Accompanist division policy is invalid.", 400);
				}
				const tenant = getRequiredTenant(c);
				return c.json({
					policy: await organizationService.updateAccompanistDivisionPolicy({
						organizationId: tenant.organization.id,
						policy: (
							payload as { policy: "exactly_one" | "one_to_two" | "one_to_all" }
						).policy,
					}),
				});
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/registration-configuration",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.getRegistrationConfigurationForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/registration-age-date",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = await c.req.json();
				assertAllowedFields(
					payload,
					["registrationAgeDate"],
					"Registration age configuration",
				);
				return c.json(
					await organizationService.updateRegistrationAgeDateForTenant(
						getRequiredTenant(c),
						(payload as { registrationAgeDate?: unknown })?.registrationAgeDate,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	for (const [kind, path] of [
		["class_subtype", "class-subtypes"],
		["instrument", "instruments"],
	] as const) {
		router.post(
			`/organizations/:slug/admin/${path}`,
			requireAuth(authVerifier),
			requireTenant(repository),
			requireTenantRole(["Admin"]),
			async (c) => {
				try {
					const payload = await c.req.json();
					assertAllowedFields(
						payload,
						["displayName"],
						"Registration catalog request",
					);
					c.status(201);
					return c.json(
						await organizationService.createRegistrationCatalogValueForTenant(
							getRequiredTenant(c),
							kind,
							(payload as { displayName?: unknown })?.displayName,
						),
					);
				} catch (error) {
					return toJsonError(c, error);
				}
			},
		);
	}

	for (const [kind, path] of [
		["class_subtype", "class-subtypes"],
		["instrument", "instruments"],
	] as const) {
		router.post(
			`/organizations/:slug/admin/${path}/reorder`,
			requireAuth(authVerifier),
			requireTenant(repository),
			requireTenantRole(["Admin"]),
			async (c) => {
				try {
					const payload = await c.req.json();
					assertAllowedFields(
						payload,
						["ids"],
						"Registration catalog reorder request",
					);
					return c.json(
						await organizationService.reorderRegistrationCatalogValuesForTenant(
							getRequiredTenant(c),
							kind,
							(payload as { ids?: unknown })?.ids,
						),
					);
				} catch (error) {
					return toJsonError(c, error);
				}
			},
		);
		router.post(
			`/organizations/:slug/admin/${path}/:id`,
			requireAuth(authVerifier),
			requireTenant(repository),
			requireTenantRole(["Admin"]),
			async (c) => {
				try {
					const payload = await c.req.json();
					assertAllowedFields(
						payload,
						["displayName", "isActive"],
						"Registration catalog update request",
					);
					return c.json(
						await organizationService.updateRegistrationCatalogValueForTenant(
							getRequiredTenant(c),
							kind,
							c.req.param("id"),
							payload as { displayName?: unknown; isActive?: unknown },
						),
					);
				} catch (error) {
					return toJsonError(c, error);
				}
			},
		);
	}

	return router;
}
