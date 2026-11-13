import type { CreateAppOptions } from "../app.js";
import {
	type CheckoutRecoveryRepository,
	InMemoryCheckoutRecoveryRepository,
} from "../checkout/checkout-recovery-repository.js";
import { CheckoutRecoveryService } from "../checkout/checkout-recovery-service.js";
import {
	type CheckoutRepository,
	InMemoryCheckoutRepository,
} from "../checkout/checkout-repository.js";
import {
	ClassCheckoutService,
	consoleClassCheckoutFailureLogger,
} from "../checkout/class-checkout-service.js";
import { MembershipCheckoutService } from "../checkout/membership-checkout-service.js";
import { PostgresCheckoutRecoveryRepository } from "../checkout/postgres-checkout-recovery-repository.js";
import { PostgresCheckoutRepository } from "../checkout/postgres-checkout-repository.js";
import { ShopifyMembershipCheckoutClient } from "../checkout/shopify-membership-checkout-client.js";
import type { ClassEntitlementRepository } from "../commerce/class-entitlement-repository.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { AppEnv } from "../config/env.js";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import { DropTransferService } from "../registration/drop-transfer-service.js";
import {
	InMemoryRegistrationChangeRepository,
	PostgresRegistrationChangeRepository,
	type RegistrationChangeRepository,
} from "../registration/registration-change-repository.js";
import type { RepertoireRepository } from "../repertoire/index.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { ShopifySecretKeyring } from "../shopify/encryption.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import {
	InMemoryWaitlistRepository,
	PostgresWaitlistRepository,
	type WaitlistRepository,
	WaitlistService,
} from "../waitlist/index.js";

export interface ClassCheckoutRepositories {
	checkoutRepository: CheckoutRepository;
	registrationChangeRepository: RegistrationChangeRepository;
	checkoutRecoveryRepository: CheckoutRecoveryRepository;
	waitlistRepository: WaitlistRepository;
}

export interface ClassCheckoutComposition extends ClassCheckoutRepositories {
	membershipCheckoutService: MembershipCheckoutService | undefined;
	classCheckoutService: ClassCheckoutService | undefined;
	dropTransferService: DropTransferService | undefined;
	checkoutRecoveryService: CheckoutRecoveryService;
	waitlistService: WaitlistService | undefined;
}

export async function createClassCheckoutRepositories(
	options: CreateAppOptions,
	env: AppEnv,
): Promise<ClassCheckoutRepositories> {
	const checkoutRepository =
		options.checkoutRepository ??
		(env.databaseSchema
			? new PostgresCheckoutRepository(env.databaseSchema)
			: new InMemoryCheckoutRepository());
	if (checkoutRepository instanceof PostgresCheckoutRepository) {
		await checkoutRepository.ensureReady();
	}
	const registrationChangeRepository =
		options.registrationChangeRepository ??
		(env.databaseSchema
			? new PostgresRegistrationChangeRepository(env.databaseSchema)
			: new InMemoryRegistrationChangeRepository());
	if (
		registrationChangeRepository instanceof PostgresRegistrationChangeRepository
	) {
		await registrationChangeRepository.ensureReady();
	}
	const checkoutRecoveryRepository =
		options.checkoutRecoveryRepository ??
		(env.databaseSchema
			? new PostgresCheckoutRecoveryRepository(env.databaseSchema)
			: new InMemoryCheckoutRecoveryRepository());
	if (
		checkoutRecoveryRepository instanceof PostgresCheckoutRecoveryRepository
	) {
		await checkoutRecoveryRepository.ensureReady();
	}
	const waitlistRepository =
		options.waitlistRepository ??
		(env.databaseSchema
			? new PostgresWaitlistRepository(env.databaseSchema)
			: new InMemoryWaitlistRepository());
	if (waitlistRepository instanceof PostgresWaitlistRepository) {
		await waitlistRepository.ensureReady();
	}
	return {
		checkoutRepository,
		registrationChangeRepository,
		checkoutRecoveryRepository,
		waitlistRepository,
	};
}

