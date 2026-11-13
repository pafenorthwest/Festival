import { randomUUID } from "node:crypto";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s10-infra.js";
import {
	type CustomerRow,
	customerRowToRecord,
	extractJoinedCustomer,
	extractJoinedIntegration,
	type JoinedSessionCustomerIntegrationRow,
	type SessionRow,
	type StateRow,
	sessionRowToRecord,
	stateRowToRecord,
} from "./mappers.js";
import type {
	CustomerOAuthStateRecord,
	CustomerSessionRecord,
	CustomerSessionRepository,
	CustomerSessionTokenReplacementInput,
	CustomerSessionTouchInput,
	FestivalCustomerRecord,
	JoinedSessionCustomerIntegration,
} from "./types.js";

async function queryJoinedSession(
	schema: string,
	sessionId: string,
	organizationId: string,
): Promise<
	JoinedSessionCustomerIntegration | { organizationMismatch: true } | null
> {
	const rows = (await sql.unsafe(
		`SELECT s.session_id AS s_session_id, s.customer_id AS s_customer_id, s.organization_id AS s_organization_id, s.shopify_customer_gid AS s_shopify_customer_gid, s.encrypted_tokens AS s_encrypted_tokens, s.csrf_token AS s_csrf_token, s.integration_version AS s_integration_version, s.created_at AS s_created_at, s.last_seen_at AS s_last_seen_at, s.expires_at AS s_expires_at, s.revoked_at AS s_revoked_at, c.id AS c_id, c.organization_id AS c_organization_id, c.shopify_customer_gid AS c_shopify_customer_gid, c.name AS c_name, c.name_source AS c_name_source, c.name_updated_at AS c_name_updated_at, c.email AS c_email, c.email_source AS c_email_source, c.email_updated_at AS c_email_updated_at, c.mailing_address AS c_mailing_address, c.mailing_address_source AS c_mailing_address_source, c.mailing_address_updated_at AS c_mailing_address_updated_at, c.phone AS c_phone, c.phone_source AS c_phone_source, c.phone_updated_at AS c_phone_updated_at, c.created_at AS c_created_at, c.updated_at AS c_updated_at, i.organization_id AS i_organization_id, i.storefront_domain AS i_storefront_domain, i.client_id AS i_client_id, i.encrypted_client_secret AS i_encrypted_client_secret, i.readiness AS i_readiness, i.can_read_orders AS i_can_read_orders, i.integration_version AS i_integration_version, i.verified_at AS i_verified_at, i.last_error AS i_last_error, i.created_at AS i_created_at, i.updated_at AS i_updated_at
		FROM ${schema}.shopify_customer_sessions s
		LEFT JOIN ${schema}.festival_customers c ON c.id = s.customer_id AND c.organization_id = $2
		LEFT JOIN ${schema}.shopify_customer_account_integrations i ON i.organization_id = $2
		WHERE s.session_id = $1`,
		[sessionId, organizationId],
	)) as JoinedSessionCustomerIntegrationRow[];
	const row = rows[0];
	if (!row) return null;
	if (row.s_organization_id !== organizationId) {
		return { organizationMismatch: true };
	}
	return {
		session: sessionRowToRecord({
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

/** Postgres repository for Shopify OAuth states and customer sessions. */
export class PostgresCustomerSessionRepository
	implements CustomerSessionRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async putOAuthState(state: CustomerOAuthStateRecord): Promise<void> {
		await this.ensureReady();
		await sql.unsafe(
			`INSERT INTO ${this.schema}.shopify_customer_oauth_states (state_hash, organization_id, nonce, return_to, offering_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
			[
				state.stateHash,
				state.organizationId,
				state.nonce,
				state.returnTo,
				state.offeringId ?? null,
				state.expiresAtIso,
			],
		);
	}

	async consumeOAuthState(
		stateHash: string,
		nowIso: string,
	): Promise<CustomerOAuthStateRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`DELETE FROM ${this.schema}.shopify_customer_oauth_states WHERE state_hash = $1 AND expires_at > $2 RETURNING *`,
			[stateHash, nowIso],
		)) as StateRow[];
		return rows[0] ? stateRowToRecord(rows[0]) : null;
	}

	async createCustomerSession(
		input: Omit<CustomerSessionRecord, "customerId">,
	): Promise<{
		customer: FestivalCustomerRecord;
		session: CustomerSessionRecord;
	}> {
		await this.ensureReady();
		return sql.begin(async (transaction) => {
			const customerRows = (await transaction.unsafe(
				`INSERT INTO ${this.schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $4)
				ON CONFLICT (organization_id, shopify_customer_gid) DO UPDATE SET shopify_customer_gid = EXCLUDED.shopify_customer_gid
				RETURNING *`,
				[
					`cus_${randomUUID()}`,
					input.organizationId,
					input.shopifyCustomerGid,
					input.createdAtIso,
				],
			)) as CustomerRow[];
			const resolved = customerRows[0];
			if (!resolved) {
				throw new Error("Festival customer resolution failed.");
			}
			const sessionRows = (await transaction.unsafe(
				`INSERT INTO ${this.schema}.shopify_customer_sessions (session_id, customer_id, organization_id, shopify_customer_gid, encrypted_tokens, csrf_token, integration_version, created_at, last_seen_at, expires_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				RETURNING *`,
				[
					input.sessionId,
					resolved.id,
					input.organizationId,
					input.shopifyCustomerGid,
					input.encryptedTokens,
					input.csrfToken,
					input.integrationVersion,
					input.createdAtIso,
					input.lastSeenAtIso,
					input.expiresAtIso,
				],
			)) as SessionRow[];
			const createdSession = sessionRows[0];
			if (!createdSession) {
				throw new Error("Customer session creation failed.");
			}
			return {
				customer: customerRowToRecord(resolved),
				session: sessionRowToRecord(createdSession),
			};
		});
	}

	async getSession(sessionId: string): Promise<CustomerSessionRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.shopify_customer_sessions WHERE session_id = $1`,
			[sessionId],
		)) as SessionRow[];
		return rows[0] ? sessionRowToRecord(rows[0]) : null;
	}

	async findSessionCustomerAndIntegration(
		sessionId: string,
		organizationId: string,
	): Promise<
		JoinedSessionCustomerIntegration | { organizationMismatch: true } | null
	> {
		await this.ensureReady();
		return queryJoinedSession(this.schema, sessionId, organizationId);
	}

	async touchSession(
		input: CustomerSessionTouchInput,
	): Promise<CustomerSessionRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_sessions
			SET last_seen_at = GREATEST(last_seen_at, $4)
			WHERE session_id = $1 AND organization_id = $2 AND integration_version = $3 AND revoked_at IS NULL AND expires_at > $4 AND last_seen_at > $5
			RETURNING *`,
			[
				input.sessionId,
				input.organizationId,
				input.integrationVersion,
				input.seenAtIso,
				input.idleCutoffIso,
			],
		)) as SessionRow[];
		return rows[0] ? sessionRowToRecord(rows[0]) : null;
	}

	async replaceSessionTokens(
		input: CustomerSessionTokenReplacementInput,
	): Promise<CustomerSessionRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_sessions
			SET encrypted_tokens = $5, last_seen_at = GREATEST(last_seen_at, $6), expires_at = LEAST(expires_at, $7)
			WHERE session_id = $1 AND organization_id = $2 AND integration_version = $3 AND encrypted_tokens = $4 AND revoked_at IS NULL AND expires_at > $6 AND last_seen_at > $8
			RETURNING *`,
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
		return rows[0] ? sessionRowToRecord(rows[0]) : null;
	}

	async revokeSession(sessionId: string, revokedAtIso: string): Promise<void> {
		await this.ensureReady();
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_sessions SET revoked_at = $2 WHERE session_id = $1`,
			[sessionId, revokedAtIso],
		);
	}

	async revokeOrganizationSessions(
		organizationId: string,
		revokedAtIso: string,
	): Promise<void> {
		await this.ensureReady();
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_sessions SET revoked_at = $2 WHERE organization_id = $1 AND revoked_at IS NULL`,
			[organizationId, revokedAtIso],
		);
	}
}
