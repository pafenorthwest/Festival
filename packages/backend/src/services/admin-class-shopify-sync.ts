import { randomUUID } from "node:crypto";
import type { FestivalClassConfiguration } from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type {
	OrganizationRepository,
	ShopifyIntegrationRecord,
} from "../repo/organization-repository.js";
import type { ShopifyMutationAuditWriter } from "../shopify/admin-mutation-audit.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyMembershipProductClient,
} from "../shopify/types.js";
import { attemptAdminMutation } from "./admin-class-shopify-audit.js";

const mockGids = () => ({
	shopifyProductGid: `gid://shopify/Product/mock-${randomUUID()}`,
	shopifyVariantGid: `gid://shopify/ProductVariant/mock-${randomUUID()}`,
});

const isMock = (...gids: (string | undefined)[]) =>
	gids.some((g) => !g || g.includes("mock"));

function toAppError(error: unknown): AppError {
	if (error instanceof AppError) return error;
	const msg =
		error instanceof Error
			? error.message
			: "Shopify class product operation failed.";
	return new AppError(msg, 502);
}

function loadCredentials(
	keyring: ShopifySecretKeyring,
	orgId: string,
	int: ShopifyIntegrationRecord,
): ShopifyAdminOperationContext["credentials"] | null {
	try {
		return {
			organizationId: orgId,
			storeDomain: int.storeDomain,
			clientId: int.clientId,
			clientSecret: keyring.decrypt(int.encryptedClientSecret, {
				organizationId: orgId,
				purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			}),
			integrationVersion: int.integrationVersion,
		};
	} catch {
		return null;
	}
}

async function createAndPublishProduct(
	client: ShopifyMembershipProductClient,
	audit: ShopifyMutationAuditWriter | undefined,
	ctx: ShopifyAdminOperationContext,
	name: string,
	price: string,
	onCreated: (id: string) => void,
): Promise<{ shopifyProductGid: string; shopifyVariantGid: string }> {
	const prod = await attemptAdminMutation(audit, ctx, "productCreate", () =>
		client.createProduct(ctx, { name }),
	);
	onCreated(prod.id);
	const variant = prod.variants[0];
	if (!variant?.id) throw new AppError("Shopify product missing variant.", 502);
	const vInput = { productId: prod.id, variantId: variant.id, price };
	const priced = await attemptAdminMutation(
		audit,
		ctx,
		"productVariantUpdate",
		() => client.updateVariantPrice(ctx, vInput),
	);
	const invId = priced.variants[0]?.inventoryItemId ?? variant.inventoryItemId;
	if (invId) {
		await attemptAdminMutation(audit, ctx, "inventoryItemUpdate", () =>
			client.updateInventoryItem(ctx, {
				inventoryItemId: invId,
				requiresShipping: false,
			}),
		);
	}
	await attemptAdminMutation(audit, ctx, "productPublish", () =>
		client.publishProductToHeadlessStorefront(ctx, prod.id),
	);
	return { shopifyProductGid: prod.id, shopifyVariantGid: variant.id };
}

export class AdminClassShopifySync {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly secretKeyring?: ShopifySecretKeyring,
		private readonly shopifyClient?: ShopifyMembershipProductClient,
		private readonly mutationAudit?: ShopifyMutationAuditWriter,
	) {}

	async createClassProduct(
		orgId: string,
		festivalName: string,
		input: { displayName: string; price: string },
		actorUid?: string,
	): Promise<{ shopifyProductGid: string; shopifyVariantGid: string }> {
		const client = this.shopifyClient;
		if (!this.secretKeyring || !client) return mockGids();
		const ctx = await this.loadWriteContext(orgId, actorUid);
		if (!ctx) return mockGids();
		let productId: string | undefined;
		try {
			const name = festivalName
				? `${festivalName} - ${input.displayName}`
				: input.displayName;
			return await createAndPublishProduct(
				client,
				this.mutationAudit,
				ctx,
				name,
				input.price,
				(id) => (productId = id),
			);
		} catch (error) {
			if (productId) await this.tryCleanupProduct(ctx, productId);
			throw toAppError(error);
		}
	}

	async syncPrice(
		orgId: string,
		cfg: FestivalClassConfiguration,
		price: string,
		actorUid?: string,
	): Promise<void> {
		const client = this.shopifyClient;
		if (isMock(cfg.shopifyProductGid, cfg.shopifyVariantGid) || !client) return;
		const ctx = await this.loadWriteContext(orgId, actorUid);
		if (!ctx) return;
		const input = {
			productId: cfg.shopifyProductGid,
			variantId: cfg.shopifyVariantGid,
			price,
		};
		await attemptAdminMutation(
			this.mutationAudit,
			ctx,
			"productVariantUpdate",
			() => client.updateVariantPrice(ctx, input),
		);
	}

	async syncActiveStatus(
		orgId: string,
		cfg: FestivalClassConfiguration,
		isActive: boolean,
		actorUid?: string,
	): Promise<void> {
		const client = this.shopifyClient;
		if (isMock(cfg.shopifyProductGid) || !client) return;
		const ctx = await this.loadWriteContext(orgId, actorUid);
		if (!ctx) return;
		const status = isActive ? "ACTIVE" : "ARCHIVED";
		const input = { productId: cfg.shopifyProductGid, status };
		await attemptAdminMutation(this.mutationAudit, ctx, "productUpdate", () =>
			client.updateProductDetails(ctx, input),
		);
	}

	async tryCleanupProduct(
		ctx: ShopifyAdminOperationContext,
		productId: string,
	): Promise<void> {
		const client = this.shopifyClient;
		if (!client) return;
		try {
			await attemptAdminMutation(this.mutationAudit, ctx, "productDelete", () =>
				client.deleteProduct(ctx, productId),
			);
		} catch {}
	}

	private async loadWriteContext(
		orgId: string,
		actorUid?: string,
	): Promise<ShopifyAdminOperationContext | null> {
		if (!this.secretKeyring) return null;
		const int = await this.repository.getShopifyIntegration(orgId);
		const ok =
			int?.verifiedShopGid &&
			int.verifiedShopDomain &&
			int.verificationStatus === "ok";
		if (!ok) return null;
		const credentials = loadCredentials(this.secretKeyring, orgId, int);
		if (!credentials) return null;
		return {
			organizationId: orgId,
			firebaseActorUid: actorUid || "system:admin-class-shopify-sync",
			verifiedShopGid: int.verifiedShopGid,
			verifiedShopDomain: int.verifiedShopDomain,
			integrationVersion: int.integrationVersion,
			grantedScopes: [...int.grantedScopes],
			capability: "write_products",
			credentials,
		};
	}
}
