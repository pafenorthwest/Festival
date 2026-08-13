import { sql } from "bun";
import type {
	CustomerAccountIntegrationRecord,
	CustomerAccountRepository,
	CustomerOAuthStateRecord,
	CustomerSessionRecord,
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
		CREATE TABLE IF NOT EXISTS ${this.schema}.shopify_customer_sessions (
			session_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations(id) ON DELETE CASCADE,
			shopify_customer_gid TEXT NOT NULL, encrypted_tokens TEXT NOT NULL, csrf_token TEXT NOT NULL,
			integration_version BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ NULL
		);
		CREATE INDEX IF NOT EXISTS idx_shopify_customer_sessions_org ON ${this.schema}.shopify_customer_sessions(organization_id);
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
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.shopify_customer_account_integrations (organization_id,storefront_domain,client_id,encrypted_client_secret) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id) DO UPDATE SET storefront_domain=EXCLUDED.storefront_domain,client_id=EXCLUDED.client_id,encrypted_client_secret=EXCLUDED.encrypted_client_secret,readiness='unknown',can_read_orders=FALSE,integration_version=${this.schema}.shopify_customer_account_integrations.integration_version+1,verified_at=NULL,last_error=NULL,updated_at=NOW() RETURNING *`,
			[
				input.organizationId,
				input.storefrontDomain,
				input.clientId,
				input.encryptedClientSecret,
			],
		)) as IntegrationRow[];
		await this.revokeOrganizationSessions(
			input.organizationId,
			new Date().toISOString(),
		);
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
	async createSession(s: CustomerSessionRecord) {
		await this.ensureReady();
		await sql.unsafe(
			`INSERT INTO ${this.schema}.shopify_customer_sessions(session_id,organization_id,shopify_customer_gid,encrypted_tokens,csrf_token,integration_version,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			[
				s.sessionId,
				s.organizationId,
				s.shopifyCustomerGid,
				s.encryptedTokens,
				s.csrfToken,
				s.integrationVersion,
				s.createdAtIso,
				s.lastSeenAtIso,
				s.expiresAtIso,
			],
		);
	}
	async getSession(id: string) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.shopify_customer_sessions WHERE session_id=$1`,
			[id],
		)) as SessionRow[];
		return rows[0] ? session(rows[0]) : null;
	}
	async updateSession(s: CustomerSessionRecord) {
		await this.ensureReady();
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_sessions SET encrypted_tokens=$2,last_seen_at=$3,expires_at=$4,revoked_at=$5 WHERE session_id=$1`,
			[
				s.sessionId,
				s.encryptedTokens,
				s.lastSeenAtIso,
				s.expiresAtIso,
				s.revokedAtIso ?? null,
			],
		);
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
