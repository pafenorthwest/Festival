import { Hono } from "hono";
import { BillingReconciliationService } from "../billing/billing-reconciliation-service.js";
import { InMemoryBillingRepository } from "../billing/billing-repository.js";
import { InMemoryCheckoutRecoveryRepository } from "../checkout/checkout-recovery-repository.js";
import { CheckoutRecoveryService } from "../checkout/checkout-recovery-service.js";
import {
	ADMIN_BILLING_ROUTE_SECURITY,
	buildAdminBillingRoutes,
} from "./admin-billing.routes.js";
import {
	ADMIN_CHECKOUT_RECOVERY_ROUTE_SECURITY,
	buildAdminCheckoutRecoveryRoutes,
} from "./admin-checkout-recovery.routes.js";
import {
	ADMIN_CLASS_CHECKOUT_RECOVERY_ROUTE_SECURITY,
	buildAdminClassCheckoutRecoveryRoutes,
} from "./admin-class-checkout-recovery.routes.js";
import {
	ADMIN_ENTITLEMENTS_ROUTE_SECURITY,
	buildAdminEntitlementsRoutes,
} from "./admin-entitlements.routes.js";
import {
	ADMIN_SHOPIFY_ROUTE_SECURITY,
	buildAdminShopifyRoutes,
} from "./admin-shopify/admin-shopify.routes.js";
import {
	buildCustomerMembershipRoutes,
	CUSTOMER_MEMBERSHIP_ROUTE_SECURITY,
} from "./customer/customer-membership.routes.js";
import {
	buildCustomerCheckoutRecoveryRoutes,
	CUSTOMER_CHECKOUT_RECOVERY_ROUTE_SECURITY,
} from "./customer-checkout-recovery.routes.js";
import type { ApiEnv, ApiRouterOptions } from "./route-group-options.js";
import {
	type CoLocatedRouteSecurity,
	withRouteSecurity,
} from "./shared/route-security-metadata.js";

export const COMMERCE_GROUP_ROUTE_SECURITY = [
	...ADMIN_SHOPIFY_ROUTE_SECURITY,
	...ADMIN_ENTITLEMENTS_ROUTE_SECURITY,
	...withRouteSecurity(
		"/organizations/:slug/billing",
		ADMIN_BILLING_ROUTE_SECURITY,
	),
	...ADMIN_CHECKOUT_RECOVERY_ROUTE_SECURITY,
	...ADMIN_CLASS_CHECKOUT_RECOVERY_ROUTE_SECURITY,
	...withRouteSecurity(
		"/organizations/:slug/customer",
		CUSTOMER_MEMBERSHIP_ROUTE_SECURITY,
	),
	...CUSTOMER_CHECKOUT_RECOVERY_ROUTE_SECURITY,
] as const satisfies readonly CoLocatedRouteSecurity[];

function resolveRecoveryService(options: ApiRouterOptions) {
	return (
		options.checkoutRecoveryService ??
		new CheckoutRecoveryService(
			new InMemoryCheckoutRecoveryRepository(),
			options.organizationService.repository,
		)
	);
}

function buildAdminCommerceSubRoutes(options: ApiRouterOptions) {
	const repository = options.organizationService.repository;
	const recoveryService = resolveRecoveryService(options);
	const billingService =
		options.billingReconciliationService ??
		new BillingReconciliationService(new InMemoryBillingRepository());

	return new Hono<ApiEnv>()
		.route(
			"/",
			buildAdminShopifyRoutes({
				authVerifier: options.authVerifier,
				organizationService: options.organizationService,
				shopifyIntegrationService: options.shopifyIntegrationService,
				shopifyIntegrationDiagnosticService:
					options.shopifyIntegrationDiagnosticService,
				shopifyMembershipProductService:
					options.shopifyMembershipProductService,
				customerAccountService: options.customerAccountService,
			}),
		)
		.route(
			"/",
			buildAdminEntitlementsRoutes({
				authVerifier: options.authVerifier,
				repository,
				accompanistMembershipService: options.accompanistMembershipService,
				commerceRepository: options.commerceRepository,
				checkoutRepository: options.checkoutRepository,
				shopifyOrderProjectionService: options.shopifyOrderProjectionService,
			}),
		)
		.route(
			"/organizations/:slug/billing",
			buildAdminBillingRoutes({
				authVerifier: options.authVerifier,
				organizationService: options.organizationService,
				repository,
				billingReconciliationService: billingService,
			}),
		)
		.route(
			"/",
			buildAdminCheckoutRecoveryRoutes({
				authVerifier: options.authVerifier,
				repository,
				checkoutRecoveryService: recoveryService,
			}),
		)
		.route(
			"/",
			buildAdminClassCheckoutRecoveryRoutes({
				authVerifier: options.authVerifier,
				repository,
				classCheckoutService: options.classCheckoutService,
				publicOrigin: options.publicOrigin,
			}),
		);
}

export function buildCommerceGroupRoutes(options: ApiRouterOptions) {
	const repository = options.organizationService.repository;
	const recoveryService = resolveRecoveryService(options);

	return new Hono<ApiEnv>()
		.route("/", buildAdminCommerceSubRoutes(options))
		.route(
			"/organizations/:slug/customer",
			buildCustomerMembershipRoutes({
				customerAccountService: options.customerAccountService,
				membershipCheckoutService: options.membershipCheckoutService,
				membershipStatusService: options.membershipStatusService,
				publicMembershipProductService: options.publicMembershipProductService,
				accompanistMembershipService: options.accompanistMembershipService,
				organizationService: options.organizationService,
			}),
		)
		.route(
			"/",
			buildCustomerCheckoutRecoveryRoutes({
				repository,
				customerAccountService: options.customerAccountService,
				checkoutRecoveryService: recoveryService,
			}),
		);
}

export type CommerceRoutesType = ReturnType<typeof buildCommerceGroupRoutes>;
