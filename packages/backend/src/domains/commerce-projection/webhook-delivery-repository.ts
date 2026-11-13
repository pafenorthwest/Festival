import { randomUUID } from "node:crypto";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s11-infra.js";

export interface ShopifyWebhookDelivery {
	id: string;
	organizationId: string;
	shopDomain: string;
	webhookId: string;
	topic: "orders/paid";
	apiVersion: "2026-07";
	shopifyOrderGid: string;
	payloadSha256: string;
	status: "received" | "processing" | "processed" | "failed";
	attemptCount: number;
	failureCategory?: "upstream" | "persistence" | "invalid";
	failureStage?: "order_read" | "projection";
	failureCode?:
		| "shopify_upstream"
		| "shopify_transport"
		| "invalid_data"
		| "paid_line_conflict"
		| "persistence"
		| "unexpected";
	shopifyRequestId?: string;
	failedAtIso?: string;
	receivedAtIso: string;
	processedAtIso?: string;
	processingStartedAtIso?: string;
}

export interface RecordWebhookDeliveryInput {
	organizationId: string;
	shopDomain: string;
	webhookId: string;
	topic: "orders/paid";
	apiVersion: "2026-07";
	shopifyOrderGid: string;
	payloadSha256: string;
	receivedAtIso: string;
}

export type RecordWebhookDeliveryResult =
	| { kind: "accepted"; delivery: ShopifyWebhookDelivery }
	| { kind: "duplicate"; delivery: ShopifyWebhookDelivery }
	| { kind: "conflict" };

export interface WebhookDeliveryFailureInput {
	category: "upstream" | "persistence" | "invalid";
	stage: "order_read" | "projection";
	code:
		| "shopify_upstream"
		| "shopify_transport"
		| "invalid_data"
		| "paid_line_conflict"
		| "persistence"
		| "unexpected";
	requestId?: string;
	failedAtIso: string;
}

export interface ShopifyWebhookDeliveryRepository {
	ensureReady(): Promise<void>;
	recordDelivery(
		input: RecordWebhookDeliveryInput,
	): Promise<RecordWebhookDeliveryResult>;
	claimDelivery(deliveryId: string): Promise<ShopifyWebhookDelivery | null>;
	markDeliveryFailed(
		deliveryId: string,
		failure: WebhookDeliveryFailureInput,
	): Promise<void>;
	markDeliveryProcessed(deliveryId: string): Promise<void>;
	listReclaimableDeliveries(
		organizationId: string,
		limit: number,
		staleBeforeIso: string,
	): Promise<ShopifyWebhookDelivery[]>;
}

const DELIVERY_COLUMNS = `id, organization_id, shop_domain, webhook_id, topic, api_version, shopify_order_gid, payload_sha256, status, attempt_count, failure_category, failure_stage, failure_code, shopify_request_id, failed_at::text, received_at::text, processed_at::text`;

const CLAIMED_DELIVERY_COLUMNS = `id, organization_id, shop_domain, webhook_id, topic, api_version, shopify_order_gid, payload_sha256, status, attempt_count, failure_category, failure_stage, failure_code, shopify_request_id, failed_at::text, received_at::text, processing_started_at::text, processed_at::text`;

export function mapWebhookDeliveryRow(
	row: Record<string, unknown>,
): ShopifyWebhookDelivery {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		shopDomain: String(row.shop_domain),
		webhookId: String(row.webhook_id),
		topic: "orders/paid",
		apiVersion: "2026-07",
		shopifyOrderGid: String(row.shopify_order_gid),
		payloadSha256: String(row.payload_sha256),
		status: row.status as ShopifyWebhookDelivery["status"],
		attemptCount: Number(row.attempt_count),
		failureCategory:
			row.failure_category === null
				? undefined
				: (row.failure_category as ShopifyWebhookDelivery["failureCategory"]),
		failureStage:
			row.failure_stage == null
				? undefined
				: (row.failure_stage as ShopifyWebhookDelivery["failureStage"]),
		failureCode:
			row.failure_code == null
				? undefined
				: (row.failure_code as ShopifyWebhookDelivery["failureCode"]),
		shopifyRequestId:
			row.shopify_request_id == null
				? undefined
				: String(row.shopify_request_id),
		failedAtIso: row.failed_at == null ? undefined : String(row.failed_at),
		receivedAtIso: String(row.received_at),
		processedAtIso:
			row.processed_at === null ? undefined : String(row.processed_at),
		processingStartedAtIso:
			row.processing_started_at === null ||
			row.processing_started_at === undefined
				? undefined
				: String(row.processing_started_at),
	};
}

