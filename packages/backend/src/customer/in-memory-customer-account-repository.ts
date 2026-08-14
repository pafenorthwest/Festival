import type {
	CustomerAccountIntegrationRecord,
	CustomerAccountRepository,
	CustomerOAuthStateRecord,
	CustomerSessionRecord,
	CustomerSessionTokenReplacementInput,
	CustomerSessionTouchInput,
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
	async createSession(session: CustomerSessionRecord) {
		this.sessions.set(session.sessionId, session);
	}
	async getSession(id: string) {
		return this.sessions.get(id) ?? null;
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
