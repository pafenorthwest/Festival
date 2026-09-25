import type { ShopifyFailureCategory } from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type {
	ShopifyMutationAuditAttemptInput,
	ShopifyMutationAuditOperation,
	ShopifyMutationAuditWriter,
} from "./admin-mutation-audit.js";
import { ShopifyIntegrationError } from "./errors.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyProductClient,
} from "./types.js";

export interface DigitalProductCreationInput {
	name: string;
	description?: string;
	price: string;
}

export interface DigitalProductCreationResult {
	productGid: string;
	variantGid: string;
}

export class ShopifyProductLifecycleService {
	constructor(
		private readonly shopifyClient: ShopifyProductClient,
		private readonly mutationAudit: ShopifyMutationAuditWriter,
	) {}

	async createAndPublishDigitalProduct(
		context: ShopifyAdminOperationContext,
		input: DigitalProductCreationInput,
	): Promise<DigitalProductCreationResult> {
		const created = await this.attemptMutation(context, "productCreate", () =>
			this.shopifyClient.createProduct(context, {
				name: input.name,
				description: input.description,
			}),
		);

		try {
			const variant = created.variants[0];
			if (!variant?.id || created.variants.length !== 1) {
				throw new AppError(
					"Shopify product response did not include exactly one variant.",
					502,
				);
			}

			await this.updateVariantPrice(context, {
				productId: created.id,
				variantId: variant.id,
				price: input.price,
			});

			if (!variant.inventoryItemId) {
				throw new AppError(
					"Shopify product variant did not include an inventory item ID.",
					502,
				);
			}

			await this.attemptMutation(context, "inventoryItemUpdate", () =>
				this.shopifyClient.updateInventoryItem(context, {
					inventoryItemId: variant.inventoryItemId as string,
					requiresShipping: false,
				}),
			);

			await this.publishProduct(context, created.id);

			return {
				productGid: created.id,
				variantGid: variant.id,
			};
		} catch (error) {
			await this.tryCleanupProduct(context, created.id);
			throw error;
		}
	}

	async updateVariantPrice(
		context: ShopifyAdminOperationContext,
		input: { productId: string; variantId: string; price: string },
	): Promise<void> {
		await this.attemptMutation(context, "productVariantUpdate", () =>
			this.shopifyClient.updateVariantPrice(context, input),
		);
	}

	async updateProductStatus(
		context: ShopifyAdminOperationContext,
		input: { productId: string; status: "ACTIVE" | "ARCHIVED" },
	): Promise<void> {
		await this.attemptMutation(context, "productUpdate", () =>
			this.shopifyClient.updateProductDetails(context, input),
		);
	}

	async updateProductDetails(
		context: ShopifyAdminOperationContext,
		input: {
			productId: string;
			name?: string;
			description?: string;
			status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
		},
	): Promise<void> {
		await this.attemptMutation(context, "productUpdate", () =>
			this.shopifyClient.updateProductDetails(context, input),
		);
	}

	async publishProduct(
		context: ShopifyAdminOperationContext,
		productId: string,
	): Promise<void> {
		await this.attemptMutation(context, "productPublish", () =>
			this.shopifyClient.publishProductToHeadlessStorefront(context, productId),
		);
	}

	async deleteProduct(
		context: ShopifyAdminOperationContext,
		productId: string,
	): Promise<void> {
		await this.attemptMutation(context, "productDelete", () =>
			this.shopifyClient.deleteProduct(context, productId),
		);
	}

	async tryCleanupProduct(
		context: ShopifyAdminOperationContext,
		productId: string,
		onError?: (error: unknown) => void,
	): Promise<void> {
		try {
			await this.deleteProduct(context, productId);
		} catch (error) {
			onError?.(error);
			// Best-effort cleanup
		}
	}

	private async attemptMutation<T>(
		context: ShopifyAdminOperationContext,
		operation: ShopifyMutationAuditOperation,
		attempt: () => Promise<ShopifyAdminResult<T>>,
	): Promise<T> {
		const auditAttempt: ShopifyMutationAuditAttemptInput = {
			timestampIso: new Date().toISOString(),
			firebaseActorUid: context.firebaseActorUid,
			organizationId: context.organizationId,
			operation,
		};
		await this.mutationAudit.ensureReady(auditAttempt);
		let response: ShopifyAdminResult<T>;
		try {
			response = await attempt();
		} catch (error) {
			const requestId =
				error instanceof ShopifyIntegrationError ? error.requestId : undefined;
			await this.mutationAudit.append({
				...auditAttempt,
				requestId,
				result: "failure",
				failureCategory: this.failureCategory(error),
			});
			throw error;
		}
		await this.mutationAudit.append({
			...auditAttempt,
			requestId: response.requestId,
			result: "success",
		});
		return response.value;
	}

	private failureCategory(error: unknown): ShopifyFailureCategory {
		return error instanceof ShopifyIntegrationError
			? error.failureCategory
			: "transport";
	}
}
