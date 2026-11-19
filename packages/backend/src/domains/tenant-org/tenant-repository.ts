import { randomUUID } from "node:crypto";
import type {
	AccompanistDivisionSelectionPolicy,
	OrganizationRecord,
	RegistrationAgeConfiguration,
} from "@festival/common";
import { sql } from "bun";
import {
	defaultPostgresSchemaName,
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s09-infra.js";
import {
	type AccompanistDivisionPolicyHistoryRecord,
	type AccompanistDivisionPolicyRecord,
	mapOrganization,
	type OrganizationRow,
	toDateOnly,
	toIso,
} from "./tenant-mappers.js";

interface AccompanistPolicyRow {
	organization_id: string;
	policy: AccompanistDivisionSelectionPolicy;
	updated_at: Date | string;
}

interface AccompanistPolicyHistoryRow {
	id: string;
	organization_id: string;
	policy: AccompanistDivisionSelectionPolicy;
	created_at: Date | string;
}

interface AgeConfigurationRow {
	organization_id: string;
	registration_age_date: Date | string;
	updated_at: Date | string;
}

export interface TenantRepository {
	ensureReady(): Promise<void>;
	findOrganizationById(
		organizationId: string,
	): Promise<OrganizationRecord | null>;
	listOrganizationSlugs(): Promise<Array<Pick<OrganizationRecord, "slug">>>;
	findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	findOrganizationByName(name: string): Promise<OrganizationRecord | null>;
	findOrganizationByShopDomain(
		shopDomain: string,
	): Promise<OrganizationRecord | null>;
	createOrganization(input: {
		name: string;
		slug: string;
		defaultCurrencyCode?: string;
	}): Promise<OrganizationRecord>;
	getOrganizationTimezone(organizationId: string): Promise<string>;
	updateOrganizationTimezone(
		organizationId: string,
		timezone: string,
	): Promise<string>;
	getAccompanistDivisionPolicy(
		organizationId: string,
	): Promise<AccompanistDivisionPolicyRecord>;
	updateAccompanistDivisionPolicy(input: {
		organizationId: string;
		policy: AccompanistDivisionSelectionPolicy;
	}): Promise<AccompanistDivisionPolicyRecord>;
	listAccompanistDivisionPolicyHistory(
		organizationId: string,
	): Promise<AccompanistDivisionPolicyHistoryRecord[]>;
	getRegistrationAgeConfiguration(
		organizationId: string,
	): Promise<RegistrationAgeConfiguration | null>;
	updateRegistrationAgeConfiguration(input: {
		organizationId: string;
		registrationAgeDate: string;
	}): Promise<RegistrationAgeConfiguration>;
}

/** PostgreSQL implementation of TenantRepository. */
export class PostgresTenantRepository implements TenantRepository {
	private readonly schema: string;

	constructor(
		schemaName = defaultPostgresSchemaName(),
		private readonly ensureReadyOverride?: () => Promise<void>,
	) {
		this.schema = postgresSchemaName(schemaName);
	}

	async ensureReady(): Promise<void> {
		if (this.ensureReadyOverride) return this.ensureReadyOverride();
		await initializePostgresSchema(this.schema);
	}

	async findOrganizationById(
		organizationId: string,
	): Promise<OrganizationRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, name, slug, timezone, default_currency_code, created_at
			 FROM ${this.schema}.organizations
			 WHERE id = $1
			 LIMIT 1`,
			[organizationId],
		)) as OrganizationRow[];
		return rows[0] ? mapOrganization(rows[0]) : null;
	}

	async listOrganizationSlugs() {
		await this.ensureReady();
		return (await sql.unsafe(
			`SELECT slug FROM ${this.schema}.organizations ORDER BY slug COLLATE "C"`,
		)) as Array<Pick<OrganizationRecord, "slug">>;
	}

	async findOrganizationBySlug(
		slug: string,
	): Promise<OrganizationRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, name, slug, timezone, default_currency_code, created_at
			 FROM ${this.schema}.organizations
			 WHERE slug = $1
			 LIMIT 1`,
			[slug.toLowerCase()],
		)) as OrganizationRow[];
		return rows[0] ? mapOrganization(rows[0]) : null;
	}

	async findOrganizationByName(
		name: string,
	): Promise<OrganizationRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, name, slug, timezone, default_currency_code, created_at
			 FROM ${this.schema}.organizations
			 WHERE LOWER(name) = LOWER($1)
			 LIMIT 1`,
			[name.trim()],
		)) as OrganizationRow[];
		return rows[0] ? mapOrganization(rows[0]) : null;
	}

	async findOrganizationByShopDomain(
		shopDomain: string,
	): Promise<OrganizationRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT o.id, o.name, o.slug, o.timezone, o.default_currency_code, o.created_at
			 FROM ${this.schema}.organizations o
			 JOIN ${this.schema}.shopify_integrations i ON i.organization_id = o.id
			 WHERE i.verification_status = 'ok'
			   AND (i.store_domain = $1 OR i.verified_shop_domain = $1)
			 LIMIT 1`,
			[shopDomain.toLowerCase()],
		)) as OrganizationRow[];
		return rows[0] ? mapOrganization(rows[0]) : null;
	}

	async createOrganization(input: {
		name: string;
		slug: string;
		defaultCurrencyCode?: string;
	}): Promise<OrganizationRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.organizations (id, name, slug, default_currency_code)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id, name, slug, timezone, default_currency_code, created_at`,
			[
				randomUUID(),
				input.name.trim(),
				input.slug.toLowerCase(),
				input.defaultCurrencyCode ?? "USD",
			],
		)) as OrganizationRow[];
		if (!rows[0]) throw new Error("Failed to create organization.");
		return mapOrganization(rows[0]);
	}

	async getOrganizationTimezone(organizationId: string): Promise<string> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT timezone FROM ${this.schema}.organizations WHERE id = $1 LIMIT 1`,
			[organizationId],
		)) as Array<{ timezone: string }>;
		if (!rows[0]) throw new Error("Organization not found.");
		return rows[0].timezone;
	}

	async updateOrganizationTimezone(
		organizationId: string,
		timezone: string,
	): Promise<string> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.organizations
			 SET timezone = $2
			 WHERE id = $1
			 RETURNING timezone`,
			[organizationId, timezone],
		)) as Array<{ timezone: string }>;
		if (!rows[0]) throw new Error("Organization not found.");
		return rows[0].timezone;
	}

	async getAccompanistDivisionPolicy(
		organizationId: string,
	): Promise<AccompanistDivisionPolicyRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT organization_id, policy, updated_at
			 FROM ${this.schema}.membership_division_policies
			 WHERE organization_id = $1 AND entitlement_class = 'accompanist_membership'`,
			[organizationId],
		)) as AccompanistPolicyRow[];
		const row = rows[0];
		return row
			? {
					organizationId: row.organization_id,
					policy: row.policy,
					updatedAtIso: toIso(row.updated_at),
				}
			: {
					organizationId,
					policy: "exactly_one",
					updatedAtIso: new Date().toISOString(),
				};
	}

	async updateAccompanistDivisionPolicy(input: {
		organizationId: string;
		policy: AccompanistDivisionSelectionPolicy;
	}): Promise<AccompanistDivisionPolicyRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.membership_division_policies
				(organization_id, entitlement_class, policy, updated_at)
			 VALUES ($1, 'accompanist_membership', $2, NOW())
			 ON CONFLICT (organization_id, entitlement_class) DO UPDATE
			 SET policy = EXCLUDED.policy, updated_at = NOW()
			 RETURNING organization_id, policy, updated_at`,
			[input.organizationId, input.policy],
		)) as AccompanistPolicyRow[];
		const row = rows[0];
		if (!row) throw new Error("Unable to save accompanist division policy.");
		const record = {
			organizationId: row.organization_id,
			policy: row.policy,
			updatedAtIso: toIso(row.updated_at),
		};
		await sql.unsafe(
			`INSERT INTO ${this.schema}.membership_division_policy_history (id, organization_id, entitlement_class, policy)
			 VALUES ($1, $2, 'accompanist_membership', $3)`,
			[randomUUID(), record.organizationId, record.policy],
		);
		return record;
	}

	async listAccompanistDivisionPolicyHistory(
		organizationId: string,
	): Promise<AccompanistDivisionPolicyHistoryRecord[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, policy, created_at
			 FROM ${this.schema}.membership_division_policy_history
			 WHERE organization_id = $1 AND entitlement_class = 'accompanist_membership'
			 ORDER BY created_at, id`,
			[organizationId],
		)) as AccompanistPolicyHistoryRow[];
		return rows.map((row) => ({
			id: row.id,
			organizationId: row.organization_id,
			policy: row.policy,
			updatedAtIso: toIso(row.created_at),
			createdAtIso: toIso(row.created_at),
		}));
	}

	async getRegistrationAgeConfiguration(
		organizationId: string,
	): Promise<RegistrationAgeConfiguration | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT organization_id, registration_age_date, updated_at
			 FROM ${this.schema}.registration_age_configurations
			 WHERE organization_id = $1
			 LIMIT 1`,
			[organizationId],
		)) as AgeConfigurationRow[];
		const row = rows[0];
		if (!row) return null;
		return {
			organizationId: row.organization_id,
			registrationAgeDate: toDateOnly(row.registration_age_date),
			updatedAtIso: toIso(row.updated_at),
		};
	}

	async updateRegistrationAgeConfiguration(input: {
		organizationId: string;
		registrationAgeDate: string;
	}): Promise<RegistrationAgeConfiguration> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.registration_age_configurations
				(organization_id, registration_age_date, updated_at)
			 VALUES ($1, $2::date, NOW())
			 ON CONFLICT (organization_id) DO UPDATE
			 SET registration_age_date = EXCLUDED.registration_age_date, updated_at = NOW()
			 RETURNING organization_id, registration_age_date, updated_at`,
			[input.organizationId, input.registrationAgeDate],
		)) as AgeConfigurationRow[];
		const row = rows[0];
		if (!row) {
			throw new Error("Unable to save registration age configuration.");
		}
		return {
			organizationId: row.organization_id,
			registrationAgeDate: toDateOnly(row.registration_age_date),
			updatedAtIso: toIso(row.updated_at),
		};
	}
}
