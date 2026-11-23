import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import type { FirebaseClaimsReconciliationService } from "../auth/firebase-claims-reconciliation.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { ShopifyOrderProjectionService } from "../commerce/shopify-order-projection-service.js";
import type { ShopifyWebhookService } from "../commerce/shopify-webhook-service.js";
import type { WebhookWorkerQueueStats } from "../commerce/webhook-worker-queue.js";
import type { AppEnv } from "../config/env.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";

export const PRIVATE_RUNTIME_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/ready",
		authenticationClass: "private-runtime",
		csrfRequired: false,
		browserAllowed: false,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/diagnostics",
		authenticationClass: "private-runtime",
		csrfRequired: false,
		browserAllowed: false,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/metrics",
		authenticationClass: "private-runtime",
		csrfRequired: false,
		browserAllowed: false,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/operator/status",
		authenticationClass: "private-operator",
		csrfRequired: false,
		browserAllowed: false,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/reconcile/shopify-orders",
		authenticationClass: "private-service",
		csrfRequired: false,
		browserAllowed: false,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/reconcile/firebase-claims",
		authenticationClass: "private-service",
		csrfRequired: false,
		browserAllowed: false,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/events/shopify-orders-paid",
		authenticationClass: "private-event-bus",
		csrfRequired: false,
		browserAllowed: false,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface PrivateRuntimeRoutesOptions {
	env: AppEnv;
	repository: OrganizationRepository;
	commerceRepository: MembershipCommerceRepository;
	shopifyOrderProjectionService: ShopifyOrderProjectionService;
	shopifyWebhookService?: Pick<ShopifyWebhookService, "getStats"> &
		Partial<Pick<ShopifyWebhookService, "reclaimOrganizationPending">>;
	firebaseClaimsReconciliationService?: FirebaseClaimsReconciliationService;
	hasShopifyKeyring: boolean;
}

const DEFAULT_WEBHOOK_QUEUE_STATS: WebhookWorkerQueueStats = {
	queued: 0,
	active: 0,
	completed: 0,
	failed: 0,
	saturated: false,
	rejectedCount: 0,
	pendingRecoveryCount: 0,
	recoveredCount: 0,
	recoveryOverflowCount: 0,
};

function readWebhookQueueStats(
	service: Pick<ShopifyWebhookService, "getStats"> | undefined,
): WebhookWorkerQueueStats {
	return service ? service.getStats() : { ...DEFAULT_WEBHOOK_QUEUE_STATS };
}

type StatusCode = 200 | 202 | 400 | 401 | 404 | 409 | 503;

function privateTokenMatches(
	provided: string | undefined,
	expected: string | undefined,
): boolean {
	if (!provided || !expected) return false;
	const actualBytes = Buffer.from(provided, "utf8");
	const expectedBytes = Buffer.from(expected, "utf8");
	return (
		actualBytes.length === expectedBytes.length &&
		timingSafeEqual(actualBytes, expectedBytes)
	);
}

export function hasForbiddenBrowserHeaders(c: Context): boolean {
	return (
		c.req.header("Cookie") !== undefined ||
		c.req.header("Authorization") !== undefined ||
		c.req.header("Origin") !== undefined ||
		c.req.header("X-CSRF-Token") !== undefined
	);
}

function jsonNoStore(c: Context, payload: unknown, status: StatusCode = 200) {
	c.header("Cache-Control", "no-store");
	return c.json(payload, status);
}

function requireHeaderToken(
	c: Context,
	headerName: string,
	expected: string | undefined,
): boolean {
	return (
		!hasForbiddenBrowserHeaders(c) &&
		privateTokenMatches(c.req.header(headerName), expected)
	);
}

function authorizeShopifyReconciliation(
	c: Context,
	env: AppEnv,
	organizationId: string,
): boolean {
	if (hasForbiddenBrowserHeaders(c)) return false;
	const provided = c.req.header("X-Festival-Reconciliation-Token");
	return (
		privateTokenMatches(provided, env.reconciliationToken) ||
		privateTokenMatches(
			provided,
			env.tenantReconciliationTokens?.[organizationId],
		)
	);
}

interface ShopifyPaidOrderEventEnvelope {
	eventId: string;
	organizationId: string;
	shopDomain: string;
	topic: "orders/paid";
	apiVersion: "2026-07";
	shopifyOrderGid: string;
	payloadSha256: string;
}

