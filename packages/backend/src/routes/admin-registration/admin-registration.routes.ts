import { isAccompanistDivisionSelectionPolicy } from "@festival/common";
import { Hono } from "hono";
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

export interface AdminRegistrationRoutesOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
	dropTransferService?: DropTransferService;
	registrationChangeRepository?: RegistrationChangeRepository;
}

function requireDropTransferService(
	service: DropTransferService | undefined,
): DropTransferService {
	if (!service)
		throw new AppError("Feature 'drop_and_transfer' is not enabled.", 404);
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

export function buildAdminRegistrationRoutes(
	options: AdminRegistrationRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
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
						kind === "class_subtype"
							? ["displayName", "requiredSubtypeId"]
							: ["displayName"],
						"Registration catalog request",
					);
					c.status(201);
					return c.json(
						await organizationService.createRegistrationCatalogValueForTenant(
							getRequiredTenant(c),
							kind,
							(payload as { displayName?: unknown })?.displayName,
							(payload as { requiredSubtypeId?: unknown })?.requiredSubtypeId,
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
						kind === "class_subtype"
							? ["displayName", "isActive", "requiredSubtypeId"]
							: ["displayName", "isActive"],
						"Registration catalog update request",
					);
					return c.json(
						await organizationService.updateRegistrationCatalogValueForTenant(
							getRequiredTenant(c),
							kind,
							c.req.param("id"),
							payload as {
								displayName?: unknown;
								isActive?: unknown;
								requiredSubtypeId?: unknown;
							},
						),
					);
				} catch (error) {
					return toJsonError(c, error);
				}
			},
		);
	}

	const base =
		"/organizations/:slug/festivals/:festivalShortName/registrations";

	router.post(
		`${base}/:id/drop`,
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const actor = getRequiredIdentity(c);
				const festivalShortName = c.req.param("festivalShortName");
				const id = c.req.param("id");

				const festival = await repository.findFestivalByShortName(
					tenant.organization.id,
					festivalShortName,
				);
				if (!festival) throw new AppError("Festival not found.", 404);

				const service = requireDropTransferService(options.dropTransferService);
				const entitlement = await service.getEntitlement(
					id,
					tenant.organization.id,
				);
				if (
					!entitlement ||
					(entitlement.festivalId && entitlement.festivalId !== festival.id)
				) {
					throw new AppError("Registration not found.", 404);
				}

				let body: Record<string, unknown> = {};
				try {
					const b = await c.req.json();
					if (b && typeof b === "object" && !Array.isArray(b)) {
						body = b as Record<string, unknown>;
					}
				} catch {
					// body is optional for drop
				}

				const requestRefund =
					body.requestRefund === true ||
					body.issueRefund === true ||
					body.refund === true;
				const refundAmountCents =
					typeof body.refundAmountCents === "number"
						? body.refundAmountCents
						: typeof body.amountCents === "number"
							? body.amountCents
							: undefined;
				const reason = typeof body.reason === "string" ? body.reason : null;
				const refundReason =
					typeof body.refundReason === "string" ? body.refundReason : undefined;

				const result = await service.dropRegistration({
					classEntitlementId: id,
					organizationId: tenant.organization.id,
					festivalId: festival.id,
					actorUid: actor.uid,
					actorRole: "admin",
					reason,
					requestRefund,
					issueRefund: requestRefund,
					refundAmountCents,
					refundReason,
				});

				return c.json(result);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		`${base}/:id/transfer`,
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const actor = getRequiredIdentity(c);
				const festivalShortName = c.req.param("festivalShortName");
				const id = c.req.param("id");

				const festival = await repository.findFestivalByShortName(
					tenant.organization.id,
					festivalShortName,
				);
				if (!festival) throw new AppError("Festival not found.", 404);

				const service = requireDropTransferService(options.dropTransferService);
				const entitlement = await service.getEntitlement(
					id,
					tenant.organization.id,
				);
				if (
					!entitlement ||
					(entitlement.festivalId && entitlement.festivalId !== festival.id)
				) {
					throw new AppError("Registration not found.", 404);
				}

				let body: Record<string, unknown> = {};
				try {
					const b = await c.req.json();
					if (b && typeof b === "object" && !Array.isArray(b)) {
						body = b as Record<string, unknown>;
					} else {
						throw new AppError("Transfer request is invalid.", 400);
					}
				} catch (err) {
					if (err instanceof AppError) throw err;
					throw new AppError("Transfer request is invalid.", 400);
				}

				const targetFestivalClassId =
					typeof body.targetFestivalClassId === "string"
						? body.targetFestivalClassId.trim()
						: typeof body.targetClassId === "string"
							? body.targetClassId.trim()
							: typeof body.destinationFestivalClassId === "string"
								? body.destinationFestivalClassId.trim()
								: "";

				if (!targetFestivalClassId) {
					throw new AppError("Target festival class ID is required.", 400);
				}

				const reason = typeof body.reason === "string" ? body.reason : null;

				const result = await service.transferRegistration({
					classEntitlementId: id,
					targetFestivalClassId,
					organizationId: tenant.organization.id,
					festivalId: festival.id,
					sourceFestivalClassId: entitlement.festivalClassId,
					actorUid: actor.uid,
					actorRole: "admin",
					reason,
				});

				return c.json(result);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		`${base}/:id/promote`,
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const actor = getRequiredIdentity(c);
				const festivalShortName = c.req.param("festivalShortName");
				const id = c.req.param("id");

				const festival = await repository.findFestivalByShortName(
					tenant.organization.id,
					festivalShortName,
				);
				if (!festival) throw new AppError("Festival not found.", 404);

				const service = requireDropTransferService(options.dropTransferService);
				const entitlement = await service.getEntitlement(
					id,
					tenant.organization.id,
				);
				if (
					!entitlement ||
					(entitlement.festivalId && entitlement.festivalId !== festival.id)
				) {
					throw new AppError("Registration not found.", 404);
				}

				let body: Record<string, unknown> = {};
				try {
					const b = await c.req.json();
					if (b && typeof b === "object" && !Array.isArray(b)) {
						body = b as Record<string, unknown>;
					}
				} catch {
					// body is optional for promote
				}

				const reason = typeof body.reason === "string" ? body.reason : null;

				const result = await service.promoteRegistration({
					classEntitlementId: id,
					organizationId: tenant.organization.id,
					festivalId: festival.id,
					actorUid: actor.uid,
					actorRole: "admin",
					reason,
				});

				return c.json(result);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		`${base}/:id/change-log`,
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const festivalShortName = c.req.param("festivalShortName");
				const id = c.req.param("id");

				const festival = await repository.findFestivalByShortName(
					tenant.organization.id,
					festivalShortName,
				);
				if (!festival) throw new AppError("Festival not found.", 404);

				if (options.dropTransferService) {
					const entitlement = await options.dropTransferService.getEntitlement(
						id,
						tenant.organization.id,
					);
					if (
						!entitlement ||
						(entitlement.festivalId && entitlement.festivalId !== festival.id)
					) {
						throw new AppError("Registration not found.", 404);
					}
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
		},
	);

	return router;
}
