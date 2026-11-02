import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";
import { BoundedAsyncCache } from "./bounded-async-cache.js";
import type { MembershipCommerceRepository } from "./membership-commerce-repository.js";
import type { ShopifyOrderProjectionService } from "./shopify-order-projection-service.js";
import { WebhookWorkerQueue } from "./webhook-worker-queue.js";

export const MAX_SHOPIFY_WEBHOOK_BODY_BYTES = 64 * 1024;
export const DEFAULT_ORG_CACHE_TTL_MS = 60_000;
export const DEFAULT_SECRET_CACHE_TTL_MS = 60_000;
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

export class ShopifyWebhookService {
	private readonly queue: WebhookWorkerQueue;
	private readonly scheduleFn: (deliveryId: string) => void;
	private readonly orgCache: BoundedAsyncCache<string, OrgRecord>;
	private readonly secretCache: BoundedAsyncCache<string, string>;
	private readonly orgCacheTtlMs: number;
	private readonly secretCacheTtlMs: number;

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

		if (schedule instanceof WebhookWorkerQueue) {
			this.queue = schedule;
			this.scheduleFn = (deliveryId) => {
				this.queue.enqueue(deliveryId);
			};
		} else {
			this.queue = new WebhookWorkerQueue({
				handler: async (deliveryId) => {
					await this.projection?.processDelivery(deliveryId);
				},
				concurrency: options?.queueConcurrency,
				maxBacklog: options?.queueMaxBacklog,
			});
			if (typeof schedule === "function") {
				this.scheduleFn = schedule;
			} else {
				this.scheduleFn = (deliveryId) => {
					this.queue.enqueue(deliveryId);
				};
			}
		}
	}

	getQueue(): WebhookWorkerQueue {
		return this.queue;
	}

	drain(): Promise<void> {
		return this.queue.drain();
	}

	clearCaches(): void {
		this.orgCache.deleteWhere(() => true);
		this.secretCache.deleteWhere(() => true);
	}

	reclaimPending(
		fetchPendingDeliveryIds: () => Promise<string[]>,
	): Promise<number> {
		return this.queue.reclaimPending(fetchPendingDeliveryIds);
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
		const organization = await this.orgCache.getOrLoad(shopDomain, async () => {
			const value =
				await this.organizations.findOrganizationByShopDomain(shopDomain);
			return {
				value,
				ttlMs: this.orgCacheTtlMs,
				bytes: value ? 512 : 16,
			};
		});
		if (!organization) return new Response(null, { status: 401 });
		const integration = await this.organizations.getShopifyIntegration(
			organization.id,
		);
		if (
			!integration ||
			integration.verificationStatus !== "ok" ||
			integration.verifiedShopDomain !== shopDomain
		) {
			return new Response(null, { status: 401 });
		}
		let clientSecret: string;
		try {
			const cacheKey = `${organization.id}:${integration.encryptedClientSecret}`;
			clientSecret = await this.secretCache.getOrLoad(cacheKey, async () => {
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
			});
		} catch {
			return new Response(null, { status: 401 });
		}
		if (
			!verifyHmac(
				rawBody,
				clientSecret,
				context.req.header("X-Shopify-Hmac-Sha256"),
			)
		) {
			return new Response(null, { status: 401 });
		}
		const recorded = await this.commerce.recordDelivery({
			organizationId: organization.id,
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
		if (recorded.kind === "accepted") this.scheduleFn(recorded.delivery.id);
		return new Response(null, {
			status: recorded.kind === "accepted" ? 202 : 200,
		});
	}
}