function parsePaidOrderEventEnvelope(
	body: unknown,
): ShopifyPaidOrderEventEnvelope | null {
	if (!body || typeof body !== "object" || Array.isArray(body)) return null;
	const raw = body as Record<string, unknown>;
	const eventId = typeof raw.eventId === "string" ? raw.eventId.trim() : "";
	const organizationId =
		typeof raw.organizationId === "string" ? raw.organizationId.trim() : "";
	const shopDomain =
		typeof raw.shopDomain === "string"
			? raw.shopDomain.trim().toLowerCase()
			: "";
	const shopifyOrderGid =
		typeof raw.shopifyOrderGid === "string" ? raw.shopifyOrderGid.trim() : "";
	const payloadSha256 =
		typeof raw.payloadSha256 === "string"
			? raw.payloadSha256.trim().toLowerCase()
			: "";
	if (
		!/^[A-Za-z0-9_-]{16,128}$/.test(eventId) ||
		!organizationId ||
		organizationId.length > 256 ||
		!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain) ||
		raw.topic !== "orders/paid" ||
		raw.apiVersion !== "2026-07" ||
		!/^gid:\/\/shopify\/Order\/[^/?#\s]+$/.test(shopifyOrderGid) ||
		!/^[0-9a-f]{64}$/.test(payloadSha256)
	) {
		return null;
	}
	return {
		eventId,
		organizationId,
		shopDomain,
		topic: "orders/paid",
		apiVersion: "2026-07",
		shopifyOrderGid,
		payloadSha256,
	};
}

async function handleShopifyReconcile(
	c: Context,
	options: PrivateRuntimeRoutesOptions,
) {
	if (hasForbiddenBrowserHeaders(c))
		return jsonNoStore(c, { error: "Not found." }, 404);
	try {
		const body = await c.req.json();
		const orgId =
			body &&
			typeof body === "object" &&
			!Array.isArray(body) &&
			Object.keys(body).length === 1 &&
			typeof (body as { organizationId?: unknown }).organizationId === "string"
				? (body as { organizationId: string }).organizationId.trim()
				: "";
		if (!orgId || orgId.length > 256) {
			return requireHeaderToken(
				c,
				"X-Festival-Reconciliation-Token",
				options.env.reconciliationToken,
			)
				? jsonNoStore(c, { error: "Reconciliation request is invalid." }, 400)
				: jsonNoStore(c, { error: "Not found." }, 404);
		}
		if (!authorizeShopifyReconciliation(c, options.env, orgId)) {
			return jsonNoStore(c, { error: "Not found." }, 404);
		}
		const result = await options.shopifyOrderProjectionService.reconcile(orgId);
		await options.shopifyWebhookService?.reclaimOrganizationPending?.(orgId);
		return jsonNoStore(c, result);
	} catch {
		return jsonNoStore(
			c,
			{ error: "Shopify order reconciliation failed." },
			503,
		);
	}
}

async function handleFirebaseClaimsReconcile(
	c: Context,
	options: PrivateRuntimeRoutesOptions,
) {
	if (
		!requireHeaderToken(
			c,
			"X-Festival-Reconciliation-Token",
			options.env.reconciliationToken,
		)
	) {
		return jsonNoStore(c, { error: "Not found." }, 404);
	}
	if (!options.firebaseClaimsReconciliationService) {
		return jsonNoStore(
			c,
			{ error: "Firebase claims reconciliation is unavailable." },
			503,
		);
	}
	try {
		const body = await c.req.json();
		if (
			!body ||
			typeof body !== "object" ||
			Array.isArray(body) ||
			Object.keys(body).length !== 0
		) {
			return jsonNoStore(
				c,
				{ error: "Reconciliation request is invalid." },
				400,
			);
		}
		const result =
			await options.firebaseClaimsReconciliationService.reconcile();
		return jsonNoStore(c, result, result.failedCount > 0 ? 503 : 200);
	} catch {
		return jsonNoStore(
			c,
			{ error: "Firebase claims reconciliation failed." },
			503,
		);
	}
}

