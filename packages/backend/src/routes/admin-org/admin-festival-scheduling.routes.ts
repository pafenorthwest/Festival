import {
	AppError,
	createDefaultSchedulingConfiguration,
	enumerateDateRange,
	evaluateSchedulingConfigPreview,
	type SchedulingConfiguration,
	SchedulingConfigurationSchema,
	UpdateSchedulingClassRulesSchema,
	UpdateSchedulingConfigurationSchema,
} from "@festival/common";
import type { Context } from "hono";
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
import type { OrganizationService } from "../../services/organization-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import { jsonValidator } from "../shared/schema-validator.js";

const adminRoute = (method: CoLocatedRouteSecurity["method"], path: string) =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	});

const baseSchedulingPath =
	"/organizations/:slug/admin/festivals/:festivalShortName/scheduling";
const classRulesPath = `${baseSchedulingPath}/class-rules`;
const configPath = `${baseSchedulingPath}/config`;
const previewPath = `${baseSchedulingPath}/config/preview`;

export const ADMIN_FESTIVAL_SCHEDULING_ROUTE_SECURITY = [
	adminRoute("GET", classRulesPath),
	adminRoute("PUT", classRulesPath),
	adminRoute("GET", configPath),
	adminRoute("PUT", configPath),
	adminRoute("POST", previewPath),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface AdminSchedulingRoutesOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
}

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

async function withJson<T>(c: ApiContext, fn: () => Promise<T>) {
	try {
		return c.json(await fn(), 200);
	} catch (error) {
		return toJsonError(c, error);
	}
}

function collectDivisionIds(config: SchedulingConfiguration): string[] {
	const ids = new Set<string>();
	for (const adj of config.adjudicators) {
		for (const divId of adj.eligibleDivisionIds) ids.add(divId);
	}
	for (const win of config.roomWindows) {
		for (const divId of win.eligibleDivisionIds) ids.add(divId);
	}
	for (const rule of config.roomCompatibilityRules) {
		if (rule.scopeType === "division") ids.add(rule.scopeValue);
	}
	return [...ids];
}

