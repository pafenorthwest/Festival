import type { CreateAppOptions } from "../app.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { AppEnv } from "../config/env.js";
import type { AppUserRepository } from "../repo/app-user-repository.js";
import { InMemoryAppUserRepository } from "../repo/in-memory-app-user-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import { PostgresAppUserRepository } from "../repo/postgres-app-user-repository.js";
import { PostgresOrganizationRepository } from "../repo/postgres-organization-repository.js";
import { PostgresRoomRepository } from "../rooms/postgres-room-repository.js";
import {
	InMemoryRoomRepository,
	type RoomRepository,
} from "../rooms/room-repository.js";
import type { AdminClassCatalogService } from "../services/admin-class-catalog.service.js";
import { OrganizationService } from "../services/organization-service.js";

export interface TenantOrgRepositories {
	repository: OrganizationRepository;
	appUserRepository: AppUserRepository;
	roomRepository: RoomRepository;
}

export interface TenantOrgComposition extends TenantOrgRepositories {
	organizationService: OrganizationService;
}

export async function createTenantOrgRepositories(
	options: CreateAppOptions,
	env: AppEnv,
): Promise<TenantOrgRepositories> {
	const repository =
		options.repository ??
		new PostgresOrganizationRepository(
			env.databaseSchema ??
				(() => {
					throw new Error("DB_SCHEMA is required for the runtime repository.");
				})(),
		);
	await repository.ensureReady();

	const appUserRepository =
		options.appUserRepository ??
		(env.databaseSchema
			? new PostgresAppUserRepository(env.databaseSchema)
			: new InMemoryAppUserRepository());
	await appUserRepository.ensureReady();

	const roomRepository =
		options.roomRepository ??
		(env.databaseSchema
			? new PostgresRoomRepository(env.databaseSchema)
			: new InMemoryRoomRepository());
	if (roomRepository instanceof PostgresRoomRepository) {
		await roomRepository.ensureReady();
	}

	return { repository, appUserRepository, roomRepository };
}

export function createTenantOrgComposition(params: {
	env: AppEnv;
	repositories: TenantOrgRepositories;
	adminClassCatalogService: AdminClassCatalogService;
	commerceRepository: MembershipCommerceRepository;
}): TenantOrgComposition {
	const { env, repositories, adminClassCatalogService, commerceRepository } =
		params;
	const organizationService = new OrganizationService(
		repositories.repository,
		adminClassCatalogService,
		{ enableDropTransfer: Boolean(env.enableDropTransfer) },
		repositories.roomRepository,
		commerceRepository,
	);
	return { ...repositories, organizationService };
}
