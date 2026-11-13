import { sql } from "bun";
import type { CustomClaimsWriter } from "./auth/custom-claims.js";
import type { FirebaseClaimsReconciliationService } from "./auth/firebase-claims-reconciliation.js";
import type { AuthVerifier } from "./auth/types.js";
import type { BillingReconciliationService } from "./billing/billing-reconciliation-service.js";
import type { BillingRepository } from "./billing/billing-repository.js";
import type { CheckoutRecoveryRepository } from "./checkout/checkout-recovery-repository.js";
import type { CheckoutRecoveryService } from "./checkout/checkout-recovery-service.js";
import type { CheckoutRepository } from "./checkout/checkout-repository.js";
import type { ClassCheckoutService } from "./checkout/class-checkout-service.js";
import type { MembershipCheckoutService } from "./checkout/membership-checkout-service.js";
import type { ClassEntitlementRepository } from "./commerce/class-entitlement-repository.js";
import type { MembershipCommerceRepository } from "./commerce/membership-commerce-repository.js";
import type { MembershipStatusService } from "./commerce/membership-status-service.js";
import type { ShopifyOrderProjectionService } from "./commerce/shopify-order-projection-service.js";
import type { ShopifyWebhookService } from "./commerce/shopify-webhook-service.js";
import type { CommunicationRepository } from "./communication/communication-repository.js";
import type { CommunicationService } from "./communication/communication-service.js";
import { createAuthComposition } from "./composition/auth.js";
import {
	createCatalogRepertoireComposition,
	createRepertoireRepository,
} from "./composition/catalog-repertoire.js";
import {
	createClassCheckoutComposition,
	createClassCheckoutRepositories,
} from "./composition/class-checkout.js";
import { createCommerceProjectionComposition } from "./composition/commerce-projection.js";
import {
	createCustomerIdentityComposition,
	createCustomerIdentityRepositories,
} from "./composition/customer-identity.js";
import {
	bindDomainCacheInvalidators,
	buildRuntimeApp,
	type RuntimeDependencies,
} from "./composition/runtime.js";
import { createTeacherDirectoryComposition } from "./composition/teacher-directory.js";
import {
	createTenantOrgComposition,
	createTenantOrgRepositories,
} from "./composition/tenant-org.js";
import { createVolunteersCommsComposition } from "./composition/volunteers-comms.js";
import { type AppEnv, loadEnv } from "./config/env.js";
import type { CustomerAccountRepository } from "./customer/customer-account-repository.js";
import type { CustomerAccountService } from "./customer/customer-account-service.js";
import type { CustomerAvailabilityRepository } from "./customer/customer-availability-repository.js";
import type { CustomerAvailabilityService } from "./customer/customer-availability-service.js";
import { DomainCacheInvalidator } from "./lib/domain-cache-invalidator.js";
import type { DropTransferService } from "./registration/drop-transfer-service.js";
import type { RegistrationChangeRepository } from "./registration/registration-change-repository.js";
import type { RepertoireRepository } from "./repertoire/index.js";
import type { AppUserRepository } from "./repo/app-user-repository.js";
import type { OrganizationRepository } from "./repo/organization-repository.js";
import type { RoomRepository } from "./rooms/room-repository.js";
import type { AdminClassCatalogService } from "./services/admin-class-catalog.service.js";
import type { ParticipantProfileService } from "./services/participant-profile-service.js";
import type { PublicMembershipProductService } from "./shopify/public-membership-product-service.js";
import type { ShopifyIntegrationDiagnosticService } from "./shopify/shopify-integration-diagnostic-service.js";
import type { ShopifyIntegrationService } from "./shopify/shopify-integration-service.js";
import type { ShopifyMembershipProductService } from "./shopify/shopify-membership-product-service.js";
import type { VolunteerRepository } from "./volunteers/volunteer-repository.js";
import type { WaitlistRepository, WaitlistService } from "./waitlist/index.js";

