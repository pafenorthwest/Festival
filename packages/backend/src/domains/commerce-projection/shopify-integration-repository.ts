import type {
	OrganizationRecord,
	ShopifyCapabilityDiagnostics,
	ShopifyFailureCategory,
	ShopifyVerificationStatus,
	ShopifyWebhookFailureCategory,
	ShopifyWebhookReadinessStatus,
} from "@festival/common";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
	ShopifyShopOwnershipError,
} from "../../infra/s11-infra.js";
import type {
	ShopifyIntegrationPortRecord,
	UpdateShopifyVerificationPortInput,
	UpdateShopifyWebhookReadinessPortInput,
	UpsertShopifyIntegrationPortInput,
} from "./ports.js";

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
	verified_at: string | null;
	last_tested_at: string | null;
	last_error: string | null;
	last_failure_category: ShopifyFailureCategory | null;
	webhook_readiness_status: ShopifyWebhookReadinessStatus;
	webhook_checked_at: string | null;
	webhook_error: string | null;
	webhook_failure_category: ShopifyWebhookFailureCategory | null;
	webhook_request_id: string | null;
	created_at: string;
	updated_at: string;
}

interface OrganizationRow {
	id: string;
	name: string;
	slug: string;
	created_at: string;
	timezone?: string;
	default_currency_code?: string | null;
}

const INTEGRATION_COLUMNS = `
	organization_id, store_domain, client_id, encrypted_client_secret,
	encrypted_storefront_private_token, verification_status, verified_shop_gid,
	verified_shop_domain, granted_scopes, can_read_products, can_write_products,
	can_write_inventory, can_read_orders, integration_version, verified_at,
	last_tested_at, last_error, last_failure_category, webhook_readiness_status,
	webhook_checked_at, webhook_error, webhook_failure_category, webhook_request_id,
	created_at, updated_at
`;

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
): ShopifyIntegrationPortRecord {
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
		verifiedAtIso: row.verified_at ?? undefined,
		lastTestedAtIso: row.last_tested_at ?? undefined,
		lastError: row.last_error ?? undefined,
		lastFailureCategory: row.last_failure_category ?? undefined,
		webhookReadinessStatus: row.webhook_readiness_status,
		webhookCheckedAtIso: row.webhook_checked_at ?? undefined,
		webhookError: row.webhook_error ?? undefined,
		webhookFailureCategory: row.webhook_failure_category ?? undefined,
		webhookRequestId: row.webhook_request_id ?? undefined,
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}

function mapOrganization(row: OrganizationRow): OrganizationRecord {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		timezone: row.timezone ?? "UTC",
		defaultCurrencyCode: row.default_currency_code ?? "USD",
		createdAtIso: row.created_at,
	};
}

export interface ShopifyIntegrationRepository {
	ensureReady(): Promise<void>;
	getShopifyIntegration(
		organizationId: string,
	): Promise<ShopifyIntegrationPortRecord | null>;
	findOrganizationByShopDomain(
		shopDomain: string,
	): Promise<OrganizationRecord | null>;
	getPublicShopifyCatalogDomain(organizationId: string): Promise<string | null>;
	upsertShopifyIntegration(
		input: UpsertShopifyIntegrationPortInput,
	): Promise<ShopifyIntegrationPortRecord>;
	updateShopifyVerification(
		input: UpdateShopifyVerificationPortInput,
	): Promise<ShopifyIntegrationPortRecord>;
	updateShopifyWebhookReadiness(
		input: UpdateShopifyWebhookReadinessPortInput,
	): Promise<ShopifyIntegrationPortRecord>;
}

