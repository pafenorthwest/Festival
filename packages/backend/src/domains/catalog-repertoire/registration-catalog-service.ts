import { AppError, type FestivalClassConfiguration } from "@festival/common";
import {
	type AdminClassCatalogService,
	type ClassEntitlementCounter,
	type DomainCacheInvalidator,
	emitDomainInvalidation,
	type S09InvalidationSink,
	type TenantContext,
} from "../../infra/s09-infra.js";
import type { TenantRepository } from "../tenant-org/index.js";
import type {
	CreateFestivalClassConfigurationInput,
	RegistrationCatalogKind,
} from "./catalog-mappers.js";
import type { DivisionFestivalRepository } from "./division-festival-repository.js";
import type { RegistrationCatalogRepository } from "./registration-catalog-repository.js";
import {
	createCatalogValueImpl,
	createClassDirect,
	createFestivalSubtypeImpl,
	reorderCatalogValuesImpl,
	updateCatalogValueImpl,
	updateClassDirect,
} from "./registration-catalog-service-helpers.js";

/** Manages registration catalog values, festival subtypes, and festival class configurations. */
export class RegistrationCatalogService {
	private cacheInvalidator?: S09InvalidationSink | DomainCacheInvalidator;

	constructor(
		private readonly catalog: RegistrationCatalogRepository,
		private readonly divisionFestivals: DivisionFestivalRepository,
		private readonly tenants: TenantRepository,
		private readonly adminClassCatalogService?: AdminClassCatalogService,
		private readonly commerce?: ClassEntitlementCounter,
	) {}

	bindCacheInvalidator(
		invalidator: S09InvalidationSink | DomainCacheInvalidator,
	): void {
		this.cacheInvalidator = invalidator;
	}

	async listRegistrationCatalogConfiguration(
		organizationId: string,
		activeOnly = false,
	) {
		const [classSubtypes, instruments] = await Promise.all([
			this.catalog.listRegistrationCatalogValues(
				organizationId,
				"class_subtype",
				activeOnly,
			),
			this.catalog.listRegistrationCatalogValues(
				organizationId,
				"instrument",
				activeOnly,
			),
		]);
		return { classSubtypes, instruments };
	}

	async createRegistrationCatalogValueForTenant(
		tenant: TenantContext,
		kind: RegistrationCatalogKind,
		displayNameInput: unknown,
		requiredSubtypeId?: unknown,
	) {
		const created = await createCatalogValueImpl(
			this.catalog,
			tenant.organization.id,
			kind,
			displayNameInput,
			requiredSubtypeId,
		);
		this.emitUpdated(tenant.organization.id, tenant.organization.slug);
		return { value: created };
	}

	async updateRegistrationCatalogValueForTenant(
		tenant: TenantContext,
		kind: RegistrationCatalogKind,
		id: string,
		input: {
			displayName?: unknown;
			isActive?: unknown;
			requiredSubtypeId?: unknown;
		},
	) {
		const value = await updateCatalogValueImpl(
			this.catalog,
			tenant.organization.id,
			kind,
			id,
			input,
		);
		this.emitUpdated(tenant.organization.id, tenant.organization.slug);
		return { value };
	}

	async reorderRegistrationCatalogValuesForTenant(
		tenant: TenantContext,
		kind: RegistrationCatalogKind,
		ids: unknown,
	) {
		const values = await reorderCatalogValuesImpl(
			this.catalog,
			tenant.organization.id,
			kind,
			ids,
		);
		this.emitUpdated(tenant.organization.id, tenant.organization.slug);
		return { values };
	}

	async listFestivalClasses(
		orgSlug: string,
		festivalShortName: string,
	): Promise<FestivalClassConfiguration[]> {
		if (this.adminClassCatalogService) {
			return this.adminClassCatalogService.listClasses(
				orgSlug,
				festivalShortName,
			);
		}
		const { organization, festival } = await this.requireOrgAndFestival(
			orgSlug,
			festivalShortName,
		);
		return this.catalog.listFestivalClassConfigurations(
			organization.id,
			festival.id,
		);
	}

	async listFestivalClassSubtypesForTenant(
		tenant: TenantContext,
		festivalShortName: string,
	) {
		const festival = await this.divisionFestivals.findFestivalByShortName(
			tenant.organization.id,
			festivalShortName,
		);
		if (!festival) throw new AppError("Festival not found.", 404);
		return {
			classSubtypes: await this.catalog.listFestivalClassSubtypes(
				tenant.organization.id,
				festival.id,
			),
		};
	}

	async createFestivalClassSubtypeForTenant(
		tenant: TenantContext,
		festivalShortName: string,
		value: unknown,
		requiredSubtypeId?: unknown,
	) {
		const festival = await this.divisionFestivals.findFestivalByShortName(
			tenant.organization.id,
			festivalShortName,
		);
		if (!festival) throw new AppError("Festival not found.", 404);
		const created = await createFestivalSubtypeImpl(
			this.catalog,
			tenant.organization.id,
			festival.id,
			value,
			requiredSubtypeId,
		);
		this.emitUpdated(
			tenant.organization.id,
			tenant.organization.slug,
			festival.id,
		);
		return { value: created };
	}

	async createFestivalClass(
		orgSlug: string,
		festivalShortName: string,
		input: Omit<
			CreateFestivalClassConfigurationInput,
			"organizationId" | "festivalId"
		>,
		actorUid?: string,
	): Promise<FestivalClassConfiguration> {
		if (this.adminClassCatalogService) {
			const created = await this.adminClassCatalogService.createClass(
				orgSlug,
				festivalShortName,
				input,
				actorUid,
			);
			this.emitUpdated(created.organizationId, orgSlug, created.festivalId);
			return created;
		}
		const { organization, festival } = await this.requireOrgAndFestival(
			orgSlug,
			festivalShortName,
		);
		const created = await createClassDirect(
			this.catalog,
			this.divisionFestivals,
			organization.id,
			festival.id,
			input,
			actorUid,
		);
		this.emitUpdated(created.organizationId, orgSlug, created.festivalId);
		return created;
	}

	async updateFestivalClass(
		orgSlug: string,
		festivalShortName: string,
		classId: string,
		input: unknown,
		actorUid?: string,
	): Promise<FestivalClassConfiguration> {
		if (this.adminClassCatalogService) {
			const updated = await this.adminClassCatalogService.updateClass(
				orgSlug,
				festivalShortName,
				classId,
				input,
				actorUid,
			);
			this.emitUpdated(updated.organizationId, orgSlug, updated.festivalId);
			return updated;
		}
		const { organization, festival } = await this.requireOrgAndFestival(
			orgSlug,
			festivalShortName,
		);
		const updated = await updateClassDirect(
			this.catalog,
			this.commerce,
			organization.id,
			festival.id,
			classId,
			input,
			actorUid,
		);
		this.emitUpdated(updated.organizationId, orgSlug, updated.festivalId);
		return updated;
	}

	private async requireOrgAndFestival(
		orgSlug: string,
		festivalShortName: string,
	) {
		const organization = await this.tenants.findOrganizationBySlug(orgSlug);
		if (!organization) throw new AppError("Organization not found.", 404);
		const festival = await this.divisionFestivals.findFestivalByShortName(
			organization.id,
			festivalShortName,
		);
		if (!festival) throw new AppError("Festival not found.", 404);
		return { organization, festival };
	}

	private emitUpdated(
		organizationId: string,
		slug?: string,
		festivalId?: string,
	): void {
		emitDomainInvalidation(this.cacheInvalidator, {
			type: "FestivalCatalogUpdated",
			organizationId,
			slug,
			festivalId,
		});
	}
}
