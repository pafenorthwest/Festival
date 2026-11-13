import { randomUUID } from "node:crypto";
import type {
	FestivalChildAgeSnapshot,
	FestivalChildRecord,
} from "@festival/common";
import { sql } from "bun";
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
import {
	type ChildAgeSnapshotRow,
	type ChildRow,
	type ConsentRow,
	type CustomerRow,
	childAgeSnapshot,
	childRecord,
	consentRecord,
	customer,
	type IntegrationRow,
	integration,
	type SessionRow,
	type StateRow,
	schemaName,
	session,
	stateRecord,
} from "./postgres-customer-account-mappers.js";
import {
	type CreateChildWithAgeSnapshotInput,
	insertChildWithAgeSnapshotCte,
	queryChildrenByIds,
	queryJoinedSessionCustomerIntegration,
	updateCustomerProfileRow,
} from "./postgres-customer-account-queries.js";

export class PostgresCustomerAccountRepository
	implements CustomerAccountRepository
{
	constructor(private schema: string) {
		this.schema = schemaName(schema);
	}
	async ensureReady() {
		await initializePostgresSchema(this.schema);
	}
	async getIntegration(id: string) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.shopify_customer_account_integrations WHERE organization_id=$1`,
			[id],
		)) as IntegrationRow[];
		return rows[0] ? integration(rows[0]) : null;
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
		await this.ensureReady();
		const rows = await sql.begin(async (transaction) => {
			const updated = (await transaction.unsafe(
				`INSERT INTO ${this.schema}.shopify_customer_account_integrations (organization_id,storefront_domain,client_id,encrypted_client_secret) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id) DO UPDATE SET storefront_domain=EXCLUDED.storefront_domain,client_id=EXCLUDED.client_id,encrypted_client_secret=EXCLUDED.encrypted_client_secret,readiness='unknown',can_read_orders=FALSE,integration_version=${this.schema}.shopify_customer_account_integrations.integration_version+1,verified_at=NULL,last_error=NULL,updated_at=NOW() RETURNING *`,
				[
					input.organizationId,
					input.storefrontDomain,
					input.clientId,
					input.encryptedClientSecret,
				],
			)) as IntegrationRow[];
			await transaction.unsafe(
				`UPDATE ${this.schema}.shopify_customer_sessions SET revoked_at=$2 WHERE organization_id=$1 AND revoked_at IS NULL`,
				[input.organizationId, new Date().toISOString()],
			);
			return updated;
		});
		const updatedRow = rows[0];
		if (!updatedRow)
			throw new Error("Customer Account integration upsert failed.");
		return integration(updatedRow);
	}
	async setIntegrationReadiness(
		id: string,
		input: {
			readiness: "ready" | "failed";
			canReadOrders: boolean;
			verifiedAtIso?: string;
			lastError?: string;
		},
	) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_account_integrations SET readiness=$2,can_read_orders=$3,verified_at=$4,last_error=$5,updated_at=NOW() WHERE organization_id=$1 RETURNING *`,
			[
				id,
				input.readiness,
				input.canReadOrders,
				input.verifiedAtIso ?? null,
				input.lastError ?? null,
			],
		)) as IntegrationRow[];
		if (!rows[0]) throw new Error("Customer Account integration not found.");
		return integration(rows[0]);
	}
	async putOAuthState(s: CustomerOAuthStateRecord) {
		await this.ensureReady();
		await sql.unsafe(
			`INSERT INTO ${this.schema}.shopify_customer_oauth_states(state_hash,organization_id,nonce,return_to,offering_id,expires_at) VALUES($1,$2,$3,$4,$5,$6)`,
			[
				s.stateHash,
				s.organizationId,
				s.nonce,
				s.returnTo,
				s.offeringId ?? null,
				s.expiresAtIso,
			],
		);
	}
	async consumeOAuthState(hash: string, now: string) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`DELETE FROM ${this.schema}.shopify_customer_oauth_states WHERE state_hash=$1 AND expires_at>$2 RETURNING *`,
			[hash, now],
		)) as StateRow[];
		return rows[0] ? stateRecord(rows[0]) : null;
	}
	async createCustomerSession(s: Omit<CustomerSessionRecord, "customerId">) {
		await this.ensureReady();
		return sql.begin(async (transaction) => {
			const customerRows = (await transaction.unsafe(
				`INSERT INTO ${this.schema}.festival_customers(id,organization_id,shopify_customer_gid,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT (organization_id,shopify_customer_gid) DO UPDATE SET shopify_customer_gid=EXCLUDED.shopify_customer_gid RETURNING *`,
				[
					`cus_${randomUUID()}`,
					s.organizationId,
					s.shopifyCustomerGid,
					s.createdAtIso,
				],
			)) as CustomerRow[];
			const resolved = customerRows[0];
			if (!resolved) throw new Error("Festival customer resolution failed.");
			const sessionRows = (await transaction.unsafe(
				`INSERT INTO ${this.schema}.shopify_customer_sessions(session_id,customer_id,organization_id,shopify_customer_gid,encrypted_tokens,csrf_token,integration_version,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
				[
					s.sessionId,
					resolved.id,
					s.organizationId,
					s.shopifyCustomerGid,
					s.encryptedTokens,
					s.csrfToken,
					s.integrationVersion,
					s.createdAtIso,
					s.lastSeenAtIso,
					s.expiresAtIso,
				],
			)) as SessionRow[];
			const createdSession = sessionRows[0];
			if (!createdSession) throw new Error("Customer session creation failed.");
			return {
				customer: customer(resolved),
				session: session(createdSession),
			};
		});
	}
	async getSession(id: string) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.shopify_customer_sessions WHERE session_id=$1`,
			[id],
		)) as SessionRow[];
		return rows[0] ? session(rows[0]) : null;
	}
	async findSessionCustomerAndIntegration(
		sessionId: string,
		organizationId: string,
	) {
		await this.ensureReady();
		return queryJoinedSessionCustomerIntegration(
			this.schema,
			sessionId,
			organizationId,
		);
	}
	async getCustomer(organizationId: string, customerId: string) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.festival_customers WHERE organization_id=$1 AND id=$2`,
			[organizationId, customerId],
		)) as CustomerRow[];
		return rows[0] ? customer(rows[0]) : null;
	}
	async getCustomerByShopifyGid(
		organizationId: string,
		shopifyCustomerGid: string,
	) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.festival_customers WHERE organization_id=$1 AND shopify_customer_gid=$2`,
			[organizationId, shopifyCustomerGid],
		)) as CustomerRow[];
		return rows[0] ? customer(rows[0]) : null;
	}
	async recordVerifiedShopifyEmail(input: {
		organizationId: string;
		customerId: string;
		email: string;
		verifiedAtIso: string;
	}) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.festival_customers SET email=$3,email_source='shopify',email_updated_at=$4,updated_at=GREATEST(updated_at,$4) WHERE organization_id=$1 AND id=$2 RETURNING *`,
			[
				input.organizationId,
				input.customerId,
				input.email,
				input.verifiedAtIso,
			],
		)) as CustomerRow[];
		return rows[0] ? customer(rows[0]) : null;
	}
	async applyCustomerProfile(input: ApplyCustomerProfileInput) {
		await this.ensureReady();
		return updateCustomerProfileRow(this.schema, input);
	}
	async recordStaffAccessConsent(consent: CustomerStaffAccessConsentRecord) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.festival_customer_staff_consents(customer_id,organization_id,privacy_notice_version,consented_at) VALUES($1,$2,$3,$4) ON CONFLICT (customer_id,privacy_notice_version) DO UPDATE SET consented_at=LEAST(${this.schema}.festival_customer_staff_consents.consented_at,EXCLUDED.consented_at) RETURNING *`,
			[
				consent.customerId,
				consent.organizationId,
				consent.privacyNoticeVersion,
				consent.consentedAtIso,
			],
		)) as ConsentRow[];
		if (!rows[0]) throw new Error("Customer consent persistence failed.");
		return consentRecord(rows[0]);
	}
	async getConsentedCustomer(
		organizationId: string,
		customerId: string,
		privacyNoticeVersion: string,
	) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT c.* FROM ${this.schema}.festival_customers c JOIN ${this.schema}.festival_customer_staff_consents consent ON consent.customer_id=c.id AND consent.organization_id=c.organization_id WHERE c.organization_id=$1 AND c.id=$2 AND consent.privacy_notice_version=$3`,
			[organizationId, customerId, privacyNoticeVersion],
		)) as CustomerRow[];
		return rows[0] ? customer(rows[0]) : null;
	}
	async searchConsentedCustomers(
		organizationId: string,
		query: string,
		privacyNoticeVersion: string,
		limit: number,
	) {
		await this.ensureReady();
		const escaped = query.replace(/[\\%_]/g, (value) => `\\${value}`);
		const rows = (await sql.unsafe(
			`SELECT c.* FROM ${this.schema}.festival_customers c JOIN ${this.schema}.festival_customer_staff_consents consent ON consent.customer_id=c.id AND consent.organization_id=c.organization_id WHERE c.organization_id=$1 AND consent.privacy_notice_version=$2 AND (LOWER(c.name) LIKE LOWER($3) ESCAPE '\\' OR LOWER(c.email) LIKE LOWER($3) ESCAPE '\\' OR c.phone LIKE $3 ESCAPE '\\') ORDER BY LOWER(COALESCE(c.name,'')),c.id LIMIT $4`,
			[organizationId, privacyNoticeVersion, `%${escaped}%`, limit],
		)) as CustomerRow[];
		return rows.map(customer);
	}
	async recordCustomerProfileAccessAudit(
		audit: CustomerProfileAccessAuditRecord,
	) {
		await this.ensureReady();
		await sql.unsafe(
			`INSERT INTO ${this.schema}.festival_customer_profile_access_audit(organization_id,actor_uid,action,target_customer_id,result_count,occurred_at) VALUES($1,$2,$3,$4,$5,$6)`,
			[
				audit.organizationId,
				audit.actorUid,
				audit.action,
				audit.targetCustomerId ?? null,
				audit.resultCount ?? null,
				audit.occurredAtIso,
			],
		);
	}
	async touchSession(input: CustomerSessionTouchInput) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_sessions SET last_seen_at=GREATEST(last_seen_at,$4) WHERE session_id=$1 AND organization_id=$2 AND integration_version=$3 AND revoked_at IS NULL AND expires_at>$4 AND last_seen_at>$5 RETURNING *`,
			[
				input.sessionId,
				input.organizationId,
				input.integrationVersion,
				input.seenAtIso,
				input.idleCutoffIso,
			],
		)) as SessionRow[];
		return rows[0] ? session(rows[0]) : null;
	}
	async replaceSessionTokens(input: CustomerSessionTokenReplacementInput) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_sessions SET encrypted_tokens=$5,last_seen_at=GREATEST(last_seen_at,$6),expires_at=LEAST(expires_at,$7) WHERE session_id=$1 AND organization_id=$2 AND integration_version=$3 AND encrypted_tokens=$4 AND revoked_at IS NULL AND expires_at>$6 AND last_seen_at>$8 RETURNING *`,
			[
				input.sessionId,
				input.organizationId,
				input.integrationVersion,
				input.expectedEncryptedTokens,
				input.replacementEncryptedTokens,
				input.seenAtIso,
				input.replacementExpiresAtIso,
				input.idleCutoffIso,
			],
		)) as SessionRow[];
		return rows[0] ? session(rows[0]) : null;
	}
	async revokeSession(id: string, at: string) {
		await this.ensureReady();
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_sessions SET revoked_at=$2 WHERE session_id=$1`,
			[id, at],
		);
	}
	async revokeOrganizationSessions(org: string, at: string) {
		await this.ensureReady();
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_sessions SET revoked_at=$2 WHERE organization_id=$1 AND revoked_at IS NULL`,
			[org, at],
		);
	}
	async createChild(
		input: Omit<FestivalChildRecord, "id" | "createdAtIso">,
	): Promise<FestivalChildRecord> {
		await this.ensureReady();
		const id = randomUUID();
		const createdAtIso = new Date().toISOString();
		await sql.unsafe(
			`INSERT INTO ${this.schema}.festival_children (id,organization_id,parent_customer_id,display_name,created_at) VALUES ($1,$2,$3,$4,$5)`,
			[
				id,
				input.organizationId,
				input.parentCustomerId,
				input.displayName,
				createdAtIso,
			],
		);
		return { ...input, id, createdAtIso };
	}
	async findChild(
		organizationId: string,
		parentCustomerId: string,
		childId: string,
	): Promise<FestivalChildRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id,organization_id,parent_customer_id,display_name,created_at FROM ${this.schema}.festival_children WHERE organization_id = $1 AND parent_customer_id = $2 AND id = $3 LIMIT 1`,
			[organizationId, parentCustomerId, childId],
		)) as ChildRow[];
		return rows[0] ? childRecord(rows[0]) : null;
	}
	async findChildrenByIds(
		organizationId: string,
		parentCustomerId: string,
		childIds: readonly string[],
	): Promise<FestivalChildRecord[]> {
		if (childIds.length === 0) return [];
		await this.ensureReady();
		return queryChildrenByIds(
			this.schema,
			{ organizationId, parentCustomerId },
			childIds,
		);
	}
	async listChildren(
		organizationId: string,
		parentCustomerId: string,
	): Promise<FestivalChildRecord[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id,organization_id,parent_customer_id,display_name,created_at FROM ${this.schema}.festival_children WHERE organization_id=$1 AND parent_customer_id=$2`,
			[organizationId, parentCustomerId],
		)) as ChildRow[];
		return rows.map(childRecord);
	}
	async createChildAgeSnapshot(
		input: Omit<
			FestivalChildAgeSnapshot,
			"id" | "createdAtIso" | "supersededAtIso"
		> & { createdAtIso?: string },
	): Promise<FestivalChildAgeSnapshot> {
		await this.ensureReady();
		const id = randomUUID();
		const createdAtIso = input.createdAtIso ?? new Date().toISOString();
		await sql.begin(async (transaction) => {
			await transaction.unsafe(
				"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
				[
					`child-age-snapshot:${JSON.stringify([this.schema, input.organizationId, input.childId])}`,
				],
			);
			await transaction.unsafe(
				`UPDATE ${this.schema}.festival_child_age_snapshots SET superseded_at=$3 WHERE organization_id=$1 AND child_id=$2 AND superseded_at IS NULL`,
				[input.organizationId, input.childId, createdAtIso],
			);
			await transaction.unsafe(
				`INSERT INTO ${this.schema}.festival_child_age_snapshots (id,child_id,organization_id,age,created_at,valid_until) VALUES ($1,$2,$3,$4,$5,$6)`,
				[
					id,
					input.childId,
					input.organizationId,
					input.age,
					createdAtIso,
					input.validUntilIso,
				],
			);
		});
		return { ...input, id, createdAtIso };
	}
	async findActiveChildAgeSnapshot(
		organizationId: string,
		childId: string,
	): Promise<FestivalChildAgeSnapshot | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id,child_id,organization_id,age,created_at,valid_until,superseded_at FROM ${this.schema}.festival_child_age_snapshots WHERE organization_id = $1 AND child_id = $2 AND superseded_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`,
			[organizationId, childId],
		)) as ChildAgeSnapshotRow[];
		return rows[0] ? childAgeSnapshot(rows[0]) : null;
	}
	async listChildAgeSnapshots(
		organizationId: string,
		childId: string,
	): Promise<FestivalChildAgeSnapshot[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id,child_id,organization_id,age,created_at,valid_until,superseded_at FROM ${this.schema}.festival_child_age_snapshots WHERE organization_id=$1 AND child_id=$2`,
			[organizationId, childId],
		)) as ChildAgeSnapshotRow[];
		return rows.map(childAgeSnapshot);
	}
	async createChildWithAgeSnapshot(input: CreateChildWithAgeSnapshotInput) {
		await this.ensureReady();
		return insertChildWithAgeSnapshotCte(this.schema, input);
	}
}
