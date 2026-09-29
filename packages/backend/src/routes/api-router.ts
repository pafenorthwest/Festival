import { Hono } from "hono";
import type { CustomClaimsWriter } from "../auth/custom-claims.js";
import type { ApiVariables } from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import { BillingReconciliationService } from "../billing/billing-reconciliation-service.js";
import { InMemoryBillingRepository } from "../billing/billing-repository.js";
import { InMemoryCheckoutRecoveryRepository } from "../checkout/checkout-recovery-repository.js";
import { CheckoutRecoveryService } from "../checkout/checkout-recovery-service.js";
import type { ClassCheckoutService } from "../checkout/class-checkout-service.js";
import type { MembershipCheckoutService } from "../checkout/membership-checkout-service.js";
import type { MembershipStatusService } from "../commerce/membership-status-service.js";
import type { CommunicationService } from "../communication/communication-service.js";
import type { CustomerAccountService } from "../customer/customer-account-service.js";
import type { DropTransferService } from "../registration/drop-transfer-service.js";
import type { RegistrationChangeRepository } from "../registration/registration-change-repository.js";
import type { RepertoireRepository } from "../repertoire/index.js";
import type { AccompanistMembershipService } from "../services/accompanist-membership-service.js";
import type { OrganizationService } from "../services/organization-service.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import type { ShopifyIntegrationDiagnosticService } from "../shopify/shopify-integration-diagnostic-service.js";
import type { ShopifyIntegrationService } from "../shopify/shopify-integration-service.js";
import type { ShopifyMembershipProductService } from "../shopify/shopify-membership-product-service.js";
import type { VolunteerRepository } from "../volunteers/volunteer-repository.js";
import { buildAdminBillingRoutes } from "./admin-billing.routes.js";
import { buildAdminCheckoutRecoveryRoutes } from "./admin-checkout-recovery.routes.js";
import { buildAdminOrgRoutes } from "./admin-org/admin-org.routes.js";
import { buildAdminRegistrationRoutes } from "./admin-registration/admin-registration.routes.js";
import { buildAdminShopifyRoutes } from "./admin-shopify/admin-shopify.routes.js";
import { buildCatalogRoutes } from "./catalog/catalog.routes.js";
import { buildCommunicationRoutes } from "./communication.routes.js";
import { buildCustomerRoutes } from "./customer/customer.routes.js";
import { buildCustomerChildrenRoutes } from "./customer/customer-children.routes.js";
import { buildCustomerMembershipRoutes } from "./customer/customer-membership.routes.js";
import { buildCustomerRegistrationRoutes } from "./customer/customer-registration.routes.js";
import { buildCustomerAuthRoutes } from "./customer-auth/customer-auth.routes.js";
import { buildCustomerCheckoutRecoveryRoutes } from "./customer-checkout-recovery.routes.js";
import { buildIdentityRoutes } from "./identity/identity.routes.js";
import { buildOrgInfoRoutes } from "./org-info/org-info.routes.js";
import { buildRepertoireRoutes } from "./repertoire.routes.js";
import { buildStaffRoutes } from "./staff/staff.routes.js";
import { buildVolunteerRoutes } from "./volunteers.routes.js";

export interface ApiRouterOptions {
	organizationService: OrganizationService;
	authVerifier: AuthVerifier;
	shopifyIntegrationService?: ShopifyIntegrationService;
	shopifyMembershipProductService?: ShopifyMembershipProductService;
	customerAccountService?: CustomerAccountService;
	publicMembershipProductService?: PublicMembershipProductService;
	shopifyIntegrationDiagnosticService?: ShopifyIntegrationDiagnosticService;
	membershipCheckoutService?: MembershipCheckoutService;
	membershipStatusService?: MembershipStatusService;
	accompanistMembershipService?: AccompanistMembershipService;
	volunteerRepository?: VolunteerRepository;
	classCheckoutService?: ClassCheckoutService;
	customClaimsWriter?: CustomClaimsWriter;
	repertoireRepository?: RepertoireRepository;
	dropTransferService?: DropTransferService;
	registrationChangeRepository?: RegistrationChangeRepository;
	billingReconciliationService?: BillingReconciliationService;
	communicationService?: CommunicationService;
	checkoutRecoveryService?: CheckoutRecoveryService;
}

