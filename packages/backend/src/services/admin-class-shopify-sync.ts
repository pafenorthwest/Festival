import { randomUUID } from "node:crypto";
import {
	type FestivalClassConfiguration,
	normalizeEffectiveShopifyScopes,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type {
	OrganizationRepository,
	ShopifyIntegrationRecord,
} from "../repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";
import type { ShopifyProductLifecycleService } from "../shopify/shopify-product-lifecycle-service.js";
import type { ShopifyAdminOperationContext } from "../shopify/types.js";

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

export interface SyncNewClassProductInput {
	name?: string;
	displayName?: string;
	price: string;
	description?: string;
	festivalShortName?: string;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
}

export interface FestivalRef {
	name: string;
	shortName?: string;
}

export class AdminClassShopifySync {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly lifecycleService?: ShopifyProductLifecycleService,
		private readonly secretKeyring?: ShopifySecretKeyring,
		private readonly options?: { allowMockMode?: boolean },
	) {}

	async syncNewClassProduct(
		orgId: string,
		festival: FestivalRef,
		input: SyncNewClassProductInput,
		actorUid?: string,
	): Promise<{ shopifyProductGid: string; shopifyVariantGid: string }> {
		if (input.shopifyProductGid && input.shopifyVariantGid) {
			return {
				shopifyProductGid: input.shopifyProductGid,
				shopifyVariantGid: input.shopifyVariantGid,
			};
		}
		const int = await this.repository.getShopifyIntegration(orgId);
		let credentials: ShopifyAdminOperationContext["credentials"] | undefined;

		if (int) {
			if (
				int.verificationStatus !== "ok" ||
				!int.verifiedShopDomain ||
				!int.verifiedShopGid
			) {
				throw new AppError("Shopify integration has not been verified.", 409);
			}

			const scopes = new Set(
				normalizeEffectiveShopifyScopes(int.grantedScopes ?? []),
			);
			const requiredScopes = [
				"write_products",
				"write_inventory",
				"read_publications",
				"write_publications",
			];
			if (!requiredScopes.every((scope) => scopes.has(scope))) {
				throw new AppError(
					"Shopify integration lacks required permissions.",
					409,
				);
			}

			if (!this.secretKeyring) {
				throw new AppError("Shopify credentials could not be decrypted.", 500);
			}

			try {
				credentials = {
					organizationId: orgId,
					storeDomain: int.storeDomain,
					clientId: int.clientId,
					clientSecret: this.secretKeyring.decrypt(int.encryptedClientSecret, {
						organizationId: orgId,
						purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
					}),
					integrationVersion: int.integrationVersion,
				};
			} catch {
				throw new AppError("Shopify credentials could not be decrypted.", 500);
			}
		} else {
			if (this.options?.allowMockMode !== false) {
				return mockGids();
			}
			throw new AppError("Shopify integration is not configured.", 409);
		}

		if (!this.lifecycleService) {
			if (this.options?.allowMockMode !== false) {
				return mockGids();
			}
			throw new AppError(
				"Shopify product lifecycle service is unavailable.",
				500,
			);
		}

		const ctx: ShopifyAdminOperationContext = {
			organizationId: orgId,
			firebaseActorUid: actorUid || "system:admin-class-shopify-sync",
			verifiedShopGid: int.verifiedShopGid,
			verifiedShopDomain: int.verifiedShopDomain,
			integrationVersion: int.integrationVersion,
			grantedScopes: [...int.grantedScopes],
			capability: "write_products",
			credentials,
		};

		const className = input.displayName || input.name || "";
		const title = `${festival.name} - ${className}`;
		const description =
			input.description ||
			(input.festivalShortName
				? `${festival.name} class: ${className} (${input.festivalShortName})`
				: `${festival.name} class: ${className}`);

		try {
			const result = await this.lifecycleService.createAndPublishDigitalProduct(
				ctx,
				{
					name: title,
					description,
					price: input.price,
				},
			);

			return {
				shopifyProductGid: result.productGid,
				shopifyVariantGid: result.variantGid,
			};
		} catch (error) {
			throw toAppError(error);
		}
	}

	async createClassProduct(
		orgId: string,
		festivalName: string,
		input: {
			displayName: string;
			price: string;
			description?: string;
			festivalShortName?: string;
		},
		actorUid?: string,
	): Promise<{ shopifyProductGid: string; shopifyVariantGid: string }> {
		return this.syncNewClassProduct(
			orgId,
			{ name: festivalName },
			{
				name: input.displayName,
				price: input.price,
				description: input.description,
				festivalShortName: input.festivalShortName,
			},
			actorUid,
		);
	}

	async syncClassPriceUpdate(
		orgId: string,
		cfg: FestivalClassConfiguration,
		newPrice: string,
		actorUid?: string,
	): Promise<void> {
		if (isMock(cfg.shopifyProductGid, cfg.shopifyVariantGid)) return;
		if (!this.lifecycleService) return;
		const ctx = await this.loadWriteContext(orgId, actorUid);
		if (!ctx) return;
		await this.lifecycleService.updateVariantPrice(ctx, {
			productId: cfg.shopifyProductGid,
			variantId: cfg.shopifyVariantGid,
			price: newPrice,
		});
	}

	async syncPrice(
		orgId: string,
		cfg: FestivalClassConfiguration,
		price: string,
		actorUid?: string,
	): Promise<void> {
		return this.syncClassPriceUpdate(orgId, cfg, price, actorUid);
	}

	async syncClassStatus(
		orgId: string,
		cfg: FestivalClassConfiguration,
		isActive: boolean,
		actorUid?: string,
	): Promise<void> {
		if (isMock(cfg.shopifyProductGid)) return;
		if (!this.lifecycleService) return;
		const ctx = await this.loadWriteContext(orgId, actorUid);
		if (!ctx) return;
		await this.lifecycleService.updateProductStatus(ctx, {
			productId: cfg.shopifyProductGid,
			status: isActive ? "ACTIVE" : "ARCHIVED",
		});
	}

	async syncActiveStatus(
		orgId: string,
		cfg: FestivalClassConfiguration,
		isActive: boolean,
		actorUid?: string,
	): Promise<void> {
		return this.syncClassStatus(orgId, cfg, isActive, actorUid);
	}

	async tryCleanupProduct(
		ctx: ShopifyAdminOperationContext,
		productId: string,
	): Promise<void> {
		if (this.lifecycleService) {
			await this.lifecycleService.tryCleanupProduct(ctx, productId);
		}
	}

	async tryCleanupProductGid(
		orgId: string,
		productGid: string,
		actorUid?: string,
	): Promise<void> {
		if (isMock(productGid) || !this.lifecycleService) return;
		try {
			const ctx = await this.loadWriteContext(orgId, actorUid);
			if (ctx) {
				await this.lifecycleService.tryCleanupProduct(ctx, productGid);
			}
		} catch {}
	}

	private async loadWriteContext(
		orgId: string,
		actorUid?: string,
	): Promise<ShopifyAdminOperationContext | null> {
		if (!this.secretKeyring) return null;
		const int = await this.repository.getShopifyIntegration(orgId);
		if (
			!int ||
			int.verificationStatus !== "ok" ||
			!int.verifiedShopGid ||
			!int.verifiedShopDomain
		) {
			return null;
		}
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