export class PostgresShopifyIntegrationRepository
	implements ShopifyIntegrationRepository
{
	private readonly schema: string;

	constructor(
		schema: string,
		private readonly ensureReadyFn?: () => Promise<void>,
	) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		if (this.ensureReadyFn) {
			await this.ensureReadyFn();
			return;
		}
		await initializePostgresSchema(this.schema);
	}

	async getShopifyIntegration(
		organizationId: string,
	): Promise<ShopifyIntegrationPortRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT ${INTEGRATION_COLUMNS}
			 FROM ${this.schema}.shopify_integrations
			 WHERE organization_id = $1
			 LIMIT 1`,
			[organizationId],
		)) as ShopifyIntegrationRow[];
		return rows[0] ? mapShopifyIntegration(rows[0]) : null;
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

	async getPublicShopifyCatalogDomain(
		organizationId: string,
	): Promise<string | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT verified_shop_domain
			 FROM ${this.schema}.shopify_integrations
			 WHERE organization_id = $1
			   AND verification_status = 'ok'
			 LIMIT 1`,
			[organizationId],
		)) as Array<{ verified_shop_domain: string | null }>;
		return rows[0]?.verified_shop_domain ?? null;
	}

	async upsertShopifyIntegration(
		input: UpsertShopifyIntegrationPortInput,
	): Promise<ShopifyIntegrationPortRecord> {
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
					verified_shop_gid = NULL,
					verified_shop_domain = NULL,
					granted_scopes = '{}',
					can_read_products = FALSE,
					can_write_products = FALSE,
					can_write_inventory = FALSE,
					can_read_orders = FALSE,
					integration_version = ${this.schema}.shopify_integrations.integration_version + 1,
					verified_at = NULL,
					last_tested_at = NULL,
					last_error = NULL,
					last_failure_category = NULL,
					webhook_readiness_status = 'unknown',
					webhook_checked_at = NULL,
					webhook_error = NULL,
					webhook_failure_category = NULL,
					webhook_request_id = NULL,
					updated_at = NOW()
				RETURNING ${INTEGRATION_COLUMNS}`,
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
		if (!row) {
			throw new Error("Shopify integration upsert returned no record.");
		}
		return mapShopifyIntegration(row);
	}

	async updateShopifyVerification(
		input: UpdateShopifyVerificationPortInput,
	): Promise<ShopifyIntegrationPortRecord> {
		await this.ensureReady();
		const grantedScopes = input.grantedScopes ?? [];
		if (grantedScopes.some((scope) => !/^[a-z][a-z0-9_]*$/.test(scope))) {
			throw new Error("Shopify granted scope data is invalid.");
		}
		let row: ShopifyIntegrationRow | undefined;
		try {
			[row] = (await sql.unsafe(
				`UPDATE ${this.schema}.shopify_integrations
				 SET
					verification_status = $2,
					verified_shop_gid = $3,
					verified_shop_domain = $4,
					granted_scopes = COALESCE(string_to_array(NULLIF($5, ''), ','), ARRAY[]::TEXT[]),
					can_read_products = $6,
					can_write_products = $7,
					can_write_inventory = $8,
					can_read_orders = $9,
					verified_at = $10,
					last_tested_at = $11,
					last_error = $12,
					last_failure_category = $13,
					updated_at = NOW()
				 WHERE organization_id = $1
				 RETURNING ${INTEGRATION_COLUMNS}`,
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
		if (!row) {
			throw new Error("Shopify integration not found.");
		}
		return mapShopifyIntegration(row);
	}

	async updateShopifyWebhookReadiness(
		input: UpdateShopifyWebhookReadinessPortInput,
	): Promise<ShopifyIntegrationPortRecord> {
		await this.ensureReady();
		if (
			input.requestId !== undefined &&
			!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.requestId)
		) {
			throw new Error("Shopify webhook request ID is invalid.");
		}
		const [row] = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_integrations
			 SET
				webhook_readiness_status = $2,
				webhook_checked_at = $3,
				webhook_error = $4,
				webhook_failure_category = $5,
				webhook_request_id = $6,
				updated_at = NOW()
			 WHERE organization_id = $1
			 RETURNING ${INTEGRATION_COLUMNS}`,
			[
				input.organizationId,
				input.status,
				input.checkedAtIso,
				input.status === "failed" ? input.message : null,
				input.status === "failed" ? input.failureCategory : null,
				input.status === "failed" ? (input.requestId ?? null) : null,
			],
		)) as ShopifyIntegrationRow[];
		if (!row) {
			throw new Error("Shopify integration not found.");
		}
		return mapShopifyIntegration(row);
	}
}
