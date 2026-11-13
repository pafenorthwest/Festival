import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s10-infra.js";
import {
	type ConsentRow,
	type CustomerRow,
	consentRowToRecord,
	customerRowToRecord,
} from "./mappers.js";
import type {
	ApplyCustomerProfileInput,
	CustomerProfileAccessAuditRecord,
	CustomerProfileRepository,
	CustomerStaffAccessConsentRecord,
	FestivalCustomerRecord,
} from "./types.js";

/** Postgres repository for customer profiles, staff consents, and access audits. */
export class PostgresCustomerProfileRepository
	implements CustomerProfileRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async getCustomer(
		organizationId: string,
		customerId: string,
	): Promise<FestivalCustomerRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.festival_customers WHERE organization_id = $1 AND id = $2`,
			[organizationId, customerId],
		)) as CustomerRow[];
		return rows[0] ? customerRowToRecord(rows[0]) : null;
	}

	async getCustomerByShopifyGid(
		organizationId: string,
		shopifyCustomerGid: string,
	): Promise<FestivalCustomerRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT * FROM ${this.schema}.festival_customers WHERE organization_id = $1 AND shopify_customer_gid = $2`,
			[organizationId, shopifyCustomerGid],
		)) as CustomerRow[];
		return rows[0] ? customerRowToRecord(rows[0]) : null;
	}

	async recordVerifiedShopifyEmail(input: {
		organizationId: string;
		customerId: string;
		email: string;
		verifiedAtIso: string;
	}): Promise<FestivalCustomerRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.festival_customers
			SET email = $3, email_source = 'shopify', email_updated_at = $4, updated_at = GREATEST(updated_at, $4)
			WHERE organization_id = $1 AND id = $2
			RETURNING *`,
			[
				input.organizationId,
				input.customerId,
				input.email,
				input.verifiedAtIso,
			],
		)) as CustomerRow[];
		return rows[0] ? customerRowToRecord(rows[0]) : null;
	}

	async applyCustomerProfile(
		input: ApplyCustomerProfileInput,
	): Promise<FestivalCustomerRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.festival_customers SET
				name = CASE WHEN $5::text IS NULL OR ($3 = 'shopify' AND name_source = 'festival') OR name_updated_at > $4 THEN name ELSE $5 END,
				name_source = CASE WHEN $5::text IS NULL OR ($3 = 'shopify' AND name_source = 'festival') OR name_updated_at > $4 THEN name_source ELSE $3 END,
				name_updated_at = CASE WHEN $5::text IS NULL OR ($3 = 'shopify' AND name_source = 'festival') OR name_updated_at > $4 THEN name_updated_at ELSE $4 END,
				email = CASE WHEN $6::text IS NULL OR ($3 = 'shopify' AND email_source = 'festival') OR email_updated_at > $4 THEN email ELSE $6 END,
				email_source = CASE WHEN $6::text IS NULL OR ($3 = 'shopify' AND email_source = 'festival') OR email_updated_at > $4 THEN email_source ELSE $3 END,
				email_updated_at = CASE WHEN $6::text IS NULL OR ($3 = 'shopify' AND email_source = 'festival') OR email_updated_at > $4 THEN email_updated_at ELSE $4 END,
				mailing_address = CASE WHEN $7::jsonb IS NULL OR ($3 = 'shopify' AND mailing_address_source = 'festival') OR mailing_address_updated_at > $4 THEN mailing_address ELSE $7::jsonb END,
				mailing_address_source = CASE WHEN $7::jsonb IS NULL OR ($3 = 'shopify' AND mailing_address_source = 'festival') OR mailing_address_updated_at > $4 THEN mailing_address_source ELSE $3 END,
				mailing_address_updated_at = CASE WHEN $7::jsonb IS NULL OR ($3 = 'shopify' AND mailing_address_source = 'festival') OR mailing_address_updated_at > $4 THEN mailing_address_updated_at ELSE $4 END,
				phone = CASE WHEN $8::text IS NULL OR ($3 = 'shopify' AND phone_source = 'festival') OR phone_updated_at > $4 THEN phone ELSE $8 END,
				phone_source = CASE WHEN $8::text IS NULL OR ($3 = 'shopify' AND phone_source = 'festival') OR phone_updated_at > $4 THEN phone_source ELSE $3 END,
				phone_updated_at = CASE WHEN $8::text IS NULL OR ($3 = 'shopify' AND phone_source = 'festival') OR phone_updated_at > $4 THEN phone_updated_at ELSE $4 END,
				updated_at = GREATEST(updated_at, $4)
			WHERE organization_id = $1 AND id = $2
			RETURNING *`,
			[
				input.organizationId,
				input.customerId,
				input.source,
				input.updatedAtIso,
				input.profile.name ?? null,
				input.profile.email ?? null,
				input.profile.mailingAddress ?? null,
				input.profile.phone ?? null,
			],
		)) as CustomerRow[];
		return rows[0] ? customerRowToRecord(rows[0]) : null;
	}

	async recordStaffAccessConsent(
		consent: CustomerStaffAccessConsentRecord,
	): Promise<CustomerStaffAccessConsentRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.festival_customer_staff_consents (customer_id, organization_id, privacy_notice_version, consented_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (customer_id, privacy_notice_version) DO UPDATE SET
				consented_at = LEAST(${this.schema}.festival_customer_staff_consents.consented_at, EXCLUDED.consented_at)
			RETURNING *`,
			[
				consent.customerId,
				consent.organizationId,
				consent.privacyNoticeVersion,
				consent.consentedAtIso,
			],
		)) as ConsentRow[];
		if (!rows[0]) {
			throw new Error("Customer consent persistence failed.");
		}
		return consentRowToRecord(rows[0]);
	}

	async getConsentedCustomer(
		organizationId: string,
		customerId: string,
		privacyNoticeVersion: string,
	): Promise<FestivalCustomerRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT c.* FROM ${this.schema}.festival_customers c
			JOIN ${this.schema}.festival_customer_staff_consents consent
				ON consent.customer_id = c.id AND consent.organization_id = c.organization_id
			WHERE c.organization_id = $1 AND c.id = $2 AND consent.privacy_notice_version = $3`,
			[organizationId, customerId, privacyNoticeVersion],
		)) as CustomerRow[];
		return rows[0] ? customerRowToRecord(rows[0]) : null;
	}

	async searchConsentedCustomers(
		organizationId: string,
		query: string,
		privacyNoticeVersion: string,
		limit: number,
	): Promise<FestivalCustomerRecord[]> {
		await this.ensureReady();
		const escaped = query.replace(/[\\%_]/g, (value) => `\\${value}`);
		const rows = (await sql.unsafe(
			`SELECT c.* FROM ${this.schema}.festival_customers c
			JOIN ${this.schema}.festival_customer_staff_consents consent
				ON consent.customer_id = c.id AND consent.organization_id = c.organization_id
			WHERE c.organization_id = $1 AND consent.privacy_notice_version = $2
				AND (LOWER(c.name) LIKE LOWER($3) ESCAPE '\\' OR LOWER(c.email) LIKE LOWER($3) ESCAPE '\\' OR c.phone LIKE $3 ESCAPE '\\')
			ORDER BY LOWER(COALESCE(c.name, '')), c.id
			LIMIT $4`,
			[organizationId, privacyNoticeVersion, `%${escaped}%`, limit],
		)) as CustomerRow[];
		return rows.map(customerRowToRecord);
	}

	async recordCustomerProfileAccessAudit(
		audit: CustomerProfileAccessAuditRecord,
	): Promise<void> {
		await this.ensureReady();
		await sql.unsafe(
			`INSERT INTO ${this.schema}.festival_customer_profile_access_audit (organization_id, actor_uid, action, target_customer_id, result_count, occurred_at)
			VALUES ($1, $2, $3, $4, $5, $6)`,
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
}
