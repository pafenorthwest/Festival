import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "bun";
import type { Context } from "hono";
import { BoundedAsyncCache } from "../lib/bounded-async-cache.js";
import type {
	DomainCacheInvalidationEvent,
	DomainCacheInvalidator,
} from "../lib/domain-cache-invalidator.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import { postgresSchemaName } from "../repo/postgres-schema.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";
import type { MembershipCommerceRepository } from "./membership-commerce-repository.js";
import type { ShopifyOrderProjectionService } from "./shopify-order-projection-service.js";
import {
	WebhookWorkerQueue,
	type WebhookWorkerQueueStats,
} from "./webhook-worker-queue.js";

export const MAX_SHOPIFY_WEBHOOK_BODY_BYTES = 64 * 1024;
export const DEFAULT_ORG_CACHE_TTL_MS = 60_000;
export const DEFAULT_SECRET_CACHE_TTL_MS = 60_000;
export const DEFAULT_WEBHOOK_PROCESSING_LEASE_MS = 15 * 60_000;
export const DEFAULT_WEBHOOK_REAP_BATCH_SIZE = 100;
const DEFAULT_CACHE_MAX_ENTRIES = 1_000;
const DEFAULT_ORG_CACHE_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_SECRET_CACHE_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_SECRET_ENTRY_MAX_BYTES = 4 * 1024;
const DEFAULT_ORG_ENTRY_MAX_BYTES = 64 * 1024;
const SHOPIFY_TOPIC = "orders/paid";
const SHOPIFY_API_VERSION = "2026-07";

type OrgRecord = Awaited<
	ReturnType<OrganizationRepository["findOrganizationByShopDomain"]>
>;

export interface ShopifyWebhookServiceOptions {
	queueConcurrency?: number;
	queueMaxBacklog?: number;
	queueMaxPendingRecovery?: number;
	orgCacheTtlMs?: number;
	secretCacheTtlMs?: number;
}

function canonicalShopDomain(value: string | undefined): string | undefined {
	const normalized = value?.trim().toLowerCase();
	return normalized && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)
		? normalized
		: undefined;
}

function validWebhookId(value: string | undefined): value is string {
	return Boolean(value && /^[A-Za-z0-9-]{16,128}$/.test(value));
}

function orderGidFromPayload(rawBody: Buffer): string | undefined {
	try {
		const payload: unknown = JSON.parse(rawBody.toString("utf8"));
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			return undefined;
		}
		const value = (payload as { admin_graphql_api_id?: unknown })
			.admin_graphql_api_id;
		return typeof value === "string" &&
			/^gid:\/\/shopify\/Order\/[^/?#\s]+$/.test(value)
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

function suppliedHmac(value: string | undefined): Buffer | undefined {
	if (
		!value ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			value,
		)
	) {
		return undefined;
	}
	const decoded = Buffer.from(value, "base64");
	return decoded.length === 32 && decoded.toString("base64") === value
		? decoded
		: undefined;
}

function verifyHmac(
	rawBody: Buffer,
	secret: string,
	header: string | undefined,
) {
	const supplied = suppliedHmac(header);
	if (!supplied) return false;
	const expected = createHmac("sha256", secret).update(rawBody).digest();
	return (
		expected.length === supplied.length && timingSafeEqual(expected, supplied)
	);
}

async function readRawBody(request: Request): Promise<Buffer | undefined> {
	const contentLength = request.headers.get("content-length");
	if (contentLength) {
		const declared = Number(contentLength);
		if (
			!Number.isSafeInteger(declared) ||
			declared < 0 ||
			declared > MAX_SHOPIFY_WEBHOOK_BODY_BYTES
		) {
			return undefined;
		}
	}
	const reader = request.body?.getReader();
	if (!reader) return Buffer.alloc(0);
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_SHOPIFY_WEBHOOK_BODY_BYTES) {
				await reader.cancel();
				return undefined;
			}
			chunks.push(value);
		}
		return Buffer.concat(chunks);
	} finally {
		reader.releaseLock();
	}
}

