import type {
	ShopifyWebhookFailureCategory,
	ShopifyWebhookReadiness,
} from "@festival/common";
import type { TenantContext } from "../auth/tenant-context.js";
import { AppError } from "../errors/app-error.js";
import type {
	OrganizationRepository,
	ShopifyIntegrationRecord,
} from "../repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "./encryption.js";
import { ShopifyWebhookOperationError } from "./errors.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyCredentials,
	ShopifyWebhookSubscriptionClient,
} from "./types.js";

export const SHOPIFY_ORDERS_PAID_WEBHOOK_PATH =
	"/api/shopify/webhooks/orders-paid";

function callbackUrl(publicOrigin: string | undefined): string {
	if (!publicOrigin) {
		throw new Error(
			"FESTIVAL_PUBLIC_ORIGIN is required when Shopify services are enabled.",
		);
	}
	let origin: URL;
	try {
		origin = new URL(publicOrigin);
	} catch {
		throw new Error("FESTIVAL_PUBLIC_ORIGIN is invalid.");
	}
	if (
		origin.protocol !== "https:" ||
		origin.username ||
		origin.password ||
		origin.port
	) {
		throw new Error(
			"FESTIVAL_PUBLIC_ORIGIN must be an external HTTPS origin without credentials or a port.",
		);
	}
	return new URL(SHOPIFY_ORDERS_PAID_WEBHOOK_PATH, origin).toString();
}

const READY_MESSAGE = "Paid-order webhook subscription is registered.";

const FAILURE_MESSAGES: Record<ShopifyWebhookFailureCategory, string> = {
	configuration:
		"Festival's public webhook origin is not configured. Set an external HTTPS FESTIVAL_PUBLIC_ORIGIN and restart Festival.",
	missing_scope:
		"The installed Shopify app does not grant read_orders. Release the scope, approve it on this store, and run the check again.",
	permission:
		"Shopify denied webhook access. Confirm the released app version is installed and approved on this store.",
	protected_data:
		"Shopify protected customer data access is not configured for order webhooks. Complete the app's protected-data setup and retry.",
	callback:
		"Shopify rejected the paid-order callback. Confirm its public HTTPS URL, TLS certificate, and proxy route, then retry.",
	transport:
		"Festival could not reach Shopify while checking the paid-order webhook. Retry after checking network connectivity.",
	upstream:
		"Shopify could not complete the paid-order webhook check. Retry and use the request ID when contacting Shopify support.",
};

function boundedRequestId(value: string | undefined): string | undefined {
	return value && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
		? value
		: undefined;
}

export class ShopifyWebhookSubscriptionService {
	private readonly reconciliationLocks = new Map<string, Promise<void>>();
	private readonly ordersPaidCallbackUrl: string;

	constructor(
		private readonly repository: OrganizationRepository,
		private readonly secretKeyring: ShopifySecretKeyring,
		private readonly client: ShopifyWebhookSubscriptionClient,
		publicOrigin: string | undefined,
	) {
		this.ordersPaidCallbackUrl = callbackUrl(publicOrigin);
	}

	async reconcileForTenant(
		tenant: TenantContext,
	): Promise<ShopifyWebhookReadiness> {
		return this.withOrganizationLock(tenant.organization.id, async () =>
			this.reconcileUnlockedForTenant(tenant),
		);
	}

	private async reconcileUnlockedForTenant(
		tenant: TenantContext,
	): Promise<ShopifyWebhookReadiness> {
		const checkedAtIso = new Date().toISOString();
		await this.repository.updateShopifyWebhookReadiness({
			organizationId: tenant.organization.id,
			status: "checking",
			checkedAtIso,
		});
		try {
			const integration = await this.repository.getShopifyIntegration(
				tenant.organization.id,
			);
			this.assertVerified(integration);
			if (integration.capabilities.read_orders !== "granted") {
				return await this.recordFailure(
					tenant.organization.id,
					checkedAtIso,
					"missing_scope",
				);
			}
			const credentials: ShopifyCredentials = {
				organizationId: tenant.organization.id,
				storeDomain: integration.storeDomain,
				clientId: integration.clientId,
				clientSecret: this.secretKeyring.decrypt(
					integration.encryptedClientSecret,
					{
						organizationId: tenant.organization.id,
						purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
					},
				),
				integrationVersion: integration.integrationVersion,
			};
			const context: ShopifyAdminOperationContext = {
				organizationId: tenant.organization.id,
				firebaseActorUid: tenant.identity.uid,
				verifiedShopGid: integration.verifiedShopGid,
				verifiedShopDomain: integration.verifiedShopDomain,
				integrationVersion: integration.integrationVersion,
				grantedScopes: integration.grantedScopes,
				capability: "read_orders",
				credentials,
			};
			await this.client.reconcileOrdersPaidWebhook(
				context,
				this.ordersPaidCallbackUrl,
			);
			await this.repository.updateShopifyWebhookReadiness({
				organizationId: tenant.organization.id,
				status: "ready",
				checkedAtIso,
			});
			return { status: "ready", checkedAtIso, message: READY_MESSAGE };
		} catch (error) {
			const failure = this.classifyFailure(error);
			return await this.recordFailure(
				tenant.organization.id,
				checkedAtIso,
				failure.failureCategory,
				failure.requestId,
			);
		}
	}

	private classifyFailure(error: unknown): {
		failureCategory: ShopifyWebhookFailureCategory;
		requestId?: string;
	} {
		if (error instanceof ShopifyWebhookOperationError) {
			return {
				failureCategory: error.failureCategory,
				requestId: boundedRequestId(error.requestId),
			};
		}
		if (error instanceof AppError) {
			return {
				failureCategory: error.status === 409 ? "configuration" : "callback",
			};
		}
		return { failureCategory: "upstream" };
	}

	private async recordFailure(
		organizationId: string,
		checkedAtIso: string,
		failureCategory: ShopifyWebhookFailureCategory,
		requestId?: string,
	): Promise<ShopifyWebhookReadiness> {
		const message = FAILURE_MESSAGES[failureCategory];
		await this.repository.updateShopifyWebhookReadiness({
			organizationId,
			status: "failed",
			checkedAtIso,
			message,
			failureCategory,
			requestId,
		});
		return {
			status: "failed",
			checkedAtIso,
			message,
			failureCategory,
			...(requestId ? { requestId } : {}),
		};
	}

	private async withOrganizationLock<T>(
		organizationId: string,
		work: () => Promise<T>,
	): Promise<T> {
		const previous = this.reconciliationLocks.get(organizationId);
		let release: () => void = () => {};
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.reconciliationLocks.set(organizationId, current);
		try {
			await previous;
			return await work();
		} finally {
			release();
			if (this.reconciliationLocks.get(organizationId) === current) {
				this.reconciliationLocks.delete(organizationId);
			}
		}
	}

	private assertVerified(
		integration: ShopifyIntegrationRecord | null,
	): asserts integration is ShopifyIntegrationRecord & {
		verifiedShopGid: string;
		verifiedShopDomain: string;
	} {
		if (
			!integration ||
			integration.verificationStatus !== "ok" ||
			!integration.verifiedShopGid ||
			!integration.verifiedShopDomain
		) {
			throw new AppError("Shopify integration has not been verified.", 409);
		}
	}
}
