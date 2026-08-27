import { randomUUID } from "node:crypto";
import { sql } from "bun";
import type {
	CheckoutCartRecord,
	CheckoutIntentRecord,
	CheckoutRepository,
} from "./checkout-repository.js";

function schemaName(value: string) {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))
		throw new Error("Database schema is invalid.");
	return value;
}

export class PostgresCheckoutRepository implements CheckoutRepository {
	private readonly schema: string;
	constructor(schema: string) {
		this.schema = schemaName(schema);
	}
	async ensureReady() {
		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS ${this.schema}.checkout_carts (
				reference TEXT PRIMARY KEY, shopify_cart_id TEXT NOT NULL,
				organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations (id) ON DELETE CASCADE,
				customer_id TEXT NOT NULL, session_id TEXT NOT NULL, integration_version BIGINT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('ready', 'checkout_started', 'expired', 'superseded')),
				expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
			CREATE TABLE IF NOT EXISTS ${this.schema}.checkout_intents (
				id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL UNIQUE,
				organization_id TEXT NOT NULL REFERENCES ${this.schema}.organizations (id) ON DELETE CASCADE,
				customer_id TEXT NOT NULL, offering_id TEXT NOT NULL REFERENCES ${this.schema}.products (id),
				entitlement_class TEXT NOT NULL, duration_days INTEGER NOT NULL,
				shopify_product_gid TEXT NOT NULL, shopify_variant_gid TEXT NOT NULL, policy_version TEXT NOT NULL,
				amount TEXT NOT NULL, currency_code TEXT NOT NULL,
				cart_reference TEXT NULL REFERENCES ${this.schema}.checkout_carts (reference),
				status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'expired', 'superseded')),
				expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
		`);
	}
	async createIntent(
		record: Omit<
			CheckoutIntentRecord,
			"id" | "correlationId" | "cartReference" | "createdAtIso" | "status"
		>,
	) {
		const id = randomUUID(),
			correlationId = randomUUID();
		await sql.unsafe(
			`UPDATE ${this.schema}.checkout_intents SET status = 'superseded' WHERE organization_id = $1 AND customer_id = $2 AND status IN ('creating','ready')`,
			[record.organizationId, record.customerId],
		);
		await sql.unsafe(
			`UPDATE ${this.schema}.checkout_carts SET status = 'superseded' WHERE organization_id = $1 AND customer_id = $2 AND status = 'ready'`,
			[record.organizationId, record.customerId],
		);
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.checkout_intents (id, correlation_id, organization_id, customer_id, offering_id, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, policy_version, amount, currency_code, status, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'creating',$13) RETURNING id, correlation_id, organization_id, customer_id, offering_id, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, policy_version, amount, currency_code, cart_reference, status, expires_at::text, created_at::text`,
			[
				id,
				correlationId,
				record.organizationId,
				record.customerId,
				record.offeringId,
				record.entitlementClass,
				record.durationDays,
				record.shopifyProductGid,
				record.shopifyVariantGid,
				record.policyVersion,
				record.amount,
				record.currencyCode,
				record.expiresAtIso,
			],
		)) as Array<Record<string, unknown>>;
		return this.intent(rows[0]);
	}
	async attachCart(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
		},
	) {
		const reference = randomUUID();
		const rows = await sql.begin(async (tx) => {
			const intents = (await tx.unsafe(
				`SELECT id FROM ${this.schema}.checkout_intents WHERE id = $1 AND status = 'creating' FOR UPDATE`,
				[input.intentId],
			)) as Array<Record<string, unknown>>;
			if (!intents[0]) throw new Error("Checkout intent cannot accept a cart.");
			await tx.unsafe(
				`INSERT INTO ${this.schema}.checkout_carts (reference, shopify_cart_id, organization_id, customer_id, session_id, integration_version, status, expires_at) VALUES ($1,$2,$3,$4,$5,$6,'ready',$7)`,
				[
					reference,
					input.shopifyCartId,
					input.organizationId,
					input.customerId,
					input.sessionId,
					input.integrationVersion,
					input.expiresAtIso,
				],
			);
			return await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents SET cart_reference = $1, status = 'ready' WHERE id = $2 RETURNING id`,
				[reference, input.intentId],
			);
		});
		if (!rows[0]) throw new Error("Checkout cart persistence failed.");
		return {
			reference,
			shopifyCartId: input.shopifyCartId,
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			integrationVersion: input.integrationVersion,
			status: "ready" as const,
			expiresAtIso: input.expiresAtIso,
			createdAtIso: new Date().toISOString(),
		};
	}
	async markCheckoutStarted(intentId: string) {
		await sql.begin(async (tx) => {
			const rows = (await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents SET status = 'superseded' WHERE id = $1 AND status = 'ready' RETURNING cart_reference`,
				[intentId],
			)) as Array<Record<string, unknown>>;
			if (!rows[0]?.cart_reference)
				throw new Error("Checkout intent is not ready.");
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_carts SET status = 'checkout_started' WHERE reference = $1`,
				[String(rows[0].cart_reference)],
			);
		});
	}
	async getCart(
		reference: string,
		organizationId: string,
		customerId: string,
		nowIso: string,
	) {
		const rows = (await sql.unsafe(
			`SELECT reference, shopify_cart_id, organization_id, customer_id, session_id, integration_version, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_carts WHERE reference = $1 AND organization_id = $2 AND customer_id = $3 AND expires_at > $4::timestamptz AND status IN ('ready','checkout_started')`,
			[reference, organizationId, customerId, nowIso],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? this.cart(rows[0]) : null;
	}
	private cart(row: Record<string, unknown>): CheckoutCartRecord {
		return {
			reference: String(row.reference),
			shopifyCartId: String(row.shopify_cart_id),
			organizationId: String(row.organization_id),
			customerId: String(row.customer_id),
			sessionId: String(row.session_id),
			integrationVersion: Number(row.integration_version),
			status: row.status as CheckoutCartRecord["status"],
			expiresAtIso: String(row.expires_at),
			createdAtIso: String(row.created_at),
		};
	}
	private intent(row: Record<string, unknown>): CheckoutIntentRecord {
		return {
			id: String(row.id),
			correlationId: String(row.correlation_id),
			organizationId: String(row.organization_id),
			customerId: String(row.customer_id),
			offeringId: String(row.offering_id),
			entitlementClass: "teacher_membership",
			durationDays: Number(row.duration_days),
			shopifyProductGid: String(row.shopify_product_gid),
			shopifyVariantGid: String(row.shopify_variant_gid),
			policyVersion: "v1",
			amount: String(row.amount),
			currencyCode: String(row.currency_code),
			cartReference:
				row.cart_reference === null ? null : String(row.cart_reference),
			status: row.status as CheckoutIntentRecord["status"],
			expiresAtIso: String(row.expires_at),
			createdAtIso: String(row.created_at),
		};
	}
}