export interface ReapStaleWebhookDeliveriesOptions {
	batchSize?: number;
	leaseMs?: number;
	now?: () => Date;
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.trunc(value));
}

export async function reapStaleWebhookDeliveries(
	schema: string,
	options?: ReapStaleWebhookDeliveriesOptions,
): Promise<string[]> {
	const safeSchema = postgresSchemaName(schema);
	const batchSize = clampPositiveInt(
		options?.batchSize,
		DEFAULT_WEBHOOK_REAP_BATCH_SIZE,
	);
	const leaseMs = clampPositiveInt(
		options?.leaseMs,
		DEFAULT_WEBHOOK_PROCESSING_LEASE_MS,
	);
	const nowDate = (options?.now ?? (() => new Date()))();
	const failedAtIso = nowDate.toISOString();
	const staleBeforeIso = new Date(nowDate.getTime() - leaseMs).toISOString();
	const rows = (await sql.unsafe(
		`WITH stale AS (
			SELECT id
			FROM ${safeSchema}.shopify_webhook_deliveries
			WHERE status = 'processing'
				AND (processing_started_at IS NULL OR processing_started_at <= $1::timestamptz)
			ORDER BY processing_started_at ASC NULLS FIRST, id ASC
			LIMIT $3
			FOR UPDATE SKIP LOCKED
		)
		UPDATE ${safeSchema}.shopify_webhook_deliveries AS d
		SET status = 'failed',
			failure_category = 'upstream',
			failure_stage = 'projection',
			failure_code = 'unexpected',
			shopify_request_id = NULL,
			failed_at = $2::timestamptz,
			processing_started_at = NULL
		FROM stale
		WHERE d.id = stale.id
		RETURNING d.id`,
		[staleBeforeIso, failedAtIso, batchSize],
	)) as Array<{ id: string }>;
	return rows.map((row) => String(row.id));
}

function enqueueReclaimedIntoQueue(
	queue: WebhookWorkerQueue,
	deliveryIds: readonly string[],
	customSchedule?: (deliveryId: string) => void,
): number {
	let scheduled = 0;
	for (const id of deliveryIds) {
		if (!id || queue.isQueuedOrActive(id)) {
			continue;
		}
		if (customSchedule) {
			customSchedule(id);
			scheduled++;
			continue;
		}
		const beforePending = queue.stats().pendingRecoveryCount;
		const accepted = queue.enqueue(id, { retainForRecovery: true });
		if (accepted || queue.stats().pendingRecoveryCount > beforePending) {
			scheduled++;
		}
	}
	return scheduled;
}

