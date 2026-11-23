import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import {
	BoundedAsyncCache,
	type DomainCacheInvalidationEvent,
	type DomainCacheInvalidator,
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../../infra/s11-infra.js";
import type { CommerceProjectionEventBus } from "./events.js";
import { SHOPIFY_API_VERSION } from "./order-projection-helpers.js";
import type { CommerceOrganizationPort } from "./ports.js";
import {
	type ReapStaleWebhookDeliveriesOptions,
	reapStaleWebhookDeliveries,
	type ShopifyWebhookDeliveryRepository,
} from "./webhook-delivery-repository.js";
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

export { type ReapStaleWebhookDeliveriesOptions, reapStaleWebhookDeliveries };

export type WebhookOrganizationPort = Pick<
	CommerceOrganizationPort,
	"findOrganizationByShopDomain" | "getShopifyIntegration"
>;

export type WebhookCommercePort = Pick<
	ShopifyWebhookDeliveryRepository,
	"recordDelivery" | "listReclaimableDeliveries"
>;

export interface WebhookProjectionTarget {
	processDelivery(deliveryId: string): Promise<unknown>;
}

type OrgRecord = Awaited<
	ReturnType<WebhookOrganizationPort["findOrganizationByShopDomain"]>
>;

export interface ShopifyWebhookServiceOptions {
	queueConcurrency?: number;
	queueMaxBacklog?: number;
	queueMaxPendingRecovery?: number;
	maxPendingRecovery?: number;
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
): boolean {
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

function enqueueReclaimedIntoQueue(
	queue: WebhookWorkerQueue,
	deliveryIds: readonly string[],
	customSchedule?: (deliveryId: string) => void,
): number {
	let scheduled = 0;
	for (const id of deliveryIds) {
		if (!id || queue.isQueuedOrActive(id)) continue;
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

async function resolveVerifiedClientSecret(input: {
	shopDomain: string;
	secretKeyring: ShopifySecretKeyring;
	organizations: WebhookOrganizationPort;
	orgCache: BoundedAsyncCache<string, OrgRecord>;
	secretCache: BoundedAsyncCache<string, string>;
	orgCacheTtlMs: number;
	secretCacheTtlMs: number;
}): Promise<{ organizationId: string; clientSecret: string } | null> {
	const organization = await input.orgCache.getOrLoad(
		input.shopDomain,
		async () => {
			const value = await input.organizations.findOrganizationByShopDomain(
				input.shopDomain,
			);
			return { value, ttlMs: input.orgCacheTtlMs, bytes: value ? 512 : 16 };
		},
	);
	if (!organization) return null;
	const integration = await input.organizations.getShopifyIntegration(
		organization.id,
	);
	if (
		!integration ||
		integration.verificationStatus !== "ok" ||
		integration.verifiedShopDomain !== input.shopDomain
	) {
		return null;
	}
	try {
		const cacheKey = `${organization.id}:${integration.encryptedClientSecret}`;
		const clientSecret = await input.secretCache.getOrLoad(
			cacheKey,
			async () => {
				const decrypted = input.secretKeyring.decrypt(
					integration.encryptedClientSecret,
					{
						organizationId: organization.id,
						purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
					},
				);
				return {
					value: decrypted,
					ttlMs: input.secretCacheTtlMs,
					bytes: Buffer.byteLength(decrypted),
				};
			},
		);
		return { organizationId: organization.id, clientSecret };
	} catch {
		return null;
	}
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
	private eventBus?: CommerceProjectionEventBus;

	constructor(
		private readonly organizations: WebhookOrganizationPort,
		private readonly commerce: WebhookCommercePort,
		private readonly secretKeyring: ShopifySecretKeyring | undefined,
		private readonly projection?: WebhookProjectionTarget,
		private readonly now: () => Date = () => new Date(),
		schedule?: ((deliveryId: string) => void) | WebhookWorkerQueue,
		options?: ShopifyWebhookServiceOptions,
	) {
		this.orgCacheTtlMs = options?.orgCacheTtlMs ?? DEFAULT_ORG_CACHE_TTL_MS;
		this.secretCacheTtlMs =
			options?.secretCacheTtlMs ?? DEFAULT_SECRET_CACHE_TTL_MS;
		const nowMs = () => this.now().getTime();
		this.orgCache = new BoundedAsyncCache({
			maxEntries: DEFAULT_CACHE_MAX_ENTRIES,
			maxEntryBytes: DEFAULT_ORG_ENTRY_MAX_BYTES,
			maxTotalBytes: DEFAULT_ORG_CACHE_MAX_BYTES,
			now: nowMs,
		});
		this.secretCache = new BoundedAsyncCache({
			maxEntries: DEFAULT_CACHE_MAX_ENTRIES,
			maxEntryBytes: DEFAULT_SECRET_ENTRY_MAX_BYTES,
			maxTotalBytes: DEFAULT_SECRET_CACHE_MAX_BYTES,
			now: nowMs,
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
						maxPendingRecovery:
							options?.queueMaxPendingRecovery ?? options?.maxPendingRecovery,
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

	bindEventBus(eventBus: CommerceProjectionEventBus): void {
		this.eventBus = eventBus;
	}

	clearCaches(): void {
		this.orgCache.deleteWhere(() => true);
		this.secretCache.deleteWhere(() => true);
		this.cacheInvalidator?.clearAll();
		this.eventBus?.emit({ type: "ShopifySecretRotated" });
	}

	reclaimPending(
		fetchPendingDeliveryIds: () => Promise<string[]>,
	): Promise<number> {
		return this.queue.reclaimPending(fetchPendingDeliveryIds);
	}

	reclaimOrganizationPending(
		organizationId: string,
		limit = this.queue.maxBacklog,
		leaseMs = DEFAULT_WEBHOOK_PROCESSING_LEASE_MS,
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
		if (batchSize <= 0) return 0;
		const ids = await reapStaleWebhookDeliveries(schema, {
			...options,
			batchSize,
			now: this.now,
		});
		return this.enqueueReclaimedDeliveries(ids);
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
		const orderGid = orderGidFromPayload(rawBody);
		if (
			!shopDomain ||
			!validWebhookId(webhookId) ||
			context.req.header("X-Shopify-Topic") !== SHOPIFY_TOPIC ||
			context.req.header("X-Shopify-API-Version") !== SHOPIFY_API_VERSION ||
			!orderGid ||
			!this.secretKeyring
		) {
			return new Response(null, { status: 400 });
		}
		return this.verifyAndAcceptDelivery({
			context,
			rawBody,
			shopDomain,
			webhookId,
			orderGid,
			secretKeyring: this.secretKeyring,
		});
	}

	private async verifyAndAcceptDelivery(input: {
		context: Context;
		rawBody: Buffer;
		shopDomain: string;
		webhookId: string;
		orderGid: string;
		secretKeyring: ShopifySecretKeyring;
	}): Promise<Response> {
		const verified = await resolveVerifiedClientSecret({
			shopDomain: input.shopDomain,
			secretKeyring: input.secretKeyring,
			organizations: this.organizations,
			orgCache: this.orgCache,
			secretCache: this.secretCache,
			orgCacheTtlMs: this.orgCacheTtlMs,
			secretCacheTtlMs: this.secretCacheTtlMs,
		});
		if (
			!verified ||
			!verifyHmac(
				input.rawBody,
				verified.clientSecret,
				input.context.req.header("X-Shopify-Hmac-Sha256"),
			)
		) {
			return new Response(null, { status: 401 });
		}
		const recorded = await this.commerce.recordDelivery({
			organizationId: verified.organizationId,
			shopDomain: input.shopDomain,
			webhookId: input.webhookId,
			topic: SHOPIFY_TOPIC,
			apiVersion: SHOPIFY_API_VERSION,
			shopifyOrderGid: input.orderGid,
			payloadSha256: createHash("sha256").update(input.rawBody).digest("hex"),
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
			this.orgCache.deleteWhere(() => true);
			this.secretCache.deleteWhere(() => true);
		}
	}
}
