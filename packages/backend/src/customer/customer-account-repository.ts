import type {
	CustomerMailingAddress,
	UpdateCustomerProfileInput,
} from "@festival/common";

export type CustomerProfileSource = "shopify" | "festival";

export interface CustomerProfileFieldRecord<T> {
	value: T | null;
	source: CustomerProfileSource | null;
	updatedAtIso: string | null;
}

export interface FestivalCustomerRecord {
	id: string;
	organizationId: string;
	shopifyCustomerGid: string;
	name: CustomerProfileFieldRecord<string>;
	email: CustomerProfileFieldRecord<string>;
	mailingAddress: CustomerProfileFieldRecord<CustomerMailingAddress>;
	phone: CustomerProfileFieldRecord<string>;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface CustomerStaffAccessConsentRecord {
	customerId: string;
	organizationId: string;
	privacyNoticeVersion: string;
	consentedAtIso: string;
}

export interface CustomerProfileAccessAuditRecord {
	organizationId: string;
	actorUid: string;
	action: "view" | "search";
	targetCustomerId?: string;
	resultCount?: number;
	occurredAtIso: string;
}

export interface ApplyCustomerProfileInput {
	customerId: string;
	organizationId: string;
	source: CustomerProfileSource;
	updatedAtIso: string;
	profile: Partial<UpdateCustomerProfileInput>;
}

export interface CustomerAccountIntegrationRecord {
	organizationId: string;
	storefrontDomain: string;
	clientId: string;
	encryptedClientSecret: string;
	readiness: "unknown" | "ready" | "failed";
	canReadOrders: boolean;
	integrationVersion: number;
	verifiedAtIso?: string;
	lastError?: string;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface CustomerOAuthStateRecord {
	stateHash: string;
	organizationId: string;
	nonce: string;
	returnTo: string;
	expiresAtIso: string;
}

export interface CustomerSessionRecord {
	sessionId: string;
	customerId: string;
	organizationId: string;
	shopifyCustomerGid: string;
	encryptedTokens: string;
	csrfToken: string;
	integrationVersion: number;
	createdAtIso: string;
	lastSeenAtIso: string;
	expiresAtIso: string;
	revokedAtIso?: string;
}

export interface CustomerSessionTouchInput {
	sessionId: string;
	organizationId: string;
	integrationVersion: number;
	seenAtIso: string;
	idleCutoffIso: string;
}

export interface CustomerSessionTokenReplacementInput
	extends CustomerSessionTouchInput {
	expectedEncryptedTokens: string;
	replacementEncryptedTokens: string;
	replacementExpiresAtIso: string;
}

export interface CustomerAccountRepository {
	ensureReady(): Promise<void>;
	getIntegration(
		organizationId: string,
	): Promise<CustomerAccountIntegrationRecord | null>;
	upsertIntegration(
		input: Pick<
			CustomerAccountIntegrationRecord,
			| "organizationId"
			| "storefrontDomain"
			| "clientId"
			| "encryptedClientSecret"
		>,
	): Promise<CustomerAccountIntegrationRecord>;
	setIntegrationReadiness(
		organizationId: string,
		input: {
			readiness: "ready" | "failed";
			canReadOrders: boolean;
			verifiedAtIso?: string;
			lastError?: string;
		},
	): Promise<CustomerAccountIntegrationRecord>;
	putOAuthState(state: CustomerOAuthStateRecord): Promise<void>;
	consumeOAuthState(
		stateHash: string,
		nowIso: string,
	): Promise<CustomerOAuthStateRecord | null>;
	createCustomerSession(
		session: Omit<CustomerSessionRecord, "customerId">,
	): Promise<{
		customer: FestivalCustomerRecord;
		session: CustomerSessionRecord;
	}>;
	getSession(sessionId: string): Promise<CustomerSessionRecord | null>;
	getCustomer(
		organizationId: string,
		customerId: string,
	): Promise<FestivalCustomerRecord | null>;
	getCustomerByShopifyGid(
		organizationId: string,
		shopifyCustomerGid: string,
	): Promise<FestivalCustomerRecord | null>;
	applyCustomerProfile(
		input: ApplyCustomerProfileInput,
	): Promise<FestivalCustomerRecord | null>;
	recordStaffAccessConsent(
		consent: CustomerStaffAccessConsentRecord,
	): Promise<CustomerStaffAccessConsentRecord>;
	getConsentedCustomer(
		organizationId: string,
		customerId: string,
		privacyNoticeVersion: string,
	): Promise<FestivalCustomerRecord | null>;
	searchConsentedCustomers(
		organizationId: string,
		query: string,
		privacyNoticeVersion: string,
		limit: number,
	): Promise<FestivalCustomerRecord[]>;
	recordCustomerProfileAccessAudit(
		audit: CustomerProfileAccessAuditRecord,
	): Promise<void>;
	touchSession(
		input: CustomerSessionTouchInput,
	): Promise<CustomerSessionRecord | null>;
	replaceSessionTokens(
		input: CustomerSessionTokenReplacementInput,
	): Promise<CustomerSessionRecord | null>;
	revokeSession(sessionId: string, revokedAtIso: string): Promise<void>;
	revokeOrganizationSessions(
		organizationId: string,
		revokedAtIso: string,
	): Promise<void>;
}
