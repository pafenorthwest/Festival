import { randomUUID } from "node:crypto";
import {
	type AccompanistDivisionSelectionPolicy,
	assertValidEntitlementDurationDays,
	type EntitlementClass,
} from "@festival/common";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s10-infra.js";
import {
	type AccompanistDivisionPolicyHistoryRow,
	type AccompanistDivisionPolicyRow,
	mapProductRow,
	type ProductRow,
	toIsoString,
} from "./mappers.js";
import type {
	AccompanistDivisionPolicyHistoryRecord,
	AccompanistDivisionPolicyRecord,
	CreateMembershipProductRecordInput,
	MembershipProductRepository,
	ProductRecord,
} from "./types.js";

const PRODUCT_COLUMNS = `id, organization_id, product_category, entitlement_class, duration_days, is_active, shopify_product_gid, shopify_variant_gid, product_name_snapshot, created_at, updated_at`;

function rethrowProductConstraintError(error: unknown): never {
	const msg =
		error && typeof error === "object" && "message" in error
			? String((error as { message?: unknown }).message)
			: "";
	if (msg.includes("idx_products_org_active_entitlement_class")) {
		throw new Error("Membership product already exists for this organization.");
	}
	if (
		msg.includes("idx_products_shopify_product_gid") ||
		msg.includes("idx_products_shopify_product_variant_gid")
	) {
		throw new Error("Shopify product is already associated.");
	}
	if (msg.includes("idx_products_shopify_variant_gid")) {
		throw new Error("Shopify variant is already associated.");
	}
	throw error;
}

/** Postgres repository for membership products and accompanist division policies. */
export class PostgresMembershipProductRepository
	implements MembershipProductRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async createMembershipProductRecord(
		input: CreateMembershipProductRecordInput,
	): Promise<ProductRecord> {
		await this.ensureReady();
		assertValidEntitlementDurationDays(input.durationDays);
		try {
			const [row] = (await sql.unsafe(
				`INSERT INTO ${this.schema}.products (
					id, organization_id, product_category, entitlement_class, duration_days, is_active, shopify_product_gid, shopify_variant_gid, product_name_snapshot, updated_at
				) VALUES ($1, $2, 'membership', $3, $4, $5, $6, $7, $8, NOW())
				RETURNING ${PRODUCT_COLUMNS}`,
				[
					randomUUID(),
					input.organizationId,
					input.entitlementClass,
					input.durationDays,
					input.isActive,
					input.shopifyProductGid,
					input.shopifyVariantGid,
					input.productNameSnapshot,
				],
			)) as ProductRow[];
			return mapProductRow(row);
		} catch (error) {
			rethrowProductConstraintError(error);
		}
	}

	async updateMembershipProductRecord(input: {
		organizationId: string;
		productId: string;
		productNameSnapshot?: string;
		durationDays?: number;
		isActive?: boolean;
	}): Promise<ProductRecord | null> {
		await this.ensureReady();
		if (input.durationDays !== undefined) {
			assertValidEntitlementDurationDays(input.durationDays);
		}
		try {
			const rows = (await sql.unsafe(
				`UPDATE ${this.schema}.products
				SET product_name_snapshot = COALESCE($3, product_name_snapshot), duration_days = COALESCE($4, duration_days), is_active = COALESCE($5, is_active), updated_at = NOW()
				WHERE id = $1 AND organization_id = $2
				RETURNING ${PRODUCT_COLUMNS}`,
				[
					input.productId,
					input.organizationId,
					input.productNameSnapshot ?? null,
					input.durationDays ?? null,
					input.isActive ?? null,
				],
			)) as ProductRow[];
			return rows[0] ? mapProductRow(rows[0]) : null;
		} catch (error) {
			rethrowProductConstraintError(error);
		}
	}

	async listMembershipProductRecords(
		organizationId: string,
	): Promise<ProductRecord[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${PRODUCT_COLUMNS}
			FROM ${this.schema}.products
			WHERE organization_id = $1 AND product_category = 'membership'
			ORDER BY created_at ASC`,
			[organizationId],
		)) as ProductRow[];
		return rows.map(mapProductRow);
	}

	async findMembershipProductRecordByClass(
		organizationId: string,
		entitlementClass: EntitlementClass,
	): Promise<ProductRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${PRODUCT_COLUMNS}
			FROM ${this.schema}.products
			WHERE organization_id = $1 AND product_category = 'membership' AND entitlement_class = $2 AND is_active
			LIMIT 1`,
			[organizationId, entitlementClass],
		)) as ProductRow[];
		return rows[0] ? mapProductRow(rows[0]) : null;
	}

	async findProductRecordByShopifyProductGid(
		shopifyProductGid: string,
	): Promise<ProductRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${PRODUCT_COLUMNS} FROM ${this.schema}.products WHERE shopify_product_gid = $1 LIMIT 1`,
			[shopifyProductGid],
		)) as ProductRow[];
		return rows[0] ? mapProductRow(rows[0]) : null;
	}

	async findProductRecordByShopifyVariantGid(
		shopifyVariantGid: string,
	): Promise<ProductRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${PRODUCT_COLUMNS} FROM ${this.schema}.products WHERE shopify_variant_gid = $1 LIMIT 1`,
			[shopifyVariantGid],
		)) as ProductRow[];
		return rows[0] ? mapProductRow(rows[0]) : null;
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
		)) as AccompanistDivisionPolicyRow[];
		const row = rows[0];
		return row
			? {
					organizationId: row.organization_id,
					policy: row.policy,
					updatedAtIso: toIsoString(row.updated_at),
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
			`INSERT INTO ${this.schema}.membership_division_policies (organization_id, entitlement_class, policy, updated_at)
			VALUES ($1, 'accompanist_membership', $2, NOW())
			ON CONFLICT (organization_id, entitlement_class) DO UPDATE SET policy = EXCLUDED.policy, updated_at = NOW()
			RETURNING organization_id, policy, updated_at`,
			[input.organizationId, input.policy],
		)) as AccompanistDivisionPolicyRow[];
		const row = rows[0];
		if (!row) throw new Error("Unable to save accompanist division policy.");
		await sql.unsafe(
			`INSERT INTO ${this.schema}.membership_division_policy_history (id, organization_id, entitlement_class, policy) VALUES ($1, $2, 'accompanist_membership', $3)`,
			[randomUUID(), row.organization_id, row.policy],
		);
		return {
			organizationId: row.organization_id,
			policy: row.policy,
			updatedAtIso: toIsoString(row.updated_at),
		};
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
		)) as AccompanistDivisionPolicyHistoryRow[];
		return rows.map((row) => ({
			id: row.id,
			organizationId: row.organization_id,
			policy: row.policy,
			updatedAtIso: toIsoString(row.created_at),
			createdAtIso: toIsoString(row.created_at),
		}));
	}
}
