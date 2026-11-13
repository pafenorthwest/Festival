import type {
	CustomerMailingAddress,
	FestivalChildAgeSnapshot,
	FestivalChildRecord,
	OrganizationRecord,
	RegistrationAgeConfiguration,
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
	offeringId?: string;
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

export interface CreateChildWithAgeSnapshotInput {
	child: Omit<FestivalChildRecord, "id" | "createdAtIso">;
	snapshot: Omit<
		FestivalChildAgeSnapshot,
		"id" | "childId" | "organizationId" | "createdAtIso" | "supersededAtIso"
	>;
}

export interface JoinedSessionCustomerIntegration {
	session: CustomerSessionRecord;
	customer: FestivalCustomerRecord | null;
	integration: CustomerAccountIntegrationRecord | null;
}

export interface CustomerIdentityOrganizationPort {
	findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	getRegistrationAgeConfiguration(
		organizationId: string,
	): Promise<RegistrationAgeConfiguration | null>;
}

export interface CustomerIntegrationRepository {
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
}

export interface CustomerSessionRepository {
	ensureReady(): Promise<void>;
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
	findSessionCustomerAndIntegration?(
		sessionId: string,
		organizationId: string,
	): Promise<
		JoinedSessionCustomerIntegration | { organizationMismatch: true } | null
	>;
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

export interface CustomerProfileRepository {
	ensureReady(): Promise<void>;
	getCustomer(
		organizationId: string,
		customerId: string,
	): Promise<FestivalCustomerRecord | null>;
	getCustomerByShopifyGid(
		organizationId: string,
		shopifyCustomerGid: string,
	): Promise<FestivalCustomerRecord | null>;
	recordVerifiedShopifyEmail(input: {
		organizationId: string;
		customerId: string;
		email: string;
		verifiedAtIso: string;
	}): Promise<FestivalCustomerRecord | null>;
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
}

export interface ChildProfileRepository {
	ensureReady(): Promise<void>;
	createChild(
		input: Omit<FestivalChildRecord, "id" | "createdAtIso">,
	): Promise<FestivalChildRecord>;
	findChild(
		organizationId: string,
		parentCustomerId: string,
		childId: string,
	): Promise<FestivalChildRecord | null>;
	findChildrenByIds(
		organizationId: string,
		parentCustomerId: string,
		childIds: readonly string[],
	): Promise<FestivalChildRecord[]>;
	listChildren(
		organizationId: string,
		parentCustomerId: string,
	): Promise<FestivalChildRecord[]>;
	createChildAgeSnapshot(
		input: Omit<
			FestivalChildAgeSnapshot,
			"id" | "createdAtIso" | "supersededAtIso"
		> & { createdAtIso?: string },
	): Promise<FestivalChildAgeSnapshot>;
	findActiveChildAgeSnapshot(
		organizationId: string,
		childId: string,
	): Promise<FestivalChildAgeSnapshot | null>;
	listChildAgeSnapshots(
		organizationId: string,
		childId: string,
	): Promise<FestivalChildAgeSnapshot[]>;
	createChildWithAgeSnapshot?(input: CreateChildWithAgeSnapshotInput): Promise<{
		child: FestivalChildRecord;
		ageSnapshot: FestivalChildAgeSnapshot;
	}>;
}