async function handlePaidOrderEvent(
	c: Context,
	options: PrivateRuntimeRoutesOptions,
) {
	if (
		!requireHeaderToken(
			c,
			"X-Festival-Event-Bus-Token",
			options.env.eventBusToken,
		)
	) {
		return jsonNoStore(c, { error: "Not found." }, 404);
	}
	const parsed = await c.req
		.json()
		.then(parsePaidOrderEventEnvelope)
		.catch(() => null);
	if (!parsed) return jsonNoStore(c, { error: "Invalid event envelope." }, 400);
	const integration = await options.repository.getShopifyIntegration(
		parsed.organizationId,
	);
	if (
		!integration ||
		integration.verificationStatus !== "ok" ||
		integration.verifiedShopDomain !== parsed.shopDomain
	) {
		return jsonNoStore(c, { error: "Unverified candidate organization." }, 401);
	}
	const recorded = await options.commerceRepository.recordDelivery({
		organizationId: parsed.organizationId,
		shopDomain: parsed.shopDomain,
		webhookId: parsed.eventId,
		topic: parsed.topic,
		apiVersion: parsed.apiVersion,
		shopifyOrderGid: parsed.shopifyOrderGid,
		payloadSha256: parsed.payloadSha256,
		receivedAtIso: new Date().toISOString(),
	});
	if (recorded.kind === "conflict")
		return jsonNoStore(c, { error: "Event delivery conflict." }, 409);
	if (recorded.kind === "accepted") {
		await options.shopifyOrderProjectionService.processDelivery(
			recorded.delivery.id,
		);
	}
	return jsonNoStore(
		c,
		{ status: recorded.kind },
		recorded.kind === "accepted" ? 202 : 200,
	);
}

async function handleReadyCheck(
	c: Context,
	options: PrivateRuntimeRoutesOptions,
) {
	if (
		!requireHeaderToken(c, "X-Festival-Runtime-Token", options.env.runtimeToken)
	) {
		return jsonNoStore(c, { error: "Not found." }, 404);
	}
	try {
		await options.repository.ensureReady();
		return jsonNoStore(c, {
			status: "ready",
			checks: {
				repository: "ok",
				shopifyKeyring: options.hasShopifyKeyring ? "configured" : "disabled",
			},
		});
	} catch {
		return jsonNoStore(c, { status: "not_ready" }, 503);
	}
}

function handleDiagnostics(c: Context, options: PrivateRuntimeRoutesOptions) {
	if (
		!requireHeaderToken(c, "X-Festival-Runtime-Token", options.env.runtimeToken)
	) {
		return jsonNoStore(c, { error: "Not found." }, 404);
	}
	return jsonNoStore(c, {
		status: "ok",
		diagnostics: {
			trustProxyHeaders: Boolean(options.env.trustProxyHeaders),
			dropTransferEnabled: Boolean(options.env.enableDropTransfer),
			shopifyKeyringConfigured: options.hasShopifyKeyring,
			shopifyWebhookQueue: readWebhookQueueStats(options.shopifyWebhookService),
		},
	});
}

function handleMetrics(c: Context, options: PrivateRuntimeRoutesOptions) {
	if (
		!requireHeaderToken(c, "X-Festival-Runtime-Token", options.env.runtimeToken)
	) {
		return jsonNoStore(c, { error: "Not found." }, 404);
	}
	return jsonNoStore(c, {
		status: "ok",
		subsystems: {
			reconciliationConfigured: Boolean(
				options.env.reconciliationToken ||
					Object.keys(options.env.tenantReconciliationTokens ?? {}).length > 0,
			),
			eventBusConfigured: Boolean(options.env.eventBusToken),
			firebaseClaimsReconciliationConfigured: Boolean(
				options.firebaseClaimsReconciliationService,
			),
		},
		shopifyWebhookQueue: readWebhookQueueStats(options.shopifyWebhookService),
	});
}

function handleOperatorStatus(
	c: Context,
	options: PrivateRuntimeRoutesOptions,
) {
	if (
		!requireHeaderToken(
			c,
			"X-Festival-Operator-Token",
			options.env.operatorToken,
		)
	) {
		return jsonNoStore(c, { error: "Not found." }, 404);
	}
	return jsonNoStore(c, {
		status: "ok",
		boundaries: {
			publicHealthz: "minimal",
			privateRuntimeAuthenticated: true,
			tenantScopedReconciliationCount: Object.keys(
				options.env.tenantReconciliationTokens ?? {},
			).length,
		},
		shopifyWebhookQueue: readWebhookQueueStats(options.shopifyWebhookService),
	});
}

export function buildPrivateRuntimeRouter(
	options: PrivateRuntimeRoutesOptions,
) {
	return new Hono()
		.get("/ready", (c) => handleReadyCheck(c, options))
		.get("/diagnostics", (c) => handleDiagnostics(c, options))
		.get("/metrics", (c) => handleMetrics(c, options))
		.get("/operator/status", (c) => handleOperatorStatus(c, options))
		.post("/reconcile/shopify-orders", (c) =>
			handleShopifyReconcile(c, options),
		)
		.post("/reconcile/firebase-claims", (c) =>
			handleFirebaseClaimsReconcile(c, options),
		)
		.post("/events/shopify-orders-paid", (c) =>
			handlePaidOrderEvent(c, options),
		);
}
