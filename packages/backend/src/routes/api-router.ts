import { Hono } from "hono";
import type { CustomClaimsWriter } from "../auth/custom-claims.js";
import type { ApiVariables } from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import type { ClassCheckoutService } from "../checkout/class-checkout-service.js";
import type { MembershipCheckoutService } from "../checkout/membership-checkout-service.js";
import type { MembershipStatusService } from "../commerce/membership-status-service.js";
import type { CustomerAccountService } from "../customer/customer-account-service.js";
import type { AccompanistMembershipService } from "../services/accompanist-membership-service.js";
import type { OrganizationService } from "../services/organization-service.js";
import type { PublicMembershipProductService } from "../shopify/public-membership-product-service.js";
import type { ShopifyIntegrationDiagnosticService } from "../shopify/shopify-integration-diagnostic-service.js";
import type { ShopifyIntegrationService } from "../shopify/shopify-integration-service.js";
import type { ShopifyMembershipProductService } from "../shopify/shopify-membership-product-service.js";
import type { VolunteerRepository } from "../volunteers/volunteer-repository.js";
import { buildAdminOrgRoutes } from "./admin-org/admin-org.routes.js";
import { buildAdminRegistrationRoutes } from "./admin-registration/admin-registration.routes.js";
import { buildAdminShopifyRoutes } from "./admin-shopify/admin-shopify.routes.js";
import { buildCatalogRoutes } from "./catalog/catalog.routes.js";
import { buildCustomerRoutes } from "./customer/customer.routes.js";
import { buildCustomerChildrenRoutes } from "./customer/customer-children.routes.js";
import { buildCustomerMembershipRoutes } from "./customer/customer-membership.routes.js";
import { buildCustomerRegistrationRoutes } from "./customer/customer-registration.routes.js";
import { buildCustomerAuthRoutes } from "./customer-auth/customer-auth.routes.js";
import { buildIdentityRoutes } from "./identity/identity.routes.js";
import { buildOrgInfoRoutes } from "./org-info/org-info.routes.js";
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
		buildAdminRegistrationRoutes({ organizationService, authVerifier }),
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

	return router;
}
