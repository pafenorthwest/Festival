import { randomUUID } from "node:crypto";
import type {
	ApplyCustomerProfileInput,
	CustomerAccountIntegrationRecord,
	CustomerAccountRepository,
	CustomerOAuthStateRecord,
	CustomerProfileAccessAuditRecord,
	CustomerProfileFieldRecord,
	CustomerSessionRecord,
	CustomerSessionTokenReplacementInput,
	CustomerSessionTouchInput,
	CustomerStaffAccessConsentRecord,
	FestivalCustomerRecord,
} from "./customer-account-repository.js";

function laterIso(left: string, right: string) {
	return new Date(left) >= new Date(right) ? left : right;
}

function earlierIso(left: string, right: string) {
	return new Date(left) <= new Date(right) ? left : right;
}

export class InMemoryCustomerAccountRepository
	implements CustomerAccountRepository
{
	private integrations = new Map<string, CustomerAccountIntegrationRecord>();
	private states = new Map<string, CustomerOAuthStateRecord>();
	private sessions = new Map<string, CustomerSessionRecord>();
	private customers = new Map<string, FestivalCustomerRecord>();
	private customerByShopifyIdentity = new Map<string, string>();
	private consents = new Map<string, CustomerStaffAccessConsentRecord>();
	readonly profileAccessAudits: CustomerProfileAccessAuditRecord[] = [];
	private customerIdentityKey(
		organizationId: string,
		shopifyCustomerGid: string,
	) {
		return `${organizationId}\0${shopifyCustomerGid}`;
	}
	private consentKey(
		organizationId: string,
		customerId: string,
		privacyNoticeVersion: string,
	) {
		return `${organizationId}\0${customerId}\0${privacyNoticeVersion}`;
	}
	async ensureReady() {}
	async getIntegration(id: string) {
		return this.integrations.get(id) ?? null;
	}
	async upsertIntegration(
		input: Pick<
			CustomerAccountIntegrationRecord,
			| "organizationId"
			| "storefrontDomain"
			| "clientId"
			| "encryptedClientSecret"
		>,
	) {
		const existing = this.integrations.get(input.organizationId);
		const now = new Date().toISOString();
		const record: CustomerAccountIntegrationRecord = {
			...input,
			readiness: "unknown",
			canReadOrders: false,
			integrationVersion: (existing?.integrationVersion ?? 0) + 1,
			createdAtIso: existing?.createdAtIso ?? now,
			updatedAtIso: now,
		};
		this.integrations.set(input.organizationId, record);
		if (existing)
			await this.revokeOrganizationSessions(input.organizationId, now);
		return record;
	}
	async setIntegrationReadiness(
		organizationId: string,
		input: {
			readiness: "ready" | "failed";
			canReadOrders: boolean;
			verifiedAtIso?: string;
			lastError?: string;
		},
	) {
		const existing = this.integrations.get(organizationId);
		if (!existing) throw new Error("Customer Account integration not found.");
		const record = {
			...existing,
			...input,
			updatedAtIso: new Date().toISOString(),
		};
		this.integrations.set(organizationId, record);
		return record;
	}
	async putOAuthState(state: CustomerOAuthStateRecord) {
		this.states.set(state.stateHash, state);
	}
	async consumeOAuthState(stateHash: string, nowIso: string) {
		const state = this.states.get(stateHash);
		this.states.delete(stateHash);
		return state && state.expiresAtIso > nowIso ? state : null;
	}
	async createCustomerSession(
		session: Omit<CustomerSessionRecord, "customerId">,
	) {
		const identityKey = this.customerIdentityKey(
			session.organizationId,
			session.shopifyCustomerGid,
		);
		const existingId = this.customerByShopifyIdentity.get(identityKey);
		let customer = existingId ? this.customers.get(existingId) : undefined;
		if (!customer) {
			customer = {
				id: `cus_${randomUUID()}`,
				organizationId: session.organizationId,
				shopifyCustomerGid: session.shopifyCustomerGid,
				name: { value: null, source: null, updatedAtIso: null },
				email: { value: null, source: null, updatedAtIso: null },
				mailingAddress: { value: null, source: null, updatedAtIso: null },
				phone: { value: null, source: null, updatedAtIso: null },
				createdAtIso: session.createdAtIso,
				updatedAtIso: session.createdAtIso,
			};
			this.customers.set(customer.id, customer);
			this.customerByShopifyIdentity.set(identityKey, customer.id);
		}
		const stored = { ...session, customerId: customer.id };
		this.sessions.set(stored.sessionId, stored);
		return { customer, session: stored };
	}
	async getSession(id: string) {
		return this.sessions.get(id) ?? null;
	}
	async getCustomer(organizationId: string, customerId: string) {
		const customer = this.customers.get(customerId);
		return customer?.organizationId === organizationId ? customer : null;
	}
	async getCustomerByShopifyGid(
		organizationId: string,
		shopifyCustomerGid: string,
	) {
		const id = this.customerByShopifyIdentity.get(
			this.customerIdentityKey(organizationId, shopifyCustomerGid),
		);
		return id ? (this.customers.get(id) ?? null) : null;
	}
	async applyCustomerProfile(input: ApplyCustomerProfileInput) {
		const current = await this.getCustomer(
			input.organizationId,
			input.customerId,
		);
		if (!current) return null;
		const updateField = <T>(
			field: CustomerProfileFieldRecord<T>,
			value: T | undefined,
		): CustomerProfileFieldRecord<T> => {
			if (value === undefined) return field;
			if (input.source === "shopify" && field.source === "festival")
				return field;
			if (
				field.updatedAtIso &&
				new Date(field.updatedAtIso) > new Date(input.updatedAtIso)
			)
				return field;
			return {
				value,
				source: input.source,
				updatedAtIso: input.updatedAtIso,
			};
		};
		const updated: FestivalCustomerRecord = {
			...current,
			name: updateField(current.name, input.profile.name),
			email: updateField(current.email, input.profile.email),
			mailingAddress: updateField(
				current.mailingAddress,
				input.profile.mailingAddress,
			),
			phone: updateField(current.phone, input.profile.phone),
			updatedAtIso: laterIso(current.updatedAtIso, input.updatedAtIso),
		};
		this.customers.set(updated.id, updated);
		return updated;
	}
	async recordStaffAccessConsent(consent: CustomerStaffAccessConsentRecord) {
		const customer = await this.getCustomer(
			consent.organizationId,
			consent.customerId,
		);
		if (!customer) throw new Error("Festival customer not found.");
		const key = this.consentKey(
			consent.organizationId,
			consent.customerId,
			consent.privacyNoticeVersion,
		);
		const existing = this.consents.get(key);
		if (existing) return existing;
		this.consents.set(key, consent);
		return consent;
	}
	async getConsentedCustomer(
		organizationId: string,
		customerId: string,
		privacyNoticeVersion: string,
	) {
		if (
			!this.consents.has(
				this.consentKey(organizationId, customerId, privacyNoticeVersion),
			)
		)
			return null;
		return this.getCustomer(organizationId, customerId);
	}
	async searchConsentedCustomers(
		organizationId: string,
		query: string,
		privacyNoticeVersion: string,
		limit: number,
	) {
		const needle = query.toLocaleLowerCase();
		return [...this.customers.values()]
			.filter(
				(customer) =>
					customer.organizationId === organizationId &&
					this.consents.has(
						this.consentKey(organizationId, customer.id, privacyNoticeVersion),
					) &&
					[customer.name.value, customer.email.value, customer.phone.value]
						.filter((value): value is string => value !== null)
						.some((value) => value.toLocaleLowerCase().includes(needle)),
			)
			.sort((left, right) =>
				(left.name.value ?? "").localeCompare(right.name.value ?? ""),
			)
			.slice(0, limit);
	}
	async recordCustomerProfileAccessAudit(
		audit: CustomerProfileAccessAuditRecord,
	) {
		this.profileAccessAudits.push({ ...audit });
	}
	private activeSession(input: CustomerSessionTouchInput) {
		const session = this.sessions.get(input.sessionId);
		if (
			!session ||
			session.organizationId !== input.organizationId ||
			session.integrationVersion !== input.integrationVersion ||
			session.revokedAtIso ||
			new Date(session.expiresAtIso) <= new Date(input.seenAtIso) ||
			new Date(session.lastSeenAtIso) <= new Date(input.idleCutoffIso)
		)
			return null;
		return session;
	}
	async touchSession(input: CustomerSessionTouchInput) {
		const session = this.activeSession(input);
		if (!session) return null;
		const touched = {
			...session,
			lastSeenAtIso: laterIso(session.lastSeenAtIso, input.seenAtIso),
		};
		this.sessions.set(session.sessionId, touched);
		return touched;
	}
	async replaceSessionTokens(input: CustomerSessionTokenReplacementInput) {
		const session = this.activeSession(input);
		if (!session || session.encryptedTokens !== input.expectedEncryptedTokens)
			return null;
		const updated = {
			...session,
			encryptedTokens: input.replacementEncryptedTokens,
			lastSeenAtIso: laterIso(session.lastSeenAtIso, input.seenAtIso),
			expiresAtIso: earlierIso(
				session.expiresAtIso,
				input.replacementExpiresAtIso,
			),
		};
		this.sessions.set(session.sessionId, updated);
		return updated;
	}
	async revokeSession(id: string, at: string) {
		const session = this.sessions.get(id);
		if (session && !session.revokedAtIso)
			this.sessions.set(id, { ...session, revokedAtIso: at });
	}
	async revokeOrganizationSessions(org: string, at: string) {
		for (const [id, session] of this.sessions)
			if (session.organizationId === org && !session.revokedAtIso)
				this.sessions.set(id, { ...session, revokedAtIso: at });
	}
}
