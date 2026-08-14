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
	createSession(session: CustomerSessionRecord): Promise<void>;
	getSession(sessionId: string): Promise<CustomerSessionRecord | null>;
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
