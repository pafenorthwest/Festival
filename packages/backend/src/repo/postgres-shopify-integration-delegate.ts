import { randomUUID } from "node:crypto";
import {
	assertValidEntitlementDurationDays,
	type EntitlementClass,
	type ShopifyCapabilityDiagnostics,
	type ShopifyFailureCategory,
	type ShopifyVerificationStatus,
	type ShopifyWebhookFailureCategory,
	type ShopifyWebhookReadinessStatus,
} from "@festival/common";
import { sql } from "bun";
import {
	type CreateMembershipProductRecordInput,
	type ProductRecord,
	type ShopifyIntegrationRecord,
	ShopifyShopOwnershipError,
	type UpdateShopifyVerificationInput,
	type UpdateShopifyWebhookReadinessInput,
	type UpsertShopifyIntegrationInput,
} from "./organization-repository-types.js";

interface ShopifyIntegrationRow {
	organization_id: string;
	store_domain: string;
	client_id: string;
	encrypted_client_secret: string;
	encrypted_storefront_private_token: string | null;
	verification_status: ShopifyVerificationStatus;
	verified_shop_gid: string | null;
	verified_shop_domain: string | null;
	granted_scopes: string[];
	can_read_products: boolean;
	can_write_products: boolean;
	can_write_inventory: boolean;
	can_read_orders: boolean;
	integration_version: number | string;
	verified_at: Date | string | null;
	last_tested_at: Date | string | null;
	last_error: string | null;
	last_failure_category: ShopifyFailureCategory | null;
	webhook_readiness_status: ShopifyWebhookReadinessStatus;
	webhook_checked_at: Date | string | null;
	webhook_error: string | null;
	webhook_failure_category: ShopifyWebhookFailureCategory | null;
	webhook_request_id: string | null;
	created_at: Date | string;
	updated_at: Date | string;
}

interface ProductRow {
	id: string;
	organization_id: string;
	product_category: "membership";
	entitlement_class: EntitlementClass;
	duration_days: number;
	is_active: boolean;
	shopify_product_gid: string;
	shopify_variant_gid: string;
	product_name_snapshot: string;
	created_at: Date | string;
	updated_at: Date | string;
}

const SHOPIFY_COLS = `organization_id, store_domain, client_id, encrypted_client_secret,
	encrypted_storefront_private_token, verification_status, verified_shop_gid, verified_shop_domain,
	granted_scopes, can_read_products, can_write_products, can_write_inventory, can_read_orders,
	integration_version, verified_at, last_tested_at, last_error, last_failure_category,
	webhook_readiness_status, webhook_checked_at, webhook_error, webhook_failure_category,
	webhook_request_id, created_at, updated_at`;

const PRODUCT_COLS = `id, organization_id, product_category, entitlement_class, duration_days,
	is_active, shopify_product_gid, shopify_variant_gid, product_name_snapshot, created_at, updated_at`;

function toIso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : value;
}

function toOptIso(value: Date | string | null): string | undefined {
	return value ? toIso(value) : undefined;
}

function capabilityDiagnostics(
	row: ShopifyIntegrationRow,
): ShopifyCapabilityDiagnostics {
	return {
		read_products: row.can_read_products ? "granted" : "missing",
		write_products: row.can_write_products ? "granted" : "missing",
		write_inventory: row.can_write_inventory ? "granted" : "missing",
		read_orders: row.can_read_orders ? "granted" : "missing",
		write_orders: "disabled",
	};
}

function throwTranslatedShopifyOwnershipError(error: unknown): never {
	if (
		error &&
		typeof error === "object" &&
		(("errno" in error && (error as { errno?: string }).errno === "23505") ||
			("code" in error && (error as { code?: string }).code === "23505"))
	) {
		throw new ShopifyShopOwnershipError();
	}
	throw error;
}

function mapShopifyIntegration(
	row: ShopifyIntegrationRow,
): ShopifyIntegrationRecord {
	const integrationVersion = Number(row.integration_version);
	if (!Number.isSafeInteger(integrationVersion) || integrationVersion <= 0) {
		throw new Error("Shopify integration version is invalid.");
	}
	const verificationMetadataComplete = Boolean(
		row.verified_shop_gid && row.verified_shop_domain && row.verified_at,
	);
	return {
		organizationId: row.organization_id,
		storeDomain: row.store_domain,
		clientId: row.client_id,
		encryptedClientSecret: row.encrypted_client_secret,
		encryptedStorefrontPrivateToken:
			row.encrypted_storefront_private_token ?? undefined,
		verificationStatus:
			row.verification_status === "ok" && !verificationMetadataComplete
				? "failed"
				: row.verification_status,
		verifiedShopGid: row.verified_shop_gid ?? undefined,
		verifiedShopDomain: row.verified_shop_domain ?? undefined,
		grantedScopes: [...(row.granted_scopes ?? [])],
		capabilities: capabilityDiagnostics(row),
		integrationVersion,
		verifiedAtIso: toOptIso(row.verified_at),
		lastTestedAtIso: toOptIso(row.last_tested_at),
		lastError: row.last_error ?? undefined,
		lastFailureCategory: row.last_failure_category ?? undefined,
		webhookReadinessStatus: row.webhook_readiness_status,
		webhookCheckedAtIso: toOptIso(row.webhook_checked_at),
		webhookError: row.webhook_error ?? undefined,
		webhookFailureCategory: row.webhook_failure_category ?? undefined,
		webhookRequestId: row.webhook_request_id ?? undefined,
		createdAtIso: toIso(row.created_at),
		updatedAtIso: toIso(row.updated_at),
	};
}

