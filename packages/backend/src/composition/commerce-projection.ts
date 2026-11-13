import type { CreateAppOptions } from "../app.js";
import { BillingReconciliationService } from "../billing/billing-reconciliation-service.js";
import {
	type BillingRepository,
	InMemoryBillingRepository,
} from "../billing/billing-repository.js";
import { PostgresBillingRepository } from "../billing/postgres-billing-repository.js";
import type { CheckoutRepository } from "../checkout/checkout-repository.js";
import {
	type ClassEntitlementRepository,
	InMemoryClassEntitlementRepository,
	PostgresClassEntitlementRepository,
} from "../commerce/class-entitlement-repository.js";
import {
	InMemoryMembershipCommerceRepository,
	type MembershipCommerceRepository,
} from "../commerce/membership-commerce-repository.js";
import { PostgresMembershipCommerceRepository } from "../commerce/postgres-membership-commerce-repository.js";
import { ShopifyOrderProjectionService } from "../commerce/shopify-order-projection-service.js";
import { ShopifyWebhookService } from "../commerce/shopify-webhook-service.js";
import type { AppEnv } from "../config/env.js";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import { AdminClassShopifySync } from "../services/admin-class-shopify-sync.js";
import { ShopifyAdminApiClient } from "../shopify/admin-api-client.js";
import { FileShopifyMutationAuditWriter } from "../shopify/admin-mutation-audit.js";
import { ShopifySecretKeyring } from "../shopify/encryption.js";
import { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import { ShopifyIntegrationDiagnosticService } from "../shopify/shopify-integration-diagnostic-service.js";
import {
	ShopifyIntegrationService as DefaultShopifyIntegrationService,
	type ShopifyIntegrationService,
} from "../shopify/shopify-integration-service.js";
import { ShopifyMembershipProductService } from "../shopify/shopify-membership-product-service.js";
import { ShopifyProductLifecycleService } from "../shopify/shopify-product-lifecycle-service.js";
import { TokenlessShopifyPublicCatalogClient } from "../shopify/shopify-public-catalog-client.js";
import { ShopifyWebhookSubscriptionService } from "../shopify/shopify-webhook-subscription-service.js";

interface ShopifyInfra {
	shopifyAdminApiClient: ShopifyAdminApiClient;
	shopifyMutationAuditWriter: FileShopifyMutationAuditWriter;
	shopifyLifecycleService: ShopifyProductLifecycleService;
	secretKeyring: ShopifySecretKeyring | undefined;
	adminClassShopifySync: AdminClassShopifySync;
	shopifyPublicCatalogClient: TokenlessShopifyPublicCatalogClient;
}

export interface CommerceProjectionComposition {
	secretKeyring: ShopifySecretKeyring | undefined;
	adminClassShopifySync: AdminClassShopifySync;
	commerceRepository: MembershipCommerceRepository;
	shopifyIntegrationService: ShopifyIntegrationService | undefined;
	shopifyMembershipProductService: ShopifyMembershipProductService | undefined;
	publicMembershipProductService: PublicMembershipProductService;
	shopifyIntegrationDiagnosticService: ShopifyIntegrationDiagnosticService;
	shopifyOrderProjectionService: ShopifyOrderProjectionService;
	shopifyWebhookService: ShopifyWebhookService;
	classEntitlementRepository: ClassEntitlementRepository;
	billingRepository: BillingRepository;
	billingReconciliationService: BillingReconciliationService;
}

function createShopifyInfra(
	env: AppEnv,
	repository: OrganizationRepository,
): ShopifyInfra {
	const shopifyAdminApiClient = new ShopifyAdminApiClient();
	const shopifyMutationAuditWriter = new FileShopifyMutationAuditWriter(
		env.shopifyAdminAuditPath,
	);
	const shopifyLifecycleService = new ShopifyProductLifecycleService(
		shopifyAdminApiClient,
		shopifyMutationAuditWriter,
	);
	const secretKeyring = ShopifySecretKeyring.fromEnvironment(
		env.festivalSecretKeysJson,
		env.festivalActiveSecretKeyId,
	);
	const adminClassShopifySync = new AdminClassShopifySync(
		repository,
		shopifyLifecycleService,
		secretKeyring ?? undefined,
	);
	const shopifyPublicCatalogClient = new TokenlessShopifyPublicCatalogClient();
	return {
		shopifyAdminApiClient,
		shopifyMutationAuditWriter,
		shopifyLifecycleService,
		secretKeyring,
		adminClassShopifySync,
		shopifyPublicCatalogClient,
	};
}

function createShopifyCatalogServices(
	options: CreateAppOptions,
	env: AppEnv,
	repository: OrganizationRepository,
	infra: ShopifyInfra,
) {
	const {
		shopifyAdminApiClient,
		shopifyMutationAuditWriter,
		shopifyLifecycleService,
		secretKeyring,
		shopifyPublicCatalogClient,
	} = infra;
	const shopifyWebhookSubscriptionService = secretKeyring
		? new ShopifyWebhookSubscriptionService(
				repository,
				secretKeyring,
				shopifyAdminApiClient,
				env.publicOrigin,
			)
		: undefined;
	const shopifyIntegrationService =
		options.shopifyIntegrationService ??
		(secretKeyring
			? new DefaultShopifyIntegrationService(
					repository,
					secretKeyring,
					shopifyAdminApiClient,
					shopifyWebhookSubscriptionService,
				)
			: undefined);
	const shopifyMembershipProductService =
		options.shopifyMembershipProductService ??
		(secretKeyring
			? new ShopifyMembershipProductService(
					repository,
					secretKeyring,
					shopifyAdminApiClient,
					shopifyMutationAuditWriter,
					undefined,
					shopifyLifecycleService,
				)
			: undefined);
	const publicMembershipProductService =
		options.publicMembershipProductService ??
		new PublicMembershipProductService(
			repository,
			shopifyPublicCatalogClient,
			secretKeyring ?? undefined,
		);
	const shopifyIntegrationDiagnosticService =
		options.shopifyIntegrationDiagnosticService ??
		new ShopifyIntegrationDiagnosticService(
			repository,
			shopifyPublicCatalogClient,
			secretKeyring ?? undefined,
			shopifyWebhookSubscriptionService,
		);
	return {
		shopifyIntegrationService,
		shopifyMembershipProductService,
		publicMembershipProductService,
		shopifyIntegrationDiagnosticService,
	};
}

async function createBillingAndEntitlementRepos(
	options: CreateAppOptions,
	env: AppEnv,
) {
	const classEntitlementRepository =
		options.classEntitlementRepository ??
		(env.databaseSchema
			? new PostgresClassEntitlementRepository(env.databaseSchema)
			: new InMemoryClassEntitlementRepository());
	if (
		classEntitlementRepository instanceof PostgresClassEntitlementRepository
	) {
		await classEntitlementRepository.ensureReady();
	}
	const billingRepository =
		options.billingRepository ??
		(env.databaseSchema
			? new PostgresBillingRepository(env.databaseSchema)
			: new InMemoryBillingRepository());
	if (billingRepository instanceof PostgresBillingRepository) {
		await billingRepository.ensureReady();
	}
	const billingReconciliationService =
		options.billingReconciliationService ??
		new BillingReconciliationService(billingRepository);
	return {
		classEntitlementRepository,
		billingRepository,
		billingReconciliationService,
	};
}

export async function createCommerceProjectionComposition(params: {
	options: CreateAppOptions;
	env: AppEnv;
	repository: OrganizationRepository;
	checkoutRepository: CheckoutRepository;
	customerAccountRepository: CustomerAccountRepository | undefined;
}): Promise<CommerceProjectionComposition> {
	const {
		options,
		env,
		repository,
		checkoutRepository,
		customerAccountRepository,
	} = params;
	const infra = createShopifyInfra(env, repository);
	const commerceRepository =
		options.commerceRepository ??
		(env.databaseSchema
			? new PostgresMembershipCommerceRepository(env.databaseSchema)
			: new InMemoryMembershipCommerceRepository(
					repository,
					checkoutRepository,
				));
	await commerceRepository.ensureReady();

	const catalogServices = createShopifyCatalogServices(
		options,
		env,
		repository,
		infra,
	);
	const shopifyOrderProjectionService =
		options.shopifyOrderProjectionService ??
		new ShopifyOrderProjectionService(
			repository,
			checkoutRepository,
			commerceRepository,
			infra.shopifyAdminApiClient,
			infra.secretKeyring,
			customerAccountRepository,
		);
	const shopifyWebhookService =
		options.shopifyWebhookService ??
		new ShopifyWebhookService(
			repository,
			commerceRepository,
			infra.secretKeyring,
			shopifyOrderProjectionService,
		);
	const billingAndEntitlements = await createBillingAndEntitlementRepos(
		options,
		env,
	);

	return {
		secretKeyring: infra.secretKeyring,
		adminClassShopifySync: infra.adminClassShopifySync,
		commerceRepository,
		...catalogServices,
		shopifyOrderProjectionService,
		shopifyWebhookService,
		...billingAndEntitlements,
	};
}
