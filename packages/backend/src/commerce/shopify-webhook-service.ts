import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";
import type { MembershipCommerceRepository } from "./membership-commerce-repository.js";
import type { ShopifyOrderProjectionService } from "./shopify-order-projection-service.js";

export const MAX_SHOPIFY_WEBHOOK_BODY_BYTES = 64 * 1024;
const SHOPIFY_TOPIC = "orders/paid";
const SHOPIFY_API_VERSION = "2026-07";

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
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly commerce: MembershipCommerceRepository,
		private readonly secretKeyring: ShopifySecretKeyring | undefined,
		private readonly projection: ShopifyOrderProjectionService | undefined,
		private readonly now: () => Date = () => new Date(),
		private readonly schedule: (deliveryId: string) => void = (deliveryId) => {
			queueMicrotask(() => {
				void this.projection?.processDelivery(deliveryId);
			});
		},
	) {}

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
		if (
			!shopDomain ||
			!validWebhookId(webhookId) ||
			topic !== SHOPIFY_TOPIC ||
			apiVersion !== SHOPIFY_API_VERSION ||
			!orderGid ||
			!this.secretKeyring
		) {
			return new Response(null, { status: 400 });
		}
		const organization =
			await this.organizations.findOrganizationByShopDomain(shopDomain);
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
			clientSecret = this.secretKeyring.decrypt(
				integration.encryptedClientSecret,
				{
					organizationId: organization.id,
					purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
				},
			);
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
		if (recorded.kind === "accepted") this.schedule(recorded.delivery.id);
		return new Response(null, {
			status: recorded.kind === "accepted" ? 202 : 200,
		});
	}
}
