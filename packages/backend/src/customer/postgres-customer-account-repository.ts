import { randomUUID } from "node:crypto";
import type {
	CustomerMailingAddress,
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
	FestivalCustomerRecord,
} from "./customer-account-repository.js";

interface IntegrationRow {
	organization_id: string;
	storefront_domain: string;
	client_id: string;
	encrypted_client_secret: string;
	readiness: "unknown" | "ready" | "failed";
	can_read_orders: boolean;
	integration_version: number | string;
	verified_at: string | null;
	last_error: string | null;
	created_at: string;
	updated_at: string;
}
interface SessionRow {
	session_id: string;
	customer_id: string;
	organization_id: string;
	shopify_customer_gid: string;
	encrypted_tokens: string;
	csrf_token: string;
	integration_version: number | string;
	created_at: string;
	last_seen_at: string;
	expires_at: string;
	revoked_at: string | null;
}
interface CustomerRow {
	id: string;
	organization_id: string;
	shopify_customer_gid: string;
	name: string | null;
	name_source: "shopify" | "festival" | null;
	name_updated_at: string | null;
	email: string | null;
	email_source: "shopify" | "festival" | null;
	email_updated_at: string | null;
	mailing_address: CustomerMailingAddress | string | null;
	mailing_address_source: "shopify" | "festival" | null;
	mailing_address_updated_at: string | null;
	phone: string | null;
	phone_source: "shopify" | "festival" | null;
	phone_updated_at: string | null;
	created_at: string;
	updated_at: string;
}
interface StateRow {
	state_hash: string;
	organization_id: string;
	nonce: string;
	return_to: string;
	offering_id: string | null;
	expires_at: string;
}
interface ChildRow {
	id: string;
	organization_id: string;
	parent_customer_id: string;
	display_name: string;
	created_at: string;
}
interface ChildAgeSnapshotRow {
	id: string;
	child_id: string;
	organization_id: string;
	age: number;
	created_at: string;
	valid_until: string;
	superseded_at: string | null;
}
interface ConsentRow {
	customer_id: string;
	organization_id: string;
	privacy_notice_version: string;
	consented_at: string;
}
interface JoinedSessionCustomerIntegrationRow {
	s_session_id: string;
	s_customer_id: string;
	s_organization_id: string;
	s_shopify_customer_gid: string;
	s_encrypted_tokens: string;
	s_csrf_token: string;
	s_integration_version: number | string;
	s_created_at: string;
	s_last_seen_at: string;
	s_expires_at: string;
	s_revoked_at: string | null;
	c_id: string | null;
	c_organization_id: string | null;
	c_shopify_customer_gid: string | null;
	c_name: string | null;
	c_name_source: "shopify" | "festival" | null;
	c_name_updated_at: string | null;
	c_email: string | null;
	c_email_source: "shopify" | "festival" | null;
	c_email_updated_at: string | null;
	c_mailing_address: CustomerMailingAddress | string | null;
	c_mailing_address_source: "shopify" | "festival" | null;
	c_mailing_address_updated_at: string | null;
	c_phone: string | null;
	c_phone_source: "shopify" | "festival" | null;
	c_phone_updated_at: string | null;
	c_created_at: string | null;
	c_updated_at: string | null;
	i_organization_id: string | null;
	i_storefront_domain: string | null;
	i_client_id: string | null;
	i_encrypted_client_secret: string | null;
	i_readiness: "unknown" | "ready" | "failed" | null;
	i_can_read_orders: boolean | null;
	i_integration_version: number | string | null;
	i_verified_at: string | null;
	i_last_error: string | null;
	i_created_at: string | null;
	i_updated_at: string | null;
}
function extractJoinedCustomer(
	row: JoinedSessionCustomerIntegrationRow,
): FestivalCustomerRecord | null {
	if (
		!row.c_id ||
		!row.c_organization_id ||
		!row.c_shopify_customer_gid ||
		!row.c_created_at ||
		!row.c_updated_at
	) {
		return null;
	}
	return customer({
		id: row.c_id,
		organization_id: row.c_organization_id,
		shopify_customer_gid: row.c_shopify_customer_gid,
		name: row.c_name,
		name_source: row.c_name_source,
		name_updated_at: row.c_name_updated_at,
		email: row.c_email,
		email_source: row.c_email_source,
		email_updated_at: row.c_email_updated_at,
		mailing_address: row.c_mailing_address,
		mailing_address_source: row.c_mailing_address_source,
		mailing_address_updated_at: row.c_mailing_address_updated_at,
		phone: row.c_phone,
		phone_source: row.c_phone_source,
		phone_updated_at: row.c_phone_updated_at,
		created_at: row.c_created_at,
		updated_at: row.c_updated_at,
	});
}
function extractJoinedIntegration(
	row: JoinedSessionCustomerIntegrationRow,
): CustomerAccountIntegrationRecord | null {
	if (
		!row.i_organization_id ||
		!row.i_storefront_domain ||
		!row.i_client_id ||
		!row.i_encrypted_client_secret ||
		!row.i_readiness ||
		row.i_can_read_orders === null ||
		row.i_can_read_orders === undefined ||
		row.i_integration_version === null ||
		row.i_integration_version === undefined ||
		!row.i_created_at ||
		!row.i_updated_at
	) {
		return null;
	}
	return integration({
		organization_id: row.i_organization_id,
		storefront_domain: row.i_storefront_domain,
		client_id: row.i_client_id,
		encrypted_client_secret: row.i_encrypted_client_secret,
		readiness: row.i_readiness,
		can_read_orders: row.i_can_read_orders,
		integration_version: row.i_integration_version,
		verified_at: row.i_verified_at,
		last_error: row.i_last_error,
		created_at: row.i_created_at,
		updated_at: row.i_updated_at,
	});
}
interface ChildWithAgeSnapshotCteRow {
	child_id: string;
	child_organization_id: string;
	child_parent_customer_id: string;
	child_display_name: string;
	child_created_at: string;
	snapshot_id: string;
	snapshot_child_id: string;
	snapshot_organization_id: string;
	snapshot_age: number;
	snapshot_created_at: string;
	snapshot_valid_until: string;
	snapshot_superseded_at: string | null;
}

