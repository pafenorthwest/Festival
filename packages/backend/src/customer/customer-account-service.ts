import type {
	ClassRegistrationMetadata,
	CustomerClassEntitlementSummary,
	CustomerClassRegistrationItem,
	CustomerClassRegistrationMetadataSummary,
	CustomerClassRegistrationsResponse,
	CustomerFestivalClassSummary,
} from "@festival/common";
import type { CheckoutRepository } from "../checkout/checkout-repository.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import {
	CUSTOMER_SESSION_COOKIE,
	CustomerChildProfileService,
	CustomerOAuthSessionService,
	type CustomerOAuthSessionServiceOptions,
	CustomerProfileService,
} from "../domains/customer-identity/index.js";
import type { CacheMetrics } from "../lib/bounded-async-cache.js";
import type { DomainCacheInvalidator } from "../lib/domain-cache-invalidator.js";
import type { RepertoireRepository } from "../repertoire/repertoire-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { ShopifySecretKeyring } from "../shopify/encryption.js";
import type { CustomerAccountRepository } from "./customer-account-repository.js";
import { CustomerRegistrationLegacyHelper } from "./customer-registration-legacy-helper.js";

export type {
	CustomerClassEntitlementSummary,
	CustomerClassRegistrationItem,
	CustomerClassRegistrationMetadataSummary,
	CustomerClassRegistrationsResponse,
	CustomerFestivalClassSummary,
};
export { CUSTOMER_SESSION_COOKIE };

export interface CustomerAccountServiceOptions
	extends CustomerOAuthSessionServiceOptions {
	repertoire?: RepertoireRepository;
}

/** Thin delegating facade preserving legacy CustomerAccountService API until S14. */
export class CustomerAccountService {
	readonly oauth: CustomerOAuthSessionService;
	readonly profiles: CustomerProfileService;
	readonly children: CustomerChildProfileService;
	private readonly legacyRegistration: CustomerRegistrationLegacyHelper;