function createCheckoutServices(params: {
	options: CreateAppOptions;
	repositories: ClassCheckoutRepositories;
	repository: OrganizationRepository;
	customerAccountRepository: CustomerAccountRepository | undefined;
	commerceRepository: MembershipCommerceRepository;
	repertoireRepository: RepertoireRepository;
	secretKeyring: ShopifySecretKeyring | undefined;
	publicMembershipProductService: PublicMembershipProductService;
}) {
	const {
		options,
		repositories,
		repository,
		customerAccountRepository,
		commerceRepository,
		repertoireRepository,
		secretKeyring,
		publicMembershipProductService,
	} = params;
	const { checkoutRepository, checkoutRecoveryRepository } = repositories;

	const membershipCheckoutService =
		options.membershipCheckoutService ??
		(secretKeyring
			? new MembershipCheckoutService(
					repository,
					publicMembershipProductService,
					checkoutRepository,
					new ShopifyMembershipCheckoutClient(repository, secretKeyring),
					commerceRepository,
				)
			: undefined);
	const classCheckoutService =
		options.classCheckoutService ??
		(secretKeyring && customerAccountRepository
			? new ClassCheckoutService(
					repository,
					customerAccountRepository,
					checkoutRepository,
					new ShopifyMembershipCheckoutClient(repository, secretKeyring),
					commerceRepository,
					undefined,
					consoleClassCheckoutFailureLogger,
					repertoireRepository,
				)
			: undefined);
	const checkoutRecoveryService =
		options.checkoutRecoveryService ??
		new CheckoutRecoveryService({
			recoveryRepository: checkoutRecoveryRepository,
			organizationRepository: repository,
			commerceRepository,
			checkoutRepository,
			storefront: secretKeyring
				? new ShopifyMembershipCheckoutClient(repository, secretKeyring)
				: undefined,
			listings: publicMembershipProductService,
		});
	return {
		membershipCheckoutService,
		classCheckoutService,
		checkoutRecoveryService,
	};
}

function createRegistrationServices(params: {
	options: CreateAppOptions;
	env: AppEnv;
	repositories: ClassCheckoutRepositories;
	repository: OrganizationRepository;
	customerAccountRepository: CustomerAccountRepository | undefined;
	commerceRepository: MembershipCommerceRepository;
	classEntitlementRepository: ClassEntitlementRepository;
}) {
	const {
		options,
		env,
		repositories,
		repository,
		customerAccountRepository,
		commerceRepository,
		classEntitlementRepository,
	} = params;
	const dropTransferService =
		options.dropTransferService !== undefined
			? options.dropTransferService
			: env.enableDropTransfer
				? new DropTransferService({
						entitlements: classEntitlementRepository,
						changes: repositories.registrationChangeRepository,
						classQuery: repository,
					})
				: undefined;
	const waitlistService =
		options.waitlistService ??
		(customerAccountRepository
			? new WaitlistService({
					waitlistRepo: repositories.waitlistRepository,
					orgRepo: repository,
					customerRepo: customerAccountRepository,
					entitlementCount: (orgId: string, classId: string) =>
						commerceRepository.countConfirmedClassEntitlements(orgId, classId),
					entitlementRepository: commerceRepository,
				})
			: undefined);
	return { dropTransferService, waitlistService };
}

export function createClassCheckoutComposition(params: {
	options: CreateAppOptions;
	env: AppEnv;
	repositories: ClassCheckoutRepositories;
	repository: OrganizationRepository;
	customerAccountRepository: CustomerAccountRepository | undefined;
	commerceRepository: MembershipCommerceRepository;
	classEntitlementRepository: ClassEntitlementRepository;
	repertoireRepository: RepertoireRepository;
	secretKeyring: ShopifySecretKeyring | undefined;
	publicMembershipProductService: PublicMembershipProductService;
}): ClassCheckoutComposition {
	const checkoutServices = createCheckoutServices(params);
	const registrationServices = createRegistrationServices(params);
	return {
		...params.repositories,
		...checkoutServices,
		...registrationServices,
	};
}
