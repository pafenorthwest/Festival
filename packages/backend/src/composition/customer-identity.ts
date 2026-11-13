import type { CreateAppOptions } from "../app.js";
import type { CheckoutRepository } from "../checkout/checkout-repository.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { AppEnv } from "../config/env.js";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import { CustomerAccountService } from "../customer/customer-account-service.js";
import {
	type CustomerAvailabilityRepository,
	InMemoryCustomerAvailabilityRepository,
	PostgresCustomerAvailabilityRepository,
} from "../customer/customer-availability-repository.js";
import { CustomerAvailabilityService } from "../customer/customer-availability-service.js";
import { PostgresCustomerAccountRepository } from "../customer/postgres-customer-account-repository.js";
import type { RepertoireRepository } from "../repertoire/index.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import { ParticipantProfileService } from "../services/participant-profile-service.js";
import type { ShopifySecretKeyring } from "../shopify/encryption.js";

export interface CustomerIdentityRepositories {
	customerAccountRepository: CustomerAccountRepository | undefined;
	customerAvailabilityRepository: CustomerAvailabilityRepository;
}

export interface CustomerIdentityComposition
	extends CustomerIdentityRepositories {
	customerAccountService: CustomerAccountService | undefined;
	customerAvailabilityService: CustomerAvailabilityService | undefined;
	participantProfileService: ParticipantProfileService;
}

export async function createCustomerIdentityRepositories(
	options: CreateAppOptions,
	env: AppEnv,
): Promise<CustomerIdentityRepositories> {
	const customerAccountRepository =
		options.customerAccountRepository ??
		(env.databaseSchema
			? new PostgresCustomerAccountRepository(env.databaseSchema)
			: undefined);
	if (customerAccountRepository) {
		await customerAccountRepository.ensureReady();
	}

	const customerAvailabilityRepository =
		options.customerAvailabilityRepository ??
		(env.databaseSchema
			? new PostgresCustomerAvailabilityRepository(env.databaseSchema)
			: new InMemoryCustomerAvailabilityRepository());
	if (
		customerAvailabilityRepository instanceof
		PostgresCustomerAvailabilityRepository
	) {
		await customerAvailabilityRepository.ensureReady();
	}

	return { customerAccountRepository, customerAvailabilityRepository };
}

function buildCustomerAccountServiceOptions(env: AppEnv, publicOrigin: string) {
	const maxTotal = env.customerCacheMaxTotalBytes ?? 16 * 1_024 * 1_024;
	return {
		publicOrigin,
		idleDays: env.customerSessionIdleDays,
		absoluteDays: env.customerSessionAbsoluteDays,
		transportOptions: {
			dnsMaxEntries: env.customerDnsCacheMaxEntries,
			dnsTtlMs: (env.customerDnsCacheTtlSeconds ?? 60) * 1_000,
			maxEntryBytes: env.customerCacheMaxEntryBytes,
			maxTotalBytes: Math.floor(maxTotal / 4),
		},
		discoveryCacheMaxEntries: env.customerDiscoveryCacheMaxEntries,
		discoveryCacheTtlMs: (env.customerDiscoveryCacheTtlSeconds ?? 300) * 1_000,
		discoveryCacheMaxTotalBytes: Math.floor(maxTotal / 4),
		jwksCacheMaxEntries: env.customerJwksCacheMaxEntries,
		jwksCacheTtlMs: (env.customerJwksCacheTtlSeconds ?? 300) * 1_000,
		jwksCacheMaxTotalBytes: Math.floor(maxTotal / 2),
		cacheMaxEntryBytes: env.customerCacheMaxEntryBytes,
	};
}

export function createCustomerIdentityComposition(params: {
	options: CreateAppOptions;
	env: AppEnv;
	repositories: CustomerIdentityRepositories;
	repository: OrganizationRepository;
	secretKeyring: ShopifySecretKeyring | undefined;
	commerceRepository: MembershipCommerceRepository;
	checkoutRepository: CheckoutRepository;
	repertoireRepository: RepertoireRepository;
}): CustomerIdentityComposition {
	const {
		options,
		env,
		repositories,
		repository,
		secretKeyring,
		commerceRepository,
		checkoutRepository,
		repertoireRepository,
	} = params;
	const { customerAccountRepository, customerAvailabilityRepository } =
		repositories;

	const customerAccountService =
		options.customerAccountService ??
		(secretKeyring && customerAccountRepository && env.publicOrigin
			? new CustomerAccountService(
					customerAccountRepository,
					repository,
					secretKeyring,
					buildCustomerAccountServiceOptions(env, env.publicOrigin),
					commerceRepository,
					checkoutRepository,
					repertoireRepository,
				)
			: undefined);

	const customerAvailabilityService =
		options.customerAvailabilityService ??
		(customerAccountRepository && customerAccountService
			? new CustomerAvailabilityService(
					customerAvailabilityRepository,
					repository,
					customerAccountRepository,
					customerAccountService,
				)
			: undefined);

	const participantProfileService =
		options.participantProfileService ??
		new ParticipantProfileService(repository, customerAccountService);

	return {
		customerAccountRepository,
		customerAccountService,
		customerAvailabilityRepository,
		customerAvailabilityService,
		participantProfileService,
	};
}