function mapProduct(row: ProductRow): ProductRecord {
	const durationDays = Number(row.duration_days);
	assertValidEntitlementDurationDays(durationDays);
	return {
		id: row.id,
		organizationId: row.organization_id,
		productCategory: row.product_category,
		entitlementClass: row.entitlement_class,
		durationDays,
		isActive: row.is_active,
		shopifyProductGid: row.shopify_product_gid,
		shopifyVariantGid: row.shopify_variant_gid,
		productNameSnapshot: row.product_name_snapshot,
		createdAtIso: toIso(row.created_at),
		updatedAtIso: toIso(row.updated_at),
	};
}

/** Handles PostgreSQL Shopify integration and membership product records (S10/S11 facade). */
export class PostgresShopifyIntegrationDelegate {
	constructor(
		private readonly schema: string,
		private readonly ensureReady: () => Promise<void>,
	) {}

	async getShopifyIntegration(
		organizationId: string,
	): Promise<ShopifyIntegrationRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${SHOPIFY_COLS} FROM ${this.schema}.shopify_integrations WHERE organization_id = $1 LIMIT 1`,
			[organizationId],
		)) as ShopifyIntegrationRow[];
		return rows[0] ? mapShopifyIntegration(rows[0]) : null;
	}

	async getPublicShopifyCatalogDomain(
		organizationId: string,
	): Promise<string | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT verified_shop_domain FROM ${this.schema}.shopify_integrations
			 WHERE organization_id = $1 AND verification_status = 'ok' LIMIT 1`,
			[organizationId],
		)) as Array<{ verified_shop_domain: string | null }>;
		return rows[0]?.verified_shop_domain ?? null;
	}

	async upsertShopifyIntegration(
		input: UpsertShopifyIntegrationInput,
	): Promise<ShopifyIntegrationRecord> {
		await this.ensureReady();
		let row: ShopifyIntegrationRow | undefined;
		try {
			[row] = (await sql.unsafe(
				`INSERT INTO ${this.schema}.shopify_integrations (
					organization_id, store_domain, client_id, encrypted_client_secret,
					encrypted_storefront_private_token, verification_status, verified_at,
					last_tested_at, last_error, last_failure_category, updated_at
				 ) VALUES ($1, $2, $3, $4, $5, 'unknown', NULL, NULL, NULL, NULL, NOW())
				 ON CONFLICT (organization_id) DO UPDATE SET
					store_domain = EXCLUDED.store_domain,
					client_id = EXCLUDED.client_id,
					encrypted_client_secret = EXCLUDED.encrypted_client_secret,
					encrypted_storefront_private_token = EXCLUDED.encrypted_storefront_private_token,
					verification_status = 'unknown',
					verified_shop_gid = NULL, verified_shop_domain = NULL,
					granted_scopes = '{}',
					can_read_products = FALSE, can_write_products = FALSE,
					can_write_inventory = FALSE, can_read_orders = FALSE,
					integration_version = ${this.schema}.shopify_integrations.integration_version + 1,
					verified_at = NULL, last_tested_at = NULL, last_error = NULL,
					last_failure_category = NULL, webhook_readiness_status = 'unknown',
					webhook_checked_at = NULL, webhook_error = NULL,
					webhook_failure_category = NULL, webhook_request_id = NULL, updated_at = NOW()
				 RETURNING ${SHOPIFY_COLS}`,
				[
					input.organizationId,
					input.storeDomain,
					input.clientId,
					input.encryptedClientSecret,
					input.encryptedStorefrontPrivateToken ?? null,
				],
			)) as ShopifyIntegrationRow[];
		} catch (error) {
			throwTranslatedShopifyOwnershipError(error);
		}
		if (!row) throw new Error("Shopify integration upsert returned no record.");
		return mapShopifyIntegration(row);
	}

	async updateShopifyVerification(
		input: UpdateShopifyVerificationInput,
	): Promise<ShopifyIntegrationRecord> {
		await this.ensureReady();
		const grantedScopes = input.grantedScopes ?? [];
		if (grantedScopes.some((scope) => !/^[a-z][a-z0-9_]*$/.test(scope))) {
			throw new Error("Shopify granted scope data is invalid.");
		}
		let row: ShopifyIntegrationRow | undefined;
		try {
			[row] = (await sql.unsafe(
				`UPDATE ${this.schema}.shopify_integrations
				 SET verification_status = $2, verified_shop_gid = $3, verified_shop_domain = $4,
					 granted_scopes = COALESCE(string_to_array(NULLIF($5, ''), ','), ARRAY[]::TEXT[]),
					 can_read_products = $6, can_write_products = $7, can_write_inventory = $8,
					 can_read_orders = $9, verified_at = $10, last_tested_at = $11,
					 last_error = $12, last_failure_category = $13, updated_at = NOW()
				 WHERE organization_id = $1
				 RETURNING ${SHOPIFY_COLS}`,
				[
					input.organizationId,
					input.verificationStatus,
					input.verifiedShopGid ?? null,
					input.verifiedShopDomain ?? null,
					grantedScopes.join(","),
					input.capabilities?.read_products === "granted",
					input.capabilities?.write_products === "granted",
					input.capabilities?.write_inventory === "granted",
					input.capabilities?.read_orders === "granted",
					input.verifiedAtIso ?? null,
					input.lastTestedAtIso,
					input.lastError ?? null,
					input.lastFailureCategory ?? null,
				],
			)) as ShopifyIntegrationRow[];
		} catch (error) {
			throwTranslatedShopifyOwnershipError(error);
		}
		if (!row) throw new Error("Shopify integration not found.");
		return mapShopifyIntegration(row);
	}

	async updateShopifyWebhookReadiness(
		input: UpdateShopifyWebhookReadinessInput,
	): Promise<ShopifyIntegrationRecord> {
		await this.ensureReady();
		if (
			input.requestId !== undefined &&
			!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.requestId)
		) {
			throw new Error("Shopify webhook request ID is invalid.");
		}
		const [row] = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_integrations
			 SET webhook_readiness_status = $2, webhook_checked_at = $3, webhook_error = $4,
				 webhook_failure_category = $5, webhook_request_id = $6, updated_at = NOW()
			 WHERE organization_id = $1
			 RETURNING ${SHOPIFY_COLS}`,
			[
				input.organizationId,
				input.status,
				input.checkedAtIso,
				input.status === "failed" ? input.message : null,
				input.status === "failed" ? input.failureCategory : null,
				input.status === "failed" ? (input.requestId ?? null) : null,
			],
		)) as ShopifyIntegrationRow[];
		if (!row) throw new Error("Shopify integration not found.");
		return mapShopifyIntegration(row);
	}

	async createMembershipProductRecord(
		input: CreateMembershipProductRecordInput,
	): Promise<ProductRecord> {
		await this.ensureReady();
		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.products (
				id, organization_id, product_category, entitlement_class, duration_days,
				is_active, shopify_product_gid, shopify_variant_gid, product_name_snapshot, updated_at
			 ) VALUES ($1, $2, 'membership', $3, $4, $5, $6, $7, $8, NOW())
			 RETURNING ${PRODUCT_COLS}`,
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
		return mapProduct(row);
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
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.products
			 SET product_name_snapshot = COALESCE($3, product_name_snapshot),
				 duration_days = COALESCE($4, duration_days),
				 is_active = COALESCE($5, is_active),
				 updated_at = NOW()
			 WHERE id = $1 AND organization_id = $2
			 RETURNING ${PRODUCT_COLS}`,
			[
				input.productId,
				input.organizationId,
				input.productNameSnapshot ?? null,
				input.durationDays ?? null,
				input.isActive ?? null,
			],
		)) as ProductRow[];
		return rows[0] ? mapProduct(rows[0]) : null;
	}

	async listMembershipProductRecords(
		organizationId: string,
	): Promise<ProductRecord[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${PRODUCT_COLS} FROM ${this.schema}.products
			 WHERE organization_id = $1 AND product_category = 'membership'
			 ORDER BY created_at ASC`,
			[organizationId],
		)) as ProductRow[];
		return rows.map(mapProduct);
	}

	async findMembershipProductRecordByClass(
		organizationId: string,
		entitlementClass: EntitlementClass,
	): Promise<ProductRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${PRODUCT_COLS} FROM ${this.schema}.products
			 WHERE organization_id = $1 AND product_category = 'membership'
			   AND entitlement_class = $2 AND is_active
			 LIMIT 1`,
			[organizationId, entitlementClass],
		)) as ProductRow[];
		return rows[0] ? mapProduct(rows[0]) : null;
	}

	async findProductRecordByShopifyProductGid(
		shopifyProductGid: string,
	): Promise<ProductRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${PRODUCT_COLS} FROM ${this.schema}.products WHERE shopify_product_gid = $1 LIMIT 1`,
			[shopifyProductGid],
		)) as ProductRow[];
		return rows[0] ? mapProduct(rows[0]) : null;
	}

	async findProductRecordByShopifyVariantGid(
		shopifyVariantGid: string,
	): Promise<ProductRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${PRODUCT_COLS} FROM ${this.schema}.products WHERE shopify_variant_gid = $1 LIMIT 1`,
			[shopifyVariantGid],
		)) as ProductRow[];
		return rows[0] ? mapProduct(rows[0]) : null;
	}
}