export function buildAdminFestivalSchedulingRoutes({
	organizationService,
	authVerifier,
}: AdminSchedulingRoutesOptions) {
	const repository = organizationService.repository;
	const auth = requireAuth(authVerifier);
	const tenant = requireTenant(repository);
	const admin = requireTenantRole(["Admin"]);

	async function resolveScope(c: ApiContext) {
		const context = getRequiredTenant(c);
		const festivalShortName = c.req.param("festivalShortName") ?? "";
		const { festival } = await organizationService.getAdminFestivalForTenant(
			context,
			festivalShortName,
		);
		return {
			context,
			festivalShortName,
			organizationId: context.organization.id,
			festival,
			actorUid: context.identity.uid,
		};
	}

	async function assertKnownReferences(
		scope: Awaited<ReturnType<typeof resolveScope>>,
		config: SchedulingConfiguration,
	) {
		const { organizationId, festival } = scope;
		const classIds = config.classRules.map((rule) => rule.classId);
		if (classIds.length > 0) {
			const classes = await repository.findFestivalClassConfigurationsByIds(
				organizationId,
				festival.id,
				classIds,
			);
			const knownClassIds = new Set(classes.map((item) => item.id));
			const missingClassIds = classIds.filter((id) => !knownClassIds.has(id));
			if (missingClassIds.length > 0) {
				throw new AppError(
					`Unknown catalog class in this festival: ${missingClassIds.join(", ")}.`,
					400,
				);
			}
		}

		const roomIds = [
			...new Set(
				config.roomWindows
					.map((w) => w.roomId)
					.filter((roomId) => roomId.length > 0),
			),
		];
		if (roomIds.length > 0) {
			const { rooms } = await organizationService.listRoomsForTenant(
				scope.context,
				scope.festivalShortName,
			);
			const knownRoomIds = new Set(rooms.map((r) => r.id));
			const missingRoomIds = roomIds.filter((id) => !knownRoomIds.has(id));
			if (missingRoomIds.length > 0) {
				throw new AppError(
					`Unknown room in this festival: ${missingRoomIds.join(", ")}.`,
					400,
				);
			}
		}

		const divisionIds = collectDivisionIds(config);
		if (divisionIds.length > 0) {
			const divisions = await repository.listDivisions(organizationId);
			const knownDivisionIds = new Set(divisions.map((d) => d.id));
			const missingDivisionIds = divisionIds.filter(
				(id) => !knownDivisionIds.has(id),
			);
			if (missingDivisionIds.length > 0) {
				throw new AppError(
					`Unknown division in this organization: ${missingDivisionIds.join(", ")}.`,
					400,
				);
			}
		}
	}

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(classRulesPath, auth, tenant, admin, (c) =>
			withJson(c, async () => {
				const scope = await resolveScope(c);
				return repository.schedulingConfig.current(
					scope.organizationId,
					scope.festival.id,
				);
			}),
		)
		.put(
			classRulesPath,
			auth,
			tenant,
			admin,
			jsonValidator(UpdateSchedulingClassRulesSchema),
			(c) =>
				withJson(c, async () => {
					const scope = await resolveScope(c);
					const payload = c.req.valid("json");
					const classIds = payload.rules.map((rule) => rule.classId);
					const classes = await repository.findFestivalClassConfigurationsByIds(
						scope.organizationId,
						scope.festival.id,
						classIds,
					);
					const knownIds = new Set(classes.map((item) => item.id));
					const missingIds = classIds.filter((id) => !knownIds.has(id));
					if (missingIds.length) {
						throw new AppError(
							`Unknown catalog class in this festival: ${missingIds.join(", ")}.`,
							400,
						);
					}
					return repository.schedulingConfig.save({
						organizationId: scope.organizationId,
						festivalId: scope.festival.id,
						actorUid: scope.actorUid,
						...payload,
					});
				}),
		)
		.get(configPath, auth, tenant, admin, (c) =>
			withJson(c, async () => {
				const scope = await resolveScope(c);
				const current = await repository.schedulingConfig.currentConfig(
					scope.organizationId,
					scope.festival.id,
				);
				if (
					current.revision === 0 &&
					current.config.festivalDates.length === 0
				) {
					return {
						revision: 0,
						config: createDefaultSchedulingConfiguration(
							enumerateDateRange(
								scope.festival.startDate,
								scope.festival.endDate,
							),
						),
					};
				}
				return current;
			}),
		)
		.put(
			configPath,
			auth,
			tenant,
			admin,
			jsonValidator(UpdateSchedulingConfigurationSchema),
			(c) =>
				withJson(c, async () => {
					const scope = await resolveScope(c);
					const payload = c.req.valid("json");
					await assertKnownReferences(scope, payload.config);
					return repository.schedulingConfig.saveConfig({
						organizationId: scope.organizationId,
						festivalId: scope.festival.id,
						actorUid: scope.actorUid,
						expectedRevision: payload.expectedRevision,
						config: payload.config,
					});
				}),
		)
		.post(
			previewPath,
			auth,
			tenant,
			admin,
			jsonValidator(SchedulingConfigurationSchema),
			(c) =>
				withJson(c, async () => {
					const scope = await resolveScope(c);
					const config = c.req.valid("json");
					const [{ rooms }, catalogClasses, divisions] = await Promise.all([
						organizationService.listRoomsForTenant(
							scope.context,
							scope.festivalShortName,
						),
						repository.listFestivalClassConfigurations(
							scope.organizationId,
							scope.festival.id,
						),
						repository.listDivisions(scope.organizationId),
					]);
					return evaluateSchedulingConfigPreview(config, {
						rooms,
						catalogClasses,
						divisions,
					});
				}),
		);
}