export class ShopifyWebhookService {
	private readonly queue: WebhookWorkerQueue;
	private readonly scheduleFn: (deliveryId: string) => void;
	private readonly customSchedule?: (deliveryId: string) => void;
	private readonly orgCache: BoundedAsyncCache<string, OrgRecord>;
	private readonly secretCache: BoundedAsyncCache<string, string>;
	private readonly orgCacheTtlMs: number;
	private readonly secretCacheTtlMs: number;
	private cacheInvalidator?: DomainCacheInvalidator;
	private unsubscribeCacheInvalidator?: () => void;

	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly commerce: MembershipCommerceRepository,
		private readonly secretKeyring: ShopifySecretKeyring | undefined,
		private readonly projection: ShopifyOrderProjectionService | undefined,
		private readonly now: () => Date = () => new Date(),
		schedule?: ((deliveryId: string) => void) | WebhookWorkerQueue,
		options?: ShopifyWebhookServiceOptions,
	) {
		this.orgCacheTtlMs = options?.orgCacheTtlMs ?? DEFAULT_ORG_CACHE_TTL_MS;
		this.secretCacheTtlMs =
			options?.secretCacheTtlMs ?? DEFAULT_SECRET_CACHE_TTL_MS;

		this.orgCache = new BoundedAsyncCache({
			maxEntries: DEFAULT_CACHE_MAX_ENTRIES,
			maxEntryBytes: DEFAULT_ORG_ENTRY_MAX_BYTES,
			maxTotalBytes: DEFAULT_ORG_CACHE_MAX_BYTES,
			now: () => this.now().getTime(),
		});

		this.secretCache = new BoundedAsyncCache({
			maxEntries: DEFAULT_CACHE_MAX_ENTRIES,
			maxEntryBytes: DEFAULT_SECRET_ENTRY_MAX_BYTES,
			maxTotalBytes: DEFAULT_SECRET_CACHE_MAX_BYTES,
			now: () => this.now().getTime(),
		});

		this.customSchedule = typeof schedule === "function" ? schedule : undefined;
		this.queue =
			schedule instanceof WebhookWorkerQueue
				? schedule
				: new WebhookWorkerQueue({
						handler: async (deliveryId) => {
							await this.projection?.processDelivery(deliveryId);
						},
						concurrency: options?.queueConcurrency,
						maxBacklog: options?.queueMaxBacklog,
						maxPendingRecovery: options?.queueMaxPendingRecovery,
					});
		this.scheduleFn =
			this.customSchedule ??
			((deliveryId) => {
				this.queue.enqueue(deliveryId);
			});
	}

	getQueue(): WebhookWorkerQueue {
		return this.queue;
	}

	getStats(): WebhookWorkerQueueStats {
		return this.queue.getStats();
	}

	getAvailableReclaimSlots(limit = DEFAULT_WEBHOOK_REAP_BATCH_SIZE): number {
		return this.queue.getAvailableReclaimSlots(limit);
	}

	drain(): Promise<void> {
		return this.queue.drain();
	}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.unsubscribeCacheInvalidator?.();
		this.cacheInvalidator = invalidator;
		this.unsubscribeCacheInvalidator = invalidator.subscribe((event) =>
			this.handleCacheInvalidation(event),
		);
	}

	private flushLocalCaches(): void {
		this.orgCache.deleteWhere(() => true);
		this.secretCache.deleteWhere(() => true);
	}

	private handleCacheInvalidation(event: DomainCacheInvalidationEvent): void {
		if (event.type === "ShopifySecretRotated") {
			this.orgCache.deleteWhere(
				(_domain, org) =>
					!event.organizationId || org?.id === event.organizationId,
			);
			this.secretCache.deleteWhere(
				(key) =>
					!event.organizationId || key.startsWith(`${event.organizationId}:`),
			);
			return;
		}
		if (event.type === "OrgUpdated") {
			this.orgCache.deleteWhere(
				(_domain, org) => org?.id === event.organizationId,
			);
			return;
		}
		if (event.type === "CachesCleared") {
			this.flushLocalCaches();
		}
	}

	clearCaches(): void {
		this.flushLocalCaches();
		this.cacheInvalidator?.clearAll();
	}

	reclaimPending(
		fetchPendingDeliveryIds: () => Promise<string[]>,
	): Promise<number> {
		return this.queue.reclaimPending(fetchPendingDeliveryIds);
	}

	reclaimOrganizationPending(
		organizationId: string,
		limit = this.queue.maxBacklog,
		leaseMs = 15 * 60 * 1_000,
	): Promise<number> {
		const staleBeforeIso = new Date(
			this.now().getTime() - leaseMs,
		).toISOString();
		return this.reclaimPending(async () => {
			const pending = await this.commerce.listReclaimableDeliveries(
				organizationId,
				limit,
				staleBeforeIso,
			);
			return pending.map((delivery) => delivery.id);
		});
	}

	enqueueReclaimedDeliveries(deliveryIds: readonly string[]): number {
		return enqueueReclaimedIntoQueue(
			this.queue,
			deliveryIds,
			this.customSchedule,
		);
	}

	async reapStaleProcessingDeliveries(
		schema: string,
		options?: { batchSize?: number; leaseMs?: number },
	): Promise<number> {
		const batchSize = this.getAvailableReclaimSlots(options?.batchSize);
		if (batchSize <= 0) {
			return 0;
		}
		const ids = await reapStaleWebhookDeliveries(schema, {
			...options,
			batchSize,
			now: this.now,
		});
		return this.enqueueReclaimedDeliveries(ids);
	}

	private async resolveVerifiedClientSecret(
		shopDomain: string,
		secretKeyring: ShopifySecretKeyring,
	): Promise<{ organizationId: string; clientSecret: string } | null> {
		const organization = await this.orgCache.getOrLoad(shopDomain, async () => {
			const value =
				await this.organizations.findOrganizationByShopDomain(shopDomain);
			return {
				value,
				ttlMs: this.orgCacheTtlMs,
				bytes: value ? 512 : 16,
			};
		});
		if (!organization) return null;
		const integration = await this.organizations.getShopifyIntegration(
			organization.id,
		);
		if (
			!integration ||
			integration.verificationStatus !== "ok" ||
			integration.verifiedShopDomain !== shopDomain
		) {
			return null;
		}
		try {
			const cacheKey = `${organization.id}:${integration.encryptedClientSecret}`;
			const clientSecret = await this.secretCache.getOrLoad(
				cacheKey,
				async () => {
					const decrypted = secretKeyring.decrypt(
						integration.encryptedClientSecret,
						{
							organizationId: organization.id,
							purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
						},
					);
					return {
						value: decrypted,
						ttlMs: this.secretCacheTtlMs,
						bytes: Buffer.byteLength(decrypted),
					};
				},
			);
			return { organizationId: organization.id, clientSecret };
		} catch {
			return null;
		}
	}

	async handle(context: Context): Promise<Response> {
		if (
			context.req.header("Origin") !== undefined ||
			context.req.header("Cookie") !== undefined ||
			context.req.header("Authorization") !== undefined
		) {
			return new Response(null, { status: 400 });
		}
		const rawBody = await readRawBody(context.req.raw);
		if (!rawBody) return new Response(null, { status: 413 });
		const shopDomain = canonicalShopDomain(
			context.req.header("X-Shopify-Shop-Domain"),
		);
		const webhookId = context.req.header("X-Shopify-Webhook-Id");
		const topic = context.req.header("X-Shopify-Topic");
		const apiVersion = context.req.header("X-Shopify-API-Version");
		const orderGid = orderGidFromPayload(rawBody);
		const secretKeyring = this.secretKeyring;
		if (
			!shopDomain ||
			!validWebhookId(webhookId) ||
			topic !== SHOPIFY_TOPIC ||
			apiVersion !== SHOPIFY_API_VERSION ||
			!orderGid ||
			!secretKeyring
		) {
			return new Response(null, { status: 400 });
		}
		const verified = await this.resolveVerifiedClientSecret(
			shopDomain,
			secretKeyring,
		);
		if (
			!verified ||
			!verifyHmac(
				rawBody,
				verified.clientSecret,
				context.req.header("X-Shopify-Hmac-Sha256"),
			)
		) {
			return new Response(null, { status: 401 });
		}
		const recorded = await this.commerce.recordDelivery({
			organizationId: verified.organizationId,
			shopDomain,
			webhookId,
			topic: SHOPIFY_TOPIC,
			apiVersion: SHOPIFY_API_VERSION,
			shopifyOrderGid: orderGid,
			payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
			receivedAtIso: this.now().toISOString(),
		});
		if (recorded.kind === "conflict")
			return new Response(null, { status: 409 });
		if (
			recorded.kind === "accepted" ||
			((recorded.delivery.status === "received" ||
				recorded.delivery.status === "failed") &&
				!this.queue.isQueuedOrActive(recorded.delivery.id))
		) {
			this.scheduleFn(recorded.delivery.id);
		}
		return new Response(null, {
			status: recorded.kind === "accepted" ? 202 : 200,
		});
	}
}