export function buildApiRouter(
	options: ApiRouterOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const {
		organizationService,
		authVerifier,
		shopifyIntegrationService,
		shopifyMembershipProductService,
		customerAccountService,
		publicMembershipProductService,
		shopifyIntegrationDiagnosticService,
		membershipCheckoutService,
		membershipStatusService,
		accompanistMembershipService,
		volunteerRepository,
		classCheckoutService,
		customClaimsWriter,
		repertoireRepository,
		dropTransferService,
		registrationChangeRepository,
		billingReconciliationService,
		communicationService,
		checkoutRecoveryService: providedRecoveryService,
	} = options;
	const repository = organizationService.repository;

	router.route(
		"/",
		buildIdentityRoutes({
			organizationService,
			authVerifier,
			customClaimsWriter,
		}),
	);
	router.route("/", buildAdminOrgRoutes({ organizationService, authVerifier }));

	router.route(
		"/",
		buildAdminRegistrationRoutes({
			organizationService,
			authVerifier,
			dropTransferService,
			registrationChangeRepository,
		}),
	);
	router.route(
		"/",
		buildAdminShopifyRoutes({
			authVerifier,
			organizationService,
			shopifyIntegrationService,
			shopifyIntegrationDiagnosticService,
			shopifyMembershipProductService,
			customerAccountService,
		}),
	);
	const recoveryService =
		providedRecoveryService ??
		new CheckoutRecoveryService(
			new InMemoryCheckoutRecoveryRepository(),
			repository,
		);
	router.route(
		"/",
		buildAdminCheckoutRecoveryRoutes({
			authVerifier,
			repository,
			checkoutRecoveryService: recoveryService,
		}),
	);
	router.route(
		"/",
		buildCustomerCheckoutRecoveryRoutes({
			repository,
			customerAccountService,
			checkoutRecoveryService: recoveryService,
		}),
	);

	router.route(
		"/",
		buildCustomerAuthRoutes({
			customerAccountService,
			publicMembershipProductService,
		}),
	);

	router.route(
		"/organizations/:slug/customer",
		buildCustomerRoutes({ customerAccountService }),
	);
	router.route(
		"/organizations/:slug/customer",
		buildCustomerChildrenRoutes({ customerAccountService }),
	);
	router.route(
		"/organizations/:slug/customer",
		buildCustomerMembershipRoutes({
			customerAccountService,
			membershipCheckoutService,
			membershipStatusService,
			publicMembershipProductService,
			accompanistMembershipService,
			organizationService,
		}),
	);

	router.route(
		"/organizations/:slug/customer",
		buildCustomerRegistrationRoutes({
			customerAccountService,
			classCheckoutService,
			dropTransferService,
		}),
	);

	router.route(
		"/",
		buildStaffRoutes({
			repository,
			authVerifier,
			accompanistMembershipService,
		}),
	);

	router.route(
		"/organizations/:slug",
		buildCatalogRoutes({ publicMembershipProductService }),
	);

	router.route(
		"/organizations/:slug",
		buildOrgInfoRoutes({ organizationService, authVerifier, repository }),
	);

	router.route(
		"/organizations/:slug/festivals/:festivalShortName/volunteers",
		buildVolunteerRoutes({
			authVerifier,
			repository,
			volunteerRepository,
			customClaimsWriter,
		}),
	);

	router.route(
		"/organizations/:slug/repertoire",
		buildRepertoireRoutes({
			authVerifier,
			repository,
			repertoireRepository,
		}),
	);

	router.route(
		"/organizations/:slug/billing",
		buildAdminBillingRoutes({
			authVerifier,
			organizationService,
			repository,
			billingReconciliationService:
				billingReconciliationService ??
				new BillingReconciliationService(new InMemoryBillingRepository()),
		}),
	);

	router.route(
		"/organizations/:slug/communication",
		buildCommunicationRoutes({
			authVerifier,
			repository,
			communicationService,
		}),
	);

	return router;
}