export class PostgresWebhookDeliveryRepository
	implements ShopifyWebhookDeliveryRepository
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

	async recordDelivery(
		input: RecordWebhookDeliveryInput,
	): Promise<RecordWebhookDeliveryResult> {
		await this.ensureReady();
		return sql.begin(async (tx) => {
			const inserted = (await tx.unsafe(
				`INSERT INTO ${this.schema}.shopify_webhook_deliveries (id, organization_id, shop_domain, webhook_id, topic, api_version, shopify_order_gid, payload_sha256, status, received_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'received',$9) ON CONFLICT (organization_id, webhook_id) DO NOTHING RETURNING ${DELIVERY_COLUMNS}`,
				[
					randomUUID(),
					input.organizationId,
					input.shopDomain,
					input.webhookId,
					input.topic,
					input.apiVersion,
					input.shopifyOrderGid,
					input.payloadSha256,
					input.receivedAtIso,
				],
			)) as Array<Record<string, unknown>>;
			if (inserted[0]) {
				return {
					kind: "accepted" as const,
					delivery: mapWebhookDeliveryRow(inserted[0]),
				};
			}
			const rows = (await tx.unsafe(
				`SELECT ${DELIVERY_COLUMNS} FROM ${this.schema}.shopify_webhook_deliveries WHERE organization_id = $1 AND webhook_id = $2 FOR UPDATE`,
				[input.organizationId, input.webhookId],
			)) as Array<Record<string, unknown>>;
			if (!rows[0]) {
				throw new Error("Webhook delivery conflict did not resolve to a row.");
			}
			const existing = mapWebhookDeliveryRow(rows[0]);
			if (existing.payloadSha256 !== input.payloadSha256) {
				return { kind: "conflict" as const };
			}
			return { kind: "duplicate" as const, delivery: existing };
		});
	}

	async claimDelivery(
		deliveryId: string,
	): Promise<ShopifyWebhookDelivery | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'processing', attempt_count = attempt_count + 1, failure_category = NULL, failure_stage = NULL, failure_code = NULL, shopify_request_id = NULL, failed_at = NULL, processing_started_at = NOW() WHERE id = $1 AND status IN ('received', 'failed') RETURNING ${CLAIMED_DELIVERY_COLUMNS}`,
			[deliveryId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? mapWebhookDeliveryRow(rows[0]) : null;
	}

	async markDeliveryFailed(
		deliveryId: string,
		failure: WebhookDeliveryFailureInput,
	): Promise<void> {
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'failed', failure_category = $1, failure_stage = $2, failure_code = $3, shopify_request_id = $4, failed_at = $5::timestamptz, processing_started_at = NULL WHERE id = $6 AND status = 'processing'`,
			[
				failure.category,
				failure.stage,
				failure.code,
				failure.requestId ?? null,
				failure.failedAtIso,
				deliveryId,
			],
		);
	}

	async markDeliveryProcessed(deliveryId: string): Promise<void> {
		await sql.unsafe(
			`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'processed', failure_category = NULL, failure_stage = NULL, failure_code = NULL, shopify_request_id = NULL, failed_at = NULL, processing_started_at = NULL, processed_at = NOW() WHERE id = $1`,
			[deliveryId],
		);
	}

	async listReclaimableDeliveries(
		organizationId: string,
		limit: number,
		staleBeforeIso: string,
	): Promise<ShopifyWebhookDelivery[]> {
		return sql.begin(async (tx) => {
			await tx.unsafe(
				`UPDATE ${this.schema}.shopify_webhook_deliveries SET status = 'failed', failure_category = 'upstream', failure_stage = 'projection', failure_code = 'unexpected', shopify_request_id = NULL, failed_at = NOW(), processing_started_at = NULL WHERE organization_id = $1 AND status = 'processing' AND (processing_started_at IS NULL OR processing_started_at <= $2::timestamptz)`,
				[organizationId, staleBeforeIso],
			);
			const rows = (await tx.unsafe(
				`SELECT ${CLAIMED_DELIVERY_COLUMNS} FROM ${this.schema}.shopify_webhook_deliveries WHERE organization_id = $1 AND status IN ('received', 'failed') ORDER BY received_at ASC LIMIT $2`,
				[organizationId, limit],
			)) as Array<Record<string, unknown>>;
			return rows.map(mapWebhookDeliveryRow);
		});
	}
}

export interface ReapStaleWebhookDeliveriesOptions {
	batchSize?: number;
	leaseMs?: number;
	now?: () => Date;
}

export async function reapStaleWebhookDeliveries(
	schema: string,
	options: ReapStaleWebhookDeliveriesOptions = {},
): Promise<string[]> {
	const safeSchema = postgresSchemaName(schema);
	const batchSize = Math.max(1, Math.min(options.batchSize ?? 100, 1000));
	const leaseMs = Math.max(1, options.leaseMs ?? 15 * 60_000);
	const now = options.now ?? (() => new Date());
	const staleBeforeIso = new Date(now().getTime() - leaseMs).toISOString();
	await initializePostgresSchema(safeSchema);
	const rows = (await sql.unsafe(
		`WITH stale AS (SELECT id FROM ${safeSchema}.shopify_webhook_deliveries WHERE status = 'processing' AND (processing_started_at IS NULL OR processing_started_at <= $1::timestamptz) ORDER BY processing_started_at ASC NULLS FIRST, received_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED) UPDATE ${safeSchema}.shopify_webhook_deliveries AS deliveries SET status = 'failed', failure_category = 'upstream', failure_stage = 'projection', failure_code = 'unexpected', shopify_request_id = NULL, failed_at = $3::timestamptz, processing_started_at = NULL FROM stale WHERE deliveries.id = stale.id RETURNING deliveries.id`,
		[staleBeforeIso, batchSize, now().toISOString()],
	)) as Array<Record<string, unknown>>;
	return rows.map((row) => String(row.id));
}
