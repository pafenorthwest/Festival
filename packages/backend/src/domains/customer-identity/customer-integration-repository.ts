import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s10-infra.js";
import { type IntegrationRow, integrationRowToRecord } from "./mappers.js";
import type {
	CustomerAccountIntegrationRecord,
	CustomerIntegrationRepository,
} from "./types.js";

/** Postgres repository for per-organization Shopify Customer Account integrations. */
export class PostgresCustomerIntegrationRepository
	implements CustomerIntegrationRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async getIntegration(
		organizationId: string,
	): Promise<CustomerAccountIntegrationRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.shopify_customer_account_integrations WHERE organization_id = $1`,
			[organizationId],
		)) as IntegrationRow[];
		return rows[0] ? integrationRowToRecord(rows[0]) : null;
	}

	async upsertIntegration(
		input: Pick<
			CustomerAccountIntegrationRecord,
			| "organizationId"
			| "storefrontDomain"
			| "clientId"
			| "encryptedClientSecret"
		>,
	): Promise<CustomerAccountIntegrationRecord> {
		await this.ensureReady();
		const rows = await sql.begin(async (transaction) => {
			const updated = (await transaction.unsafe(
				`INSERT INTO ${this.schema}.shopify_customer_account_integrations (organization_id, storefront_domain, client_id, encrypted_client_secret)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (organization_id) DO UPDATE SET
					storefront_domain = EXCLUDED.storefront_domain,
					client_id = EXCLUDED.client_id,
					encrypted_client_secret = EXCLUDED.encrypted_client_secret,
					readiness = 'unknown',
					can_read_orders = FALSE,
					integration_version = ${this.schema}.shopify_customer_account_integrations.integration_version + 1,
					verified_at = NULL,
					last_error = NULL,
					updated_at = NOW()
				RETURNING *`,
				[
					input.organizationId,
					input.storefrontDomain,
					input.clientId,
					input.encryptedClientSecret,
				],
			)) as IntegrationRow[];
			await transaction.unsafe(
				`UPDATE ${this.schema}.shopify_customer_sessions SET revoked_at = $2 WHERE organization_id = $1 AND revoked_at IS NULL`,
				[input.organizationId, new Date().toISOString()],
			);
			return updated;
		});
		const updatedRow = rows[0];
		if (!updatedRow) {
			throw new Error("Customer Account integration upsert failed.");
		}
		return integrationRowToRecord(updatedRow);
	}

	async setIntegrationReadiness(
		organizationId: string,
		input: {
			readiness: "ready" | "failed";
			canReadOrders: boolean;
			verifiedAtIso?: string;
			lastError?: string;
		},
	): Promise<CustomerAccountIntegrationRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_customer_account_integrations
			SET readiness = $2, can_read_orders = $3, verified_at = $4, last_error = $5, updated_at = NOW()
			WHERE organization_id = $1
			RETURNING *`,
			[
				organizationId,
				input.readiness,
				input.canReadOrders,
				input.verifiedAtIso ?? null,
				input.lastError ?? null,
			],
		)) as IntegrationRow[];
		if (!rows[0]) {
			throw new Error("Customer Account integration not found.");
		}
		return integrationRowToRecord(rows[0]);
	}
}
