import { randomUUID } from "node:crypto";
import type { CustomerMailingAddress } from "@festival/common";
import { sql } from "bun";
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
	expires_at: string;
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

function customer(row: CustomerRow): FestivalCustomerRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		shopifyCustomerGid: row.shopify_customer_gid,
		name: {
			value: row.name,
			source: row.name_source,
			updatedAtIso: row.name_updated_at,
		},
		email: {
			value: row.email,
			source: row.email_source,
			updatedAtIso: row.email_updated_at,
		},
		mailingAddress: {
			value: mailingAddress(row.mailing_address),
			source: row.mailing_address_source,
			updatedAtIso: row.mailing_address_updated_at,
		},
		phone: {
			value: row.phone,
			source: row.phone_source,
			updatedAtIso: row.phone_updated_at,
		},
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}

export class PostgresCustomerAccountRepository
	implements CustomerAccountRepository
{
	private ready?: Promise<void>;
	constructor(private schema: string) {
		this.schema = schemaName(schema);
	}
	async ensureReady() {
		this.ready ??= this.migrate();
		await this.ready;
	}
	private async migrate() {
		await sql.unsafe(`
		CREATE TABLE IF NOT EXISTS ${this.schema}.shopify_customer_account_integrations (
			organization_id TEXT PRIMARY KEY REFERENCES ${this.schema}.organizations(id) ON DELETE CASCADE,
			storefront_domain TEXT NOT NULL, client_id TEXT NOT NULL, encrypted_client_secret TEXT NOT NULL,
			readiness TEXT NOT NULL DEFAULT 'unknown' CHECK (readiness IN ('unknown','ready','failed')),
			can_read_orders BOOLEAN NOT NULL DEFAULT FALSE, integration_version BIGINT NOT NULL DEFAULT 1 CHECK (integration_version > 0),
			verified_at TIMESTAMPTZ NULL, last_error TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${this.schema}.shopify_customer_oauth_states (
			state_hash TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations(id) ON DELETE CASCADE,
			nonce TEXT NOT NULL, return_to TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ${this.schema}.festival_customers (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations(id) ON DELETE CASCADE,
			shopify_customer_gid TEXT NOT NULL,
			name TEXT NULL, name_source TEXT NULL CHECK (name_source IN ('shopify','festival')), name_updated_at TIMESTAMPTZ NULL,
			email TEXT NULL, email_source TEXT NULL CHECK (email_source IN ('shopify','festival')), email_updated_at TIMESTAMPTZ NULL,
			mailing_address JSONB NULL, mailing_address_source TEXT NULL CHECK (mailing_address_source IN ('shopify','festival')), mailing_address_updated_at TIMESTAMPTZ NULL,
			phone TEXT NULL, phone_source TEXT NULL CHECK (phone_source IN ('shopify','festival')), phone_updated_at TIMESTAMPTZ NULL,
			created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
			UNIQUE (organization_id, shopify_customer_gid),
			UNIQUE (id, organization_id),
			UNIQUE (id, organization_id, shopify_customer_gid)
		);
		CREATE TABLE IF NOT EXISTS ${this.schema}.shopify_customer_sessions (
			session_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations(id) ON DELETE CASCADE,
			customer_id TEXT NULL, shopify_customer_gid TEXT NOT NULL, encrypted_tokens TEXT NOT NULL, csrf_token TEXT NOT NULL,
			integration_version BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ NULL
		);
		ALTER TABLE ${this.schema}.shopify_customer_sessions ADD COLUMN IF NOT EXISTS customer_id TEXT NULL;
		INSERT INTO ${this.schema}.festival_customers (id,organization_id,shopify_customer_gid,created_at,updated_at)
			SELECT 'cus_' || md5(s.organization_id || chr(31) || s.shopify_customer_gid || random()::text || clock_timestamp()::text), s.organization_id, s.shopify_customer_gid, MIN(s.created_at), MAX(s.last_seen_at)
		FROM ${this.schema}.shopify_customer_sessions s
		WHERE s.customer_id IS NULL
		GROUP BY s.organization_id, s.shopify_customer_gid
		ON CONFLICT (organization_id,shopify_customer_gid) DO NOTHING;
		UPDATE ${this.schema}.shopify_customer_sessions s
		SET customer_id=c.id
		FROM ${this.schema}.festival_customers c
		WHERE s.customer_id IS NULL AND c.organization_id=s.organization_id AND c.shopify_customer_gid=s.shopify_customer_gid;
		ALTER TABLE ${this.schema}.shopify_customer_sessions ALTER COLUMN customer_id SET NOT NULL;
		DO $migration$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='shopify_customer_sessions_customer_identity_fk' AND conrelid='${this.schema}.shopify_customer_sessions'::regclass) THEN
				ALTER TABLE ${this.schema}.shopify_customer_sessions ADD CONSTRAINT shopify_customer_sessions_customer_identity_fk FOREIGN KEY (customer_id,organization_id,shopify_customer_gid) REFERENCES ${this.schema}.festival_customers(id,organization_id,shopify_customer_gid) ON DELETE CASCADE;
			END IF;
		END $migration$;
		CREATE TABLE IF NOT EXISTS ${this.schema}.festival_customer_staff_consents (
			customer_id TEXT NOT NULL,
			organization_id TEXT NOT NULL,
			privacy_notice_version TEXT NOT NULL,
			consented_at TIMESTAMPTZ NOT NULL,
			PRIMARY KEY (customer_id,privacy_notice_version),
			FOREIGN KEY (customer_id,organization_id) REFERENCES ${this.schema}.festival_customers(id,organization_id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS ${this.schema}.festival_customer_profile_access_audit (
			id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations(id) ON DELETE CASCADE,
			actor_uid TEXT NOT NULL,
			action TEXT NOT NULL CHECK (action IN ('view','search')),
			target_customer_id TEXT NULL,
			result_count INTEGER NULL CHECK (result_count >= 0),
			occurred_at TIMESTAMPTZ NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_shopify_customer_sessions_org ON ${this.schema}.shopify_customer_sessions(organization_id);
		CREATE INDEX IF NOT EXISTS idx_festival_customers_org_name ON ${this.schema}.festival_customers(organization_id,LOWER(name));
		CREATE INDEX IF NOT EXISTS idx_festival_customers_org_email ON ${this.schema}.festival_customers(organization_id,LOWER(email));
		CREATE INDEX IF NOT EXISTS idx_festival_customers_org_phone ON ${this.schema}.festival_customers(organization_id,phone);
	`);
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
			`INSERT INTO ${this.schema}.shopify_customer_oauth_states(state_hash,organization_id,nonce,return_to,expires_at) VALUES($1,$2,$3,$4,$5)`,
			[s.stateHash, s.organizationId, s.nonce, s.returnTo, s.expiresAtIso],
		);
	}
	async consumeOAuthState(hash: string, now: string) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`DELETE FROM ${this.schema}.shopify_customer_oauth_states WHERE state_hash=$1 AND expires_at>$2 RETURNING *`,
			[hash, now],
		)) as StateRow[];
		const r = rows[0];
		return r
			? {
					stateHash: r.state_hash,
					organizationId: r.organization_id,
					nonce: r.nonce,
					returnTo: r.return_to,
					expiresAtIso: r.expires_at,
				}
			: null;
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
	async applyCustomerProfile(input: ApplyCustomerProfileInput) {
		await this.ensureReady();
		const values = [
			input.organizationId,
			input.customerId,
			input.source,
			input.updatedAtIso,
			input.profile.name ?? null,
			input.profile.email ?? null,
			input.profile.mailingAddress
				? JSON.stringify(input.profile.mailingAddress)
				: null,
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
		)) as Array<{
			customer_id: string;
			organization_id: string;
			privacy_notice_version: string;
			consented_at: string;
		}>;
		const row = rows[0];
		if (!row) throw new Error("Customer consent persistence failed.");
		return {
			customerId: row.customer_id,
			organizationId: row.organization_id,
			privacyNoticeVersion: row.privacy_notice_version,
			consentedAtIso: row.consented_at,
		};
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
}