export interface CreateAppOptions {
	env?: AppEnv;
	enableDropTransfer?: boolean;
	repository?: OrganizationRepository;
	appUserRepository?: AppUserRepository;
	authVerifier?: AuthVerifier;
	adminClassCatalogService?: AdminClassCatalogService;
	shopifyIntegrationService?: ShopifyIntegrationService;
	shopifyMembershipProductService?: ShopifyMembershipProductService;
	publicMembershipProductService?: PublicMembershipProductService;
	shopifyIntegrationDiagnosticService?: ShopifyIntegrationDiagnosticService;
	customerAccountRepository?: CustomerAccountRepository;
	customerAccountService?: CustomerAccountService;
	customerAvailabilityRepository?: CustomerAvailabilityRepository;
	customerAvailabilityService?: CustomerAvailabilityService;
	checkoutRepository?: CheckoutRepository;
	membershipCheckoutService?: MembershipCheckoutService;
	classCheckoutService?: ClassCheckoutService;
	commerceRepository?: MembershipCommerceRepository;
	shopifyOrderProjectionService?: ShopifyOrderProjectionService;
	shopifyWebhookService?: ShopifyWebhookService;
	membershipStatusService?: MembershipStatusService;
	volunteerRepository?: VolunteerRepository;
	repertoireRepository?: RepertoireRepository;
	checkoutRecoveryRepository?: CheckoutRecoveryRepository;
	checkoutRecoveryService?: CheckoutRecoveryService;
	customClaimsWriter?: CustomClaimsWriter;
	firebaseClaimsReconciliationService?: FirebaseClaimsReconciliationService;
	dropTransferService?: DropTransferService;
	registrationChangeRepository?: RegistrationChangeRepository;
	classEntitlementRepository?: ClassEntitlementRepository;
	billingRepository?: BillingRepository;
	billingReconciliationService?: BillingReconciliationService;
	communicationRepository?: CommunicationRepository;
	communicationService?: CommunicationService;
	roomRepository?: RoomRepository;
	participantProfileService?: ParticipantProfileService;
	waitlistRepository?: WaitlistRepository;
	waitlistService?: WaitlistService;
	cacheInvalidator?: DomainCacheInvalidator;
}

function resolveRuntimeEnv(options: CreateAppOptions): AppEnv {
	const env =
		options.env ??
		loadEnv({
			requireDatabase: !options.repository,
			requireFirebaseAdmin: !options.authVerifier,
		});
	if (options.enableDropTransfer !== undefined) {
		env.enableDropTransfer = options.enableDropTransfer;
	}
	if (env.databaseUrl) {
		process.env.DATABASE_URL = env.databaseUrl;
	}
	if (sql.options && env.databasePoolMax) {
		sql.options.max = env.databasePoolMax;
	}
	return env;
}

async function composeAppDependencies(
	options: CreateAppOptions,
	env: AppEnv,
): Promise<RuntimeDependencies> {
	const tenantOrgRepos = await createTenantOrgRepositories(options, env);
	const auth = createAuthComposition(options, env);
	const checkoutRepos = await createClassCheckoutRepositories(options, env);
	const customerRepos = await createCustomerIdentityRepositories(options, env);
	const repertoireRepository = await createRepertoireRepository(options, env);

	const commerceProjection = await createCommerceProjectionComposition({
		options,
		env,
		repository: tenantOrgRepos.repository,
		checkoutRepository: checkoutRepos.checkoutRepository,
		customerAccountRepository: customerRepos.customerAccountRepository,
	});
	const catalogRepertoire = await createCatalogRepertoireComposition({
		options,
		env,
		repository: tenantOrgRepos.repository,
		adminClassShopifySync: commerceProjection.adminClassShopifySync,
		commerceRepository: commerceProjection.commerceRepository,
		repertoireRepository,
	});
	const tenantOrg = createTenantOrgComposition({
		env,
		repositories: tenantOrgRepos,
		adminClassCatalogService: catalogRepertoire.adminClassCatalogService,
		commerceRepository: commerceProjection.commerceRepository,
	});
	const customerIdentity = createCustomerIdentityComposition({
		options,
		env,
		repositories: customerRepos,
		repository: tenantOrg.repository,
		secretKeyring: commerceProjection.secretKeyring,
		commerceRepository: commerceProjection.commerceRepository,
		checkoutRepository: checkoutRepos.checkoutRepository,
		repertoireRepository: catalogRepertoire.repertoireRepository,
	});
	const teacherDirectory = createTeacherDirectoryComposition({
		options,
		repository: tenantOrg.repository,
		commerceRepository: commerceProjection.commerceRepository,
	});
	const classCheckout = createClassCheckoutComposition({
		options,
		env,
		repositories: checkoutRepos,
		repository: tenantOrg.repository,
		customerAccountRepository: customerIdentity.customerAccountRepository,
		commerceRepository: commerceProjection.commerceRepository,
		classEntitlementRepository: commerceProjection.classEntitlementRepository,
		repertoireRepository: catalogRepertoire.repertoireRepository,
		secretKeyring: commerceProjection.secretKeyring,
		publicMembershipProductService:
			commerceProjection.publicMembershipProductService,
	});
	const volunteersComms = await createVolunteersCommsComposition(options, env);
	const cacheInvalidator =
		options.cacheInvalidator ?? new DomainCacheInvalidator();

	return {
		env,
		cacheInvalidator,
		auth,
		tenantOrg,
		catalogRepertoire,
		customerIdentity,
		teacherDirectory,
		commerceProjection,
		classCheckout,
		volunteersComms,
	};
}

export async function createApp(options: CreateAppOptions = {}) {
	const env = resolveRuntimeEnv(options);
	const deps = await composeAppDependencies(options, env);
	bindDomainCacheInvalidators(deps);
	return buildRuntimeApp(deps);
}
