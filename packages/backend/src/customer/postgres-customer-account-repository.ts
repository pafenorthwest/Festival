import type {
	FestivalChildAgeSnapshot,
	FestivalChildRecord,
} from "@festival/common";
import {
	type CreateChildWithAgeSnapshotInput,
	PostgresChildProfileRepository,
	PostgresCustomerIntegrationRepository,
	PostgresCustomerProfileRepository,
	PostgresCustomerSessionRepository,
} from "../domains/customer-identity/index.js";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import type {
	ApplyCustomerProfileInput,
	CustomerAccountIntegrationRecord,
	CustomerAccountRepository,
	CustomerOAuthStateRecord,
	CustomerProfileAccessAuditRecord,
	CustomerSessionRecord,
	CustomerSessionTokenReplacementInput,
	CustomerSessionTouchInput,
	CustomerStaffAccessConsentRecord,
} from "./customer-account-repository.js";

/** Thin legacy facade composing the split customer-identity Postgres repositories. */
export class PostgresCustomerAccountRepository
	implements CustomerAccountRepository
{
	readonly integrations: PostgresCustomerIntegrationRepository;
	readonly sessions: PostgresCustomerSessionRepository;
	readonly profiles: PostgresCustomerProfileRepository;
	readonly children: PostgresChildProfileRepository;

	constructor(private readonly schema: string) {
		this.integrations = new PostgresCustomerIntegrationRepository(schema);
		this.sessions = new PostgresCustomerSessionRepository(schema);
		this.profiles = new PostgresCustomerProfileRepository(schema);
		this.children = new PostgresChildProfileRepository(schema);
	}

	async ensureReady() {
		await initializePostgresSchema(this.schema);
	}
	getIntegration(id: string) {
		return this.integrations.getIntegration(id);
	}
	upsertIntegration(
		input: Pick<
			CustomerAccountIntegrationRecord,
			| "organizationId"
			| "storefrontDomain"
			| "clientId"
			| "encryptedClientSecret"
		>,
	) {
		return this.integrations.upsertIntegration(input);
	}
	setIntegrationReadiness(
		id: string,
		input: {
			readiness: "ready" | "failed";
			canReadOrders: boolean;
			verifiedAtIso?: string;
			lastError?: string;
		},
	) {
		return this.integrations.setIntegrationReadiness(id, input);
	}
	putOAuthState(s: CustomerOAuthStateRecord) {
		return this.sessions.putOAuthState(s);
	}
	consumeOAuthState(hash: string, now: string) {
		return this.sessions.consumeOAuthState(hash, now);
	}
	createCustomerSession(s: Omit<CustomerSessionRecord, "customerId">) {
		return this.sessions.createCustomerSession(s);
	}
	getSession(id: string) {
		return this.sessions.getSession(id);
	}
	findSessionCustomerAndIntegration(sessionId: string, organizationId: string) {
		return this.sessions.findSessionCustomerAndIntegration(
			sessionId,
			organizationId,
		);
	}
	touchSession(input: CustomerSessionTouchInput) {
		return this.sessions.touchSession(input);
	}
	replaceSessionTokens(input: CustomerSessionTokenReplacementInput) {
		return this.sessions.replaceSessionTokens(input);
	}
	revokeSession(id: string, at: string) {
		return this.sessions.revokeSession(id, at);
	}
	revokeOrganizationSessions(org: string, at: string) {
		return this.sessions.revokeOrganizationSessions(org, at);
	}
	getCustomer(organizationId: string, customerId: string) {
		return this.profiles.getCustomer(organizationId, customerId);
	}
	getCustomerByShopifyGid(organizationId: string, shopifyCustomerGid: string) {
		return this.profiles.getCustomerByShopifyGid(
			organizationId,
			shopifyCustomerGid,
		);
	}
	recordVerifiedShopifyEmail(input: {
		organizationId: string;
		customerId: string;
		email: string;
		verifiedAtIso: string;
	}) {
		return this.profiles.recordVerifiedShopifyEmail(input);
	}
	applyCustomerProfile(input: ApplyCustomerProfileInput) {
		return this.profiles.applyCustomerProfile(input);
	}
	recordStaffAccessConsent(consent: CustomerStaffAccessConsentRecord) {
		return this.profiles.recordStaffAccessConsent(consent);
	}
	getConsentedCustomer(
		organizationId: string,
		customerId: string,
		privacyNoticeVersion: string,
	) {
		return this.profiles.getConsentedCustomer(
			organizationId,
			customerId,
			privacyNoticeVersion,
		);
	}
	searchConsentedCustomers(
		organizationId: string,
		query: string,
		privacyNoticeVersion: string,
		limit: number,
	) {
		return this.profiles.searchConsentedCustomers(
			organizationId,
			query,
			privacyNoticeVersion,
			limit,
		);
	}
	recordCustomerProfileAccessAudit(audit: CustomerProfileAccessAuditRecord) {
		return this.profiles.recordCustomerProfileAccessAudit(audit);
	}
	createChild(input: Omit<FestivalChildRecord, "id" | "createdAtIso">) {
		return this.children.createChild(input);
	}
	findChild(organizationId: string, parentCustomerId: string, childId: string) {
		return this.children.findChild(organizationId, parentCustomerId, childId);
	}
	findChildrenByIds(
		organizationId: string,
		parentCustomerId: string,
		childIds: readonly string[],
	) {
		return this.children.findChildrenByIds(
			organizationId,
			parentCustomerId,
			childIds,
		);
	}
	listChildren(organizationId: string, parentCustomerId: string) {
		return this.children.listChildren(organizationId, parentCustomerId);
	}
	createChildAgeSnapshot(
		input: Omit<
			FestivalChildAgeSnapshot,
			"id" | "createdAtIso" | "supersededAtIso"
		> & { createdAtIso?: string },
	) {
		return this.children.createChildAgeSnapshot(input);
	}
	findActiveChildAgeSnapshot(organizationId: string, childId: string) {
		return this.children.findActiveChildAgeSnapshot(organizationId, childId);
	}
	listChildAgeSnapshots(organizationId: string, childId: string) {
		return this.children.listChildAgeSnapshots(organizationId, childId);
	}
	createChildWithAgeSnapshot(input: CreateChildWithAgeSnapshotInput) {
		return this.children.createChildWithAgeSnapshot(input);
	}
}
