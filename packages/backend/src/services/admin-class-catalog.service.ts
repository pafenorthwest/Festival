import type { FestivalClassConfiguration } from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type {
	CreateFestivalClassInput,
	UpdateFestivalClassInput,
} from "./admin-class-catalog-types.js";
import {
	validateCreateClassInput,
	validateUpdateClassInput,
} from "./admin-class-catalog-validation.js";
import type { AdminClassShopifySync } from "./admin-class-shopify-sync.js";

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
		const subs = await repo.listRegistrationCatalogValues(
			orgId,
			"class_subtype",
		);
		if (!subs.some((s) => s.id === subtypeId)) {
			throw new AppError("Class subtype not found.", 404);
		}
	}
}

async function resolveProductGids(
	shopifySync: AdminClassShopifySync,
	orgId: string,
	festivalName: string,
	input: CreateFestivalClassInput,
	actorUid?: string,
): Promise<{ shopifyProductGid: string; shopifyVariantGid: string }> {
	if (input.shopifyProductGid && input.shopifyVariantGid) {
		return {
			shopifyProductGid: input.shopifyProductGid,
			shopifyVariantGid: input.shopifyVariantGid,
		};
	}
	const gids = await shopifySync.createClassProduct(
		orgId,
		festivalName,
		{ displayName: input.displayName, price: input.price },
		actorUid,
	);
	return {
		shopifyProductGid: input.shopifyProductGid ?? gids.shopifyProductGid,
		shopifyVariantGid: input.shopifyVariantGid ?? gids.shopifyVariantGid,
	};
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
	const classes = await repo.listFestivalClassConfigurations(
		orgId,
		festivalId,
		false,
	);
	const existing = classes.find((c) => c.id === classId);
	if (!existing) {
		throw new AppError("Festival class configuration not found.", 404);
	}
	return existing;
}

export class AdminClassCatalogService {
	constructor(
		readonly repository: OrganizationRepository,
		readonly shopifySync: AdminClassShopifySync,
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
			input.divisionId,
			input.classSubtypeId,
		);
		const gids = await resolveProductGids(
			this.shopifySync,
			org.id,
			festival.name,
			input,
			actorUid,
		);
		return this.repository.createFestivalClassConfiguration({
			...input,
			organizationId: org.id,
			festivalId: festival.id,
			maximumPerformancePieces: input.maximumPerformancePieces ?? 1,
			capacity: input.capacity ?? 100,
			shopifyProductGid: gids.shopifyProductGid,
			shopifyVariantGid: gids.shopifyVariantGid,
		});
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
		await validateClassReferences(
			this.repository,
			org.id,
			input.divisionId,
			input.classSubtypeId,
		);
		await syncShopifyUpdates(
			this.shopifySync,
			org.id,
			existing,
			input,
			actorUid,
		);
		return this.repository.updateFestivalClassConfiguration({
			...input,
			id: classId,
			organizationId: org.id,
			festivalId: festival.id,
		});
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
