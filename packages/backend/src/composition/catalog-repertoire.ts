import type { CreateAppOptions } from "../app.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { AppEnv } from "../config/env.js";
import {
	InMemoryRepertoireRepository,
	PostgresRepertoireRepository,
	type RepertoireRepository,
} from "../repertoire/index.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import { AdminClassCatalogService } from "../services/admin-class-catalog.service.js";
import type { AdminClassShopifySync } from "../services/admin-class-shopify-sync.js";

export interface CatalogRepertoireComposition {
	adminClassCatalogService: AdminClassCatalogService;
	repertoireRepository: RepertoireRepository;
}

export async function createRepertoireRepository(
	options: CreateAppOptions,
	env: AppEnv,
): Promise<RepertoireRepository> {
	const repertoireRepository =
		options.repertoireRepository ??
		(env.databaseSchema
			? new PostgresRepertoireRepository(env.databaseSchema)
			: new InMemoryRepertoireRepository());
	if (repertoireRepository instanceof PostgresRepertoireRepository) {
		await repertoireRepository.ensureReady();
	}
	return repertoireRepository;
}

export async function createCatalogRepertoireComposition(params: {
	options: CreateAppOptions;
	env: AppEnv;
	repository: OrganizationRepository;
	adminClassShopifySync: AdminClassShopifySync;
	commerceRepository: MembershipCommerceRepository;
	repertoireRepository?: RepertoireRepository;
}): Promise<CatalogRepertoireComposition> {
	const {
		options,
		env,
		repository,
		adminClassShopifySync,
		commerceRepository,
	} = params;
	const adminClassCatalogService =
		options.adminClassCatalogService ??
		new AdminClassCatalogService(
			repository,
			adminClassShopifySync,
			commerceRepository,
		);
	const repertoireRepository =
		params.repertoireRepository ??
		(await createRepertoireRepository(options, env));
	return { adminClassCatalogService, repertoireRepository };
}