function schemaName(value: string) {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
		throw new Error("Invalid DB_SCHEMA.");
	return value;
}
function integration(row: IntegrationRow): CustomerAccountIntegrationRecord {
	return {
		organizationId: row.organization_id,
		storefrontDomain: row.storefront_domain,
		clientId: row.client_id,
		encryptedClientSecret: row.encrypted_client_secret,
		readiness: row.readiness,
		canReadOrders: row.can_read_orders,
		integrationVersion: Number(row.integration_version),
		verifiedAtIso: row.verified_at ?? undefined,
		lastError: row.last_error ?? undefined,
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}
function session(row: SessionRow): CustomerSessionRecord {
	return {
		sessionId: row.session_id,
		customerId: row.customer_id,
		organizationId: row.organization_id,
		shopifyCustomerGid: row.shopify_customer_gid,
		encryptedTokens: row.encrypted_tokens,
		csrfToken: row.csrf_token,
		integrationVersion: Number(row.integration_version),
		createdAtIso: row.created_at,
		lastSeenAtIso: row.last_seen_at,
		expiresAtIso: row.expires_at,
		revokedAtIso: row.revoked_at ?? undefined,
	};
}
function mailingAddress(
	value: CustomerRow["mailing_address"],
): CustomerMailingAddress | null {
	if (!value) return null;
	return typeof value === "string"
		? (JSON.parse(value) as CustomerMailingAddress)
		: value;
}
function field<T>(
	value: T | null,
	source: "shopify" | "festival" | null,
	updatedAtIso: string | null,
) {
	return { value, source, updatedAtIso };
}
function customer(row: CustomerRow): FestivalCustomerRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		shopifyCustomerGid: row.shopify_customer_gid,
		name: field(row.name, row.name_source, row.name_updated_at),
		email: field(row.email, row.email_source, row.email_updated_at),
		mailingAddress: field(
			mailingAddress(row.mailing_address),
			row.mailing_address_source,
			row.mailing_address_updated_at,
		),
		phone: field(row.phone, row.phone_source, row.phone_updated_at),
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}
function childRecord(row: ChildRow): FestivalChildRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		parentCustomerId: row.parent_customer_id,
		displayName: row.display_name,
		createdAtIso: row.created_at,
	};
}
function childAgeSnapshot(row: ChildAgeSnapshotRow): FestivalChildAgeSnapshot {
	return {
		id: row.id,
		childId: row.child_id,
		organizationId: row.organization_id,
		age: row.age,
		createdAtIso: row.created_at,
		validUntilIso: row.valid_until,
		...(row.superseded_at ? { supersededAtIso: row.superseded_at } : {}),
	};
}
function consentRecord(row: ConsentRow): CustomerStaffAccessConsentRecord {
	return {
		customerId: row.customer_id,
		organizationId: row.organization_id,
		privacyNoticeVersion: row.privacy_notice_version,
		consentedAtIso: row.consented_at,
	};
}
function stateRecord(r: StateRow): CustomerOAuthStateRecord {
	return {
		stateHash: r.state_hash,
		organizationId: r.organization_id,
		nonce: r.nonce,
		returnTo: r.return_to,
		offeringId: r.offering_id ?? undefined,
		expiresAtIso: r.expires_at,
	};
}

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
		return integration(rows[0]);
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
	): Promise<
		| {
				session: CustomerSessionRecord;
				customer: FestivalCustomerRecord | null;
				integration: CustomerAccountIntegrationRecord | null;
		  }
		| { organizationMismatch: true }
		| null
	> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT
				s.session_id AS s_session_id,
				s.customer_id AS s_customer_id,
				s.organization_id AS s_organization_id,
				s.shopify_customer_gid AS s_shopify_customer_gid,
				s.encrypted_tokens AS s_encrypted_tokens,
				s.csrf_token AS s_csrf_token,
				s.integration_version AS s_integration_version,
				s.created_at AS s_created_at,
				s.last_seen_at AS s_last_seen_at,
				s.expires_at AS s_expires_at,
				s.revoked_at AS s_revoked_at,
				c.id AS c_id,
				c.organization_id AS c_organization_id,
				c.shopify_customer_gid AS c_shopify_customer_gid,
				c.name AS c_name,
				c.name_source AS c_name_source,
				c.name_updated_at AS c_name_updated_at,
				c.email AS c_email,
				c.email_source AS c_email_source,
				c.email_updated_at AS c_email_updated_at,
				c.mailing_address AS c_mailing_address,
				c.mailing_address_source AS c_mailing_address_source,
				c.mailing_address_updated_at AS c_mailing_address_updated_at,
				c.phone AS c_phone,
				c.phone_source AS c_phone_source,
				c.phone_updated_at AS c_phone_updated_at,
				c.created_at AS c_created_at,
				c.updated_at AS c_updated_at,
				i.organization_id AS i_organization_id,
				i.storefront_domain AS i_storefront_domain,
				i.client_id AS i_client_id,
				i.encrypted_client_secret AS i_encrypted_client_secret,
				i.readiness AS i_readiness,
				i.can_read_orders AS i_can_read_orders,
				i.integration_version AS i_integration_version,
				i.verified_at AS i_verified_at,
				i.last_error AS i_last_error,
				i.created_at AS i_created_at,
				i.updated_at AS i_updated_at
			FROM ${this.schema}.shopify_customer_sessions s
			LEFT JOIN ${this.schema}.festival_customers c
				ON c.id = s.customer_id AND c.organization_id = $2
			LEFT JOIN ${this.schema}.shopify_customer_account_integrations i
				ON i.organization_id = $2
			WHERE s.session_id = $1`,
			[sessionId, organizationId],
		)) as JoinedSessionCustomerIntegrationRow[];
		const row = rows[0];
		if (!row) return null;
		if (row.s_organization_id !== organizationId) {
			return { organizationMismatch: true };
		}
		return {
			session: session({
				session_id: row.s_session_id,
				customer_id: row.s_customer_id,
				organization_id: row.s_organization_id,
				shopify_customer_gid: row.s_shopify_customer_gid,
				encrypted_tokens: row.s_encrypted_tokens,
				csrf_token: row.s_csrf_token,
				integration_version: row.s_integration_version,
				created_at: row.s_created_at,
				last_seen_at: row.s_last_seen_at,
				expires_at: row.s_expires_at,
				revoked_at: row.s_revoked_at,
			}),
			customer: extractJoinedCustomer(row),
			integration: extractJoinedIntegration(row),
		};
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
		const values = [
			input.organizationId,
			input.customerId,
			input.source,
			input.updatedAtIso,
			input.profile.name ?? null,
			input.profile.email ?? null,
			input.profile.mailingAddress ?? null,
			input.profile.phone ?? null,
		];
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.festival_customers SET
			name=CASE WHEN $5::text IS NULL OR ($3='shopify' AND name_source='festival') OR name_updated_at>$4 THEN name ELSE $5 END,
			name_source=CASE WHEN $5::text IS NULL OR ($3='shopify' AND name_source='festival') OR name_updated_at>$4 THEN name_source ELSE $3 END,
			name_updated_at=CASE WHEN $5::text IS NULL OR ($3='shopify' AND name_source='festival') OR name_updated_at>$4 THEN name_updated_at ELSE $4 END,
			email=CASE WHEN $6::text IS NULL OR ($3='shopify' AND email_source='festival') OR email_updated_at>$4 THEN email ELSE $6 END,
			email_source=CASE WHEN $6::text IS NULL OR ($3='shopify' AND email_source='festival') OR email_updated_at>$4 THEN email_source ELSE $3 END,
			email_updated_at=CASE WHEN $6::text IS NULL OR ($3='shopify' AND email_source='festival') OR email_updated_at>$4 THEN email_updated_at ELSE $4 END,
			mailing_address=CASE WHEN $7::jsonb IS NULL OR ($3='shopify' AND mailing_address_source='festival') OR mailing_address_updated_at>$4 THEN mailing_address ELSE $7::jsonb END,
			mailing_address_source=CASE WHEN $7::jsonb IS NULL OR ($3='shopify' AND mailing_address_source='festival') OR mailing_address_updated_at>$4 THEN mailing_address_source ELSE $3 END,
			mailing_address_updated_at=CASE WHEN $7::jsonb IS NULL OR ($3='shopify' AND mailing_address_source='festival') OR mailing_address_updated_at>$4 THEN mailing_address_updated_at ELSE $4 END,
			phone=CASE WHEN $8::text IS NULL OR ($3='shopify' AND phone_source='festival') OR phone_updated_at>$4 THEN phone ELSE $8 END,
			phone_source=CASE WHEN $8::text IS NULL OR ($3='shopify' AND phone_source='festival') OR phone_updated_at>$4 THEN phone_source ELSE $3 END,
			phone_updated_at=CASE WHEN $8::text IS NULL OR ($3='shopify' AND phone_source='festival') OR phone_updated_at>$4 THEN phone_updated_at ELSE $4 END,
			updated_at=GREATEST(updated_at,$4)
			WHERE organization_id=$1 AND id=$2 RETURNING *`,
			values,
		)) as CustomerRow[];
		return rows[0] ? customer(rows[0]) : null;
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
			// Serialize snapshot replacement per child so only one concurrent writer
			// can observe the previous active row before inserting its replacement.
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
	async createChildWithAgeSnapshot(input: {
		child: Omit<FestivalChildRecord, "id" | "createdAtIso">;
		snapshot: Omit<
			FestivalChildAgeSnapshot,
			"id" | "childId" | "organizationId" | "createdAtIso" | "supersededAtIso"
		>;
	}): Promise<{
		child: FestivalChildRecord;
		ageSnapshot: FestivalChildAgeSnapshot;
	}> {
		await this.ensureReady();
		const childId = randomUUID();
		const snapshotId = randomUUID();
		const createdAtIso = new Date().toISOString();
		const rows = (await sql.unsafe(
			`WITH inserted_child AS (
				INSERT INTO ${this.schema}.festival_children (id, organization_id, parent_customer_id, display_name, created_at)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING id, organization_id, parent_customer_id, display_name, created_at
			),
			inserted_snapshot AS (
				INSERT INTO ${this.schema}.festival_child_age_snapshots (id, child_id, organization_id, age, created_at, valid_until)
				SELECT $6, c.id, c.organization_id, $7, $5, $8
				FROM inserted_child c
				RETURNING id, child_id, organization_id, age, created_at, valid_until, superseded_at
			)
			SELECT
				c.id AS child_id,
				c.organization_id AS child_organization_id,
				c.parent_customer_id AS child_parent_customer_id,
				c.display_name AS child_display_name,
				c.created_at AS child_created_at,
				s.id AS snapshot_id,
				s.child_id AS snapshot_child_id,
				s.organization_id AS snapshot_organization_id,
				s.age AS snapshot_age,
				s.created_at AS snapshot_created_at,
				s.valid_until AS snapshot_valid_until,
				s.superseded_at AS snapshot_superseded_at
			FROM inserted_child c
			CROSS JOIN inserted_snapshot s`,
			[
				childId,
				input.child.organizationId,
				input.child.parentCustomerId,
				input.child.displayName,
				createdAtIso,
				snapshotId,
				input.snapshot.age,
				input.snapshot.validUntilIso,
			],
		)) as ChildWithAgeSnapshotCteRow[];
		const row = rows[0];
		if (!row) throw new Error("Failed to create child with age snapshot.");
		return {
			child: childRecord({
				id: row.child_id,
				organization_id: row.child_organization_id,
				parent_customer_id: row.child_parent_customer_id,
				display_name: row.child_display_name,
				created_at: row.child_created_at,
			}),
			ageSnapshot: childAgeSnapshot({
				id: row.snapshot_id,
				child_id: row.snapshot_child_id,
				organization_id: row.snapshot_organization_id,
				age: row.snapshot_age,
				created_at: row.snapshot_created_at,
				valid_until: row.snapshot_valid_until,
				superseded_at: row.snapshot_superseded_at,
			}),
		};
	}
}
