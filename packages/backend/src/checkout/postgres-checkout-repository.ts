import { randomUUID } from "node:crypto";
import { sql } from "bun";
import type {
	CheckoutCartRecord,
	CheckoutIntentOutcome,
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
				customer_id TEXT NOT NULL, session_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, offering_id TEXT NOT NULL REFERENCES ${this.schema}.products (id),
				entitlement_class TEXT NOT NULL, duration_days INTEGER NOT NULL,
				shopify_product_gid TEXT NOT NULL, shopify_variant_gid TEXT NOT NULL, policy_version TEXT NOT NULL,
				amount TEXT NOT NULL, currency_code TEXT NOT NULL,
				cart_reference TEXT NULL REFERENCES ${this.schema}.checkout_carts (reference),
				status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'checkout_started', 'failed', 'expired', 'superseded')),
				expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
			ALTER TABLE ${this.schema}.checkout_intents ADD COLUMN IF NOT EXISTS session_id TEXT;
			ALTER TABLE ${this.schema}.checkout_intents ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
			ALTER TABLE ${this.schema}.checkout_intents DROP CONSTRAINT IF EXISTS checkout_intents_status_check;
			ALTER TABLE ${this.schema}.checkout_intents ADD CONSTRAINT checkout_intents_status_check CHECK (status IN ('creating', 'ready', 'checkout_started', 'failed', 'expired', 'superseded'));
			CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_scope_key ON ${this.schema}.checkout_intents(organization_id, customer_id, session_id, idempotency_key);
		`);
	}
	async getOutcome(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}) {
		const rows = (await sql.unsafe(
			`SELECT id, correlation_id, organization_id, customer_id, session_id, idempotency_key, offering_id, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, policy_version, amount, currency_code, cart_reference, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND customer_id = $2 AND session_id = $3 AND idempotency_key = $4`,
			[
				input.organizationId,
				input.customerId,
				input.sessionId,
				input.idempotencyKey,
			],
		)) as Array<Record<string, unknown>>;
		if (!rows[0]) return null;
		return this.outcomeFor(this.intent(rows[0]));
	}
	async createIntent(
		record: Omit<
			CheckoutIntentRecord,
			"id" | "correlationId" | "cartReference" | "createdAtIso" | "status"
		>,
	) {
		return sql.begin(async (tx) => {
			// This transaction serializes only local intent state. Shopify calls happen after it commits.
			await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
				`${record.organizationId}:${record.customerId}`,
			]);
			const existingRows = (await tx.unsafe(
				`SELECT id, correlation_id, organization_id, customer_id, session_id, idempotency_key, offering_id, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, policy_version, amount, currency_code, cart_reference, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND customer_id = $2 AND session_id = $3 AND idempotency_key = $4 FOR UPDATE`,
				[
					record.organizationId,
					record.customerId,
					record.sessionId,
					record.idempotencyKey,
				],
			)) as Array<Record<string, unknown>>;
			const existing = existingRows[0] ? this.intent(existingRows[0]) : null;
			if (existing) {
				if (existing.status === "creating") return { kind: "in_progress" };
				if (existing.status === "failed") return { kind: "failed" };
				if (
					existing.cartReference &&
					(existing.status === "ready" ||
						existing.status === "checkout_started")
				) {
					const cartRows = (await tx.unsafe(
						`SELECT reference, shopify_cart_id, organization_id, customer_id, session_id, integration_version, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_carts WHERE reference = $1 AND expires_at > NOW() AND status IN ('ready', 'checkout_started')`,
						[existing.cartReference],
					)) as Array<Record<string, unknown>>;
					if (cartRows[0])
						return {
							kind: "ready",
							intent: existing,
							cart: this.cart(cartRows[0]),
						};
				}
				return { kind: "failed" };
			}
			const creating = (await tx.unsafe(
				`SELECT id FROM ${this.schema}.checkout_intents WHERE organization_id = $1 AND customer_id = $2 AND status = 'creating' AND expires_at > NOW() LIMIT 1 FOR UPDATE`,
				[record.organizationId, record.customerId],
			)) as Array<Record<string, unknown>>;
			if (creating[0]) return { kind: "in_progress" };
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents SET status = 'superseded' WHERE organization_id = $1 AND customer_id = $2 AND status = 'ready'`,
				[record.organizationId, record.customerId],
			);
			await tx.unsafe(
				`UPDATE ${this.schema}.checkout_carts SET status = 'superseded' WHERE organization_id = $1 AND customer_id = $2 AND status = 'ready'`,
				[record.organizationId, record.customerId],
			);
			const id = randomUUID(),
				correlationId = randomUUID();
			const rows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, offering_id, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, policy_version, amount, currency_code, status, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'creating',$15) RETURNING id, correlation_id, organization_id, customer_id, session_id, idempotency_key, offering_id, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, policy_version, amount, currency_code, cart_reference, status, expires_at::text, created_at::text`,
				[
					id,
					correlationId,
					record.organizationId,
					record.customerId,
					record.sessionId,
					record.idempotencyKey,
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
			return { kind: "created", intent: this.intent(rows[0]) };
		}) as Promise<CheckoutIntentOutcome>;
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
				`UPDATE ${this.schema}.checkout_intents SET status = 'checkout_started' WHERE id = $1 AND status IN ('ready', 'checkout_started') RETURNING cart_reference`,
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
	async markFailed(intentId: string) {
		await sql.begin(async (tx) => {
			const rows = (await tx.unsafe(
				`UPDATE ${this.schema}.checkout_intents SET status = 'failed' WHERE id = $1 RETURNING cart_reference`,
				[intentId],
			)) as Array<Record<string, unknown>>;
			if (rows[0]?.cart_reference) {
				await tx.unsafe(
					`UPDATE ${this.schema}.checkout_carts SET status = 'superseded' WHERE reference = $1`,
					[String(rows[0].cart_reference)],
				);
			}
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
			sessionId: String(row.session_id),
			idempotencyKey: String(row.idempotency_key),
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
	private async outcomeFor(intent: CheckoutIntentRecord) {
		if (Date.parse(intent.expiresAtIso) <= Date.now())
			return { kind: "expired" as const };
		if (intent.status === "creating") return { kind: "in_progress" as const };
		if (intent.status === "failed") return { kind: "failed" as const };
		if (!intent.cartReference) return { kind: "failed" as const };
		const rows = (await sql.unsafe(
			`SELECT reference, shopify_cart_id, organization_id, customer_id, session_id, integration_version, status, expires_at::text, created_at::text FROM ${this.schema}.checkout_carts WHERE reference = $1 AND expires_at > NOW() AND status IN ('ready', 'checkout_started')`,
			[intent.cartReference],
		)) as Array<Record<string, unknown>>;
		return rows[0]
			? { kind: "ready" as const, intent, cart: this.cart(rows[0]) }
			: { kind: "failed" as const };
	}
}
