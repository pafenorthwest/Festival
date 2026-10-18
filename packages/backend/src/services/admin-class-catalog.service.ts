import {
	type ClassCapacityStatus,
	DEFAULT_FESTIVAL_CLASS_CAPACITY,
	evaluateClassCapacityStatus,
	type FestivalClassCapacityAuditRecord,
	type FestivalClassConfiguration,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { UpdateFestivalClassInput } from "./admin-class-catalog-types.js";
import {
	validateCreateClassInput,
	validateUpdateClassInput,
} from "./admin-class-catalog-validation.js";
import type { AdminClassShopifySync } from "./admin-class-shopify-sync.js";

export interface ClassCapacityCommerceSource {
	countConfirmedClassEntitlements(
		organizationId: string,
		festivalClassId: string,
	): Promise<number>;
}

async function resolveFestival(
	repo: OrganizationRepository,
	orgSlug: string,
	festivalShortName: string,
) {
	const org = await repo.findOrganizationBySlug(orgSlug);
	if (!org) throw new AppError("Organization not found.", 404);
	const festival = await repo.findFestivalByShortName(
		org.id,
		festivalShortName,
	);
	if (!festival) throw new AppError("Festival not found.", 404);
	return { org, festival };
}

async function validateClassReferences(
	repo: OrganizationRepository,
	orgId: string,
	festivalId: string,
	divisionId?: string,
	subtypeId?: string,
): Promise<void> {
	if (divisionId !== undefined) {
		const divs = await repo.listDivisions(orgId);
		if (!divs.some((d) => d.id === divisionId)) {
			throw new AppError("Division not found.", 404);
		}
	}
	if (subtypeId !== undefined) {
		const subs = await repo.listFestivalClassSubtypes(orgId, festivalId);
		if (!subs.some((s) => s.id === subtypeId)) {
			throw new AppError("Class subtype not found.", 404);
		}
	}
}

async function syncShopifyUpdates(
	shopifySync: AdminClassShopifySync,
	orgId: string,
	existing: FestivalClassConfiguration,
	input: UpdateFestivalClassInput,
	actorUid?: string,
): Promise<void> {
	if (input.price !== undefined && input.price !== existing.price) {
		await shopifySync.syncPrice(orgId, existing, input.price, actorUid);
	}
	if (input.isActive !== undefined && input.isActive !== existing.isActive) {
		await shopifySync.syncActiveStatus(
			orgId,
			existing,
			input.isActive,
			actorUid,
		);
	}
}

async function findExistingClass(
	repo: OrganizationRepository,
	orgId: string,
	festivalId: string,
	classId: string,
): Promise<FestivalClassConfiguration> {
	const existing = await repo.findFestivalClassConfigurationById(
		orgId,
		festivalId,
		classId,
	);
	if (!existing) {
		throw new AppError("Festival class not found.", 404);
	}
	return existing;
}

export class AdminClassCatalogService {
	constructor(
		readonly repository: OrganizationRepository,
		readonly shopifySync: AdminClassShopifySync,
		private readonly commerce?: ClassCapacityCommerceSource,
	) {}

	async listClasses(
		orgSlug: string,
		festivalShortName: string,
		includeInactive = true,
	): Promise<FestivalClassConfiguration[]> {
		const { org, festival } = await resolveFestival(
			this.repository,
			orgSlug,
			festivalShortName,
		);
		return this.repository.listFestivalClassConfigurations(
			org.id,
			festival.id,
			!includeInactive,
		);
	}

	async createClass(
		orgSlug: string,
		festivalShortName: string,
		rawInput: unknown,
		actorUid?: string,
	): Promise<FestivalClassConfiguration> {
		const { org, festival } = await resolveFestival(
			this.repository,
			orgSlug,
			festivalShortName,
		);
		const input = validateCreateClassInput(rawInput);
		await validateClassReferences(
			this.repository,
			org.id,
			festival.id,
			input.divisionId,
			input.classSubtypeId,
		);
		const gids = await this.shopifySync.syncNewClassProduct(
			org.id,
			festival,
			input,
			actorUid,
		);
		try {
			const created = await this.repository.createFestivalClassConfiguration({
				...input,
				organizationId: org.id,
				festivalId: festival.id,
				maximumPerformancePieces: input.maximumPerformancePieces ?? 1,
				capacity: input.capacity ?? DEFAULT_FESTIVAL_CLASS_CAPACITY,
				shopifyProductGid: gids.shopifyProductGid,
				shopifyVariantGid: gids.shopifyVariantGid,
			});
			await this.repository.recordFestivalClassCapacityAudit({
				organizationId: org.id,
				festivalId: festival.id,
				festivalClassId: created.id,
				actorUid: actorUid ?? null,
				previousCapacity: null,
				newCapacity: created.capacity,
				placedCountAtChange: 0,
				action: "class_created",
			});
			return created;
		} catch (error) {
			await this.shopifySync.tryCleanupProductGid(
				org.id,
				gids.shopifyProductGid,
				actorUid,
			);
			throw error;
		}
	}

	async updateClass(
		orgSlug: string,
		festivalShortName: string,
		classId: string,
		rawInput: unknown,
		actorUid?: string,
	): Promise<FestivalClassConfiguration> {
		const { org, festival } = await resolveFestival(
			this.repository,
			orgSlug,
			festivalShortName,
		);
		const existing = await findExistingClass(
			this.repository,
			org.id,
			festival.id,
			classId,
		);
		const input = validateUpdateClassInput(rawInput);
		const effectiveMin = input.minimumAge ?? existing.minimumAge;
		const effectiveMax = input.maximumAge ?? existing.maximumAge;
		if (effectiveMax < effectiveMin) {
			throw new AppError(
				"Maximum age must be greater than or equal to minimum age.",
				400,
			);
		}
		await syncShopifyUpdates(
			this.shopifySync,
			org.id,
			existing,
			input,
			actorUid,
		);
		const updated = await this.repository.updateFestivalClassConfiguration({
			...input,
			id: classId,
			organizationId: org.id,
			festivalId: festival.id,
		});
		if (input.capacity !== undefined && input.capacity !== existing.capacity) {
			const placedCount = this.commerce
				? await this.commerce.countConfirmedClassEntitlements(org.id, classId)
				: 0;
			await this.repository.recordFestivalClassCapacityAudit({
				organizationId: org.id,
				festivalId: festival.id,
				festivalClassId: classId,
				actorUid: actorUid ?? null,
				previousCapacity: existing.capacity,
				newCapacity: updated.capacity,
				placedCountAtChange: placedCount,
				action: "capacity_updated",
			});
		}
		return updated;
	}

	async getClassCapacityStatus(
		orgSlug: string,
		festivalShortName: string,
		classId: string,
	): Promise<ClassCapacityStatus> {
		const { org, festival } = await resolveFestival(
			this.repository,
			orgSlug,
			festivalShortName,
		);
		const existing = await findExistingClass(
			this.repository,
			org.id,
			festival.id,
			classId,
		);
		const placedCount = this.commerce
			? await this.commerce.countConfirmedClassEntitlements(org.id, classId)
			: 0;
		return evaluateClassCapacityStatus(existing.capacity, placedCount);
	}

	async listClassCapacityAudits(
		orgSlug: string,
		festivalShortName: string,
		classId: string,
	): Promise<FestivalClassCapacityAuditRecord[]> {
		const { org, festival } = await resolveFestival(
			this.repository,
			orgSlug,
			festivalShortName,
		);
		await findExistingClass(this.repository, org.id, festival.id, classId);
		return this.repository.listFestivalClassCapacityAudits(org.id, classId);
	}

	async deactivateClass(
		orgSlug: string,
		festivalShortName: string,
		classId: string,
		actorUid?: string,
	): Promise<FestivalClassConfiguration> {
		return this.updateClass(
			orgSlug,
			festivalShortName,
			classId,
			{ isActive: false },
			actorUid,
		);
	}

	async reactivateClass(
		orgSlug: string,
		festivalShortName: string,
		classId: string,
		actorUid?: string,
	): Promise<FestivalClassConfiguration> {
		return this.updateClass(
			orgSlug,
			festivalShortName,
			classId,
			{ isActive: true },
			actorUid,
		);
	}
}
