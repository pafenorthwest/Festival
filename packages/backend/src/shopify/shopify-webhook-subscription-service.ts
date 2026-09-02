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
import type {
	ShopifyAdminOperationContext,
	ShopifyCredentials,
	ShopifyWebhookSubscriptionClient,
} from "./types.js";

export const SHOPIFY_ORDERS_PAID_WEBHOOK_PATH =
	"/api/shopify/webhooks/orders-paid";

function callbackUrl(publicOrigin: string): string {
	let origin: URL;
	try {
		origin = new URL(publicOrigin);
	} catch {
		throw new AppError("Festival public origin is invalid.", 503);
	}
	if (
		origin.protocol !== "https:" ||
		origin.username ||
		origin.password ||
		origin.port
	) {
		throw new AppError(
			"Festival public origin must be an external HTTPS origin.",
			503,
		);
	}
	return new URL(SHOPIFY_ORDERS_PAID_WEBHOOK_PATH, origin).toString();
}

export class ShopifyWebhookSubscriptionService {
	private readonly reconciliationLocks = new Map<string, Promise<void>>();

	constructor(
		private readonly repository: OrganizationRepository,
		private readonly secretKeyring: ShopifySecretKeyring,
		private readonly client: ShopifyWebhookSubscriptionClient,
		private readonly publicOrigin: string | undefined,
	) {}

	async reconcileForTenant(tenant: TenantContext): Promise<void> {
		return this.withOrganizationLock(tenant.organization.id, async () =>
			this.reconcileUnlockedForTenant(tenant),
		);
	}

	private async reconcileUnlockedForTenant(
		tenant: TenantContext,
	): Promise<void> {
		if (!this.publicOrigin) {
			throw new AppError("Festival public origin is not configured.", 503);
		}
		const integration = await this.repository.getShopifyIntegration(
			tenant.organization.id,
		);
		this.assertVerified(integration);
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
		try {
			await this.client.reconcileOrdersPaidWebhook(
				context,
				callbackUrl(this.publicOrigin),
			);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError(
				"Shopify paid-order webhook could not be registered. Check the Shopify integration permissions and try again.",
				502,
			);
		}
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
		if (integration.capabilities.read_orders !== "granted") {
			throw new AppError(
				"Shopify integration does not grant the required capability.",
				409,
			);
		}
	}
}