	constructor(
		repository: CustomerAccountRepository,
		organizations: OrganizationRepository,
		keyring: ShopifySecretKeyring,
		options: CustomerAccountServiceOptions,
		commerce?: MembershipCommerceRepository,
		checkout?: CheckoutRepository,
		repertoire?: RepertoireRepository,
	) {
		this.oauth = new CustomerOAuthSessionService(
			{
				integrations: repository,
				sessions: repository,
				profiles: repository,
				organizations,
				keyring,
			},
			options,
		);
		this.profiles = new CustomerProfileService(
			repository,
			this.oauth,
			repository,
		);
		this.children = new CustomerChildProfileService(
			repository,
			organizations,
			this.oauth,
		);
		this.legacyRegistration = new CustomerRegistrationLegacyHelper(
			repository,
			organizations,
			{
				validateSession: (slug, token) => this.validateSession(slug, token),
				loadOrganizationBySlug: (slug) =>
					this.oauth.loadOrganizationBySlug(slug),
				checkoutAccess: (slug, sessionId, csrf, origin) =>
					this.checkoutAccess(slug, sessionId, csrf, origin),
				customerReadAccess: (slug, sessionId) =>
					this.customerReadAccess(slug, sessionId),
				now: () => this.oauth.now(),
			},
			this.children,
			{ commerce, checkout, repertoire: repertoire ?? options.repertoire },
		);
	}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.oauth.bindCacheInvalidator(invalidator);
		this.children.bindCacheInvalidator(invalidator);
	}

	cacheMetrics(): {
		dns: CacheMetrics;
		discovery: CacheMetrics;
		jwks: CacheMetrics;
		organizationBySlug: CacheMetrics;
		registrationAgeConfig: CacheMetrics;
	} {
		return {
			...this.oauth.cacheMetrics(),
			registrationAgeConfig: this.children.registrationAgeConfigMetrics(),
		};
	}

	getSettings = (
		...args: Parameters<CustomerOAuthSessionService["getSettings"]>
	) => this.oauth.getSettings(...args);
	saveAndVerify = (
		...args: Parameters<CustomerOAuthSessionService["saveAndVerify"]>
	) => this.oauth.saveAndVerify(...args);
	start = (...args: Parameters<CustomerOAuthSessionService["start"]>) =>
		this.oauth.start(...args);
	callback = (...args: Parameters<CustomerOAuthSessionService["callback"]>) =>
		this.oauth.callback(...args);
	authenticationFailure = (
		...args: Parameters<CustomerOAuthSessionService["authenticationFailure"]>
	) => this.oauth.authenticationFailure(...args);
	session = (...args: Parameters<CustomerOAuthSessionService["session"]>) =>
		this.oauth.session(...args);
	checkoutAccess = (
		...args: Parameters<CustomerOAuthSessionService["checkoutAccess"]>
	) => this.oauth.checkoutAccess(...args);
	customerSession = (
		...args: Parameters<CustomerOAuthSessionService["customerSession"]>
	) => this.oauth.customerSession(...args);
	formAccess = (
		...args: Parameters<CustomerOAuthSessionService["formAccess"]>
	) => this.oauth.formAccess(...args);
	customerReadAccess = (
		...args: Parameters<CustomerOAuthSessionService["customerReadAccess"]>
	) => this.oauth.customerReadAccess(...args);
	customerCheckoutSession = (
		...args: Parameters<CustomerOAuthSessionService["customerCheckoutSession"]>
	) => this.oauth.customerCheckoutSession(...args);
	validateSession = (
		...args: Parameters<CustomerOAuthSessionService["validateSession"]>
	) => this.oauth.validateSession(...args);
	orders = (...args: Parameters<CustomerOAuthSessionService["orders"]>) =>
		this.oauth.orders(...args);
	logout = (...args: Parameters<CustomerOAuthSessionService["logout"]>) =>
		this.oauth.logout(...args);
	recordCheckoutStaffAccessConsent = (
		...args: Parameters<
			CustomerProfileService["recordCheckoutStaffAccessConsent"]
		>
	) => this.profiles.recordCheckoutStaffAccessConsent(...args);
	customerProfile = (
		...args: Parameters<CustomerProfileService["customerProfile"]>
	) => this.profiles.customerProfile(...args);
	updateCustomerProfile = (
		...args: Parameters<CustomerProfileService["updateCustomerProfile"]>
	) => this.profiles.updateCustomerProfile(...args);
	recordStaffAccessConsent = (
		...args: Parameters<CustomerProfileService["recordStaffAccessConsent"]>
	) => this.profiles.recordStaffAccessConsent(...args);
	adminCustomerProfile = (
		...args: Parameters<CustomerProfileService["adminCustomerProfile"]>
	) => this.profiles.adminCustomerProfile(...args);
	findAdminCustomerProfile = (
		...args: Parameters<CustomerProfileService["findAdminCustomerProfile"]>
	) => this.profiles.findAdminCustomerProfile(...args);
	searchAdminCustomers = (
		...args: Parameters<CustomerProfileService["searchAdminCustomers"]>
	) => this.profiles.searchAdminCustomers(...args);
	listChildren = (
		...args: Parameters<CustomerChildProfileService["listChildren"]>
	) => this.children.listChildren(...args);
	createChild = (
		...args: Parameters<CustomerChildProfileService["createChild"]>
	) => this.children.createChild(...args);
	refreshChildAgeSnapshot = (
		...args: Parameters<CustomerChildProfileService["refreshChildAgeSnapshot"]>
	) => this.children.refreshChildAgeSnapshot(...args);
	listClassRegistrations = (
		...args: Parameters<
			CustomerRegistrationLegacyHelper["listClassRegistrations"]
		>
	) => this.legacyRegistration.listClassRegistrations(...args);
	updateRegistrationMetadata(
		slug: string,
		festivalShortName: string | undefined,
		registrationId: string,
		sessionId: string | undefined,
		csrfToken: string | undefined,
		origin: string | undefined,
		input: unknown,
	): Promise<{ metadata: ClassRegistrationMetadata }> {
		return this.legacyRegistration.updateRegistrationMetadata({
			slug,
			festivalShortName,
			registrationId,
			sessionId,
			csrfToken,
			origin,
			input,
		});
	}
	listRegistrationTeachers = (
		...args: Parameters<
			CustomerRegistrationLegacyHelper["listRegistrationTeachers"]
		>
	) => this.legacyRegistration.listRegistrationTeachers(...args);
	searchRegistrationConcertoCatalog = (
		...args: Parameters<
			CustomerRegistrationLegacyHelper["searchRegistrationConcertoCatalog"]
		>
	) => this.legacyRegistration.searchRegistrationConcertoCatalog(...args);
	listRegistrationEligibleClasses = (
		...args: Parameters<
			CustomerRegistrationLegacyHelper["listRegistrationEligibleClasses"]
		>
	) => this.legacyRegistration.listRegistrationEligibleClasses(...args);
	listRegistrationAccompanists = (
		...args: Parameters<
			CustomerRegistrationLegacyHelper["listRegistrationAccompanists"]
		>
	) => this.legacyRegistration.listRegistrationAccompanists(...args);
}
