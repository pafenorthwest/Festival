import { randomUUID } from "node:crypto";
import type {
	PayerProfileInput,
	RefundRequest,
	StudentMetadata,
} from "@festival/common";

interface AdminClientConfig {
	shopDomain?: string;
	accessToken?: string;
}

export interface ShopifyOperationResult {
	id: string;
	providerMode: "live" | "mock";
}

export class ShopifyAdminClient {
	private readonly config: AdminClientConfig;

	constructor(config: AdminClientConfig) {
		this.config = config;
	}

	get mode(): "live" | "mock" {
		return this.config.shopDomain && this.config.accessToken ? "live" : "mock";
	}

	async upsertCustomer(
		input: PayerProfileInput,
	): Promise<ShopifyOperationResult> {
		if (this.mode === "mock") {
			return {
				id: `gid://shopify/Customer/mock-${randomUUID()}`,
				providerMode: "mock",
			};
		}

		const mutation = `
      mutation UpsertCustomer($input: CustomerSetInput!) {
        customerSet(input: $input) {
          customer {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

		const response = await this.graphqlRequest<{
			customerSet: {
				customer: { id: string } | null;
				userErrors: Array<{ message: string }>;
			};
		}>(mutation, {
			input: {
				email: input.email,
				firstName: input.firstName,
				lastName: input.lastName,
				tags: ["festival", input.role],
			},
		});

		const errors = response.customerSet.userErrors;
		if (errors.length > 0 || !response.customerSet.customer) {
			throw new Error(
				`Shopify customerSet failed: ${errors.map((error) => error.message).join("; ")}`,
			);
		}

		return {
			id: response.customerSet.customer.id,
			providerMode: "live",
		};
	}

	async storeStudentMetadata(
		ownerId: string,
		metadata: StudentMetadata,
	): Promise<ShopifyOperationResult> {
		if (this.mode === "mock") {
			return {
				id: `gid://shopify/Metafield/mock-${randomUUID()}`,
				providerMode: "mock",
			};
		}

		const mutation = `
      mutation SetStudentMetadata($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
          }
          userErrors {
            message
          }
        }
      }
    `;

		const response = await this.graphqlRequest<{
			metafieldsSet: {
				metafields: Array<{ id: string }>;
				userErrors: Array<{ message: string }>;
			};
		}>(mutation, {
			metafields: [
				{
					ownerId,
					namespace: "festival",
					key: "student_metadata",
					type: "json",
					value: JSON.stringify(metadata),
				},
			],
		});

		if (
			response.metafieldsSet.userErrors.length > 0 ||
			response.metafieldsSet.metafields.length === 0
		) {
			throw new Error(
				`Shopify metafieldsSet failed: ${response.metafieldsSet.userErrors
					.map((error) => error.message)
					.join("; ")}`,
			);
		}

		return {
			id: response.metafieldsSet.metafields[0].id,
			providerMode: "live",
		};
	}

	async createRefund(refund: RefundRequest): Promise<ShopifyOperationResult> {
		if (this.mode === "mock") {
			return {
				id: `gid://shopify/Refund/mock-${randomUUID()}`,
				providerMode: "mock",
			};
		}

		const mutation = `
      mutation RefundOrder($input: RefundInput!) {
        refundCreate(input: $input) {
          refund {
            id
          }
          userErrors {
            message
          }
        }
      }
    `;

		const response = await this.graphqlRequest<{
			refundCreate: {
				refund: { id: string } | null;
				userErrors: Array<{ message: string }>;
			};
		}>(mutation, {
			input: {
				orderId: refund.orderId,
				note: refund.reason,
				currency: "USD",
				shipping: { fullRefund: false },
				refundLineItems: [],
			},
		});

		if (
			response.refundCreate.userErrors.length > 0 ||
			!response.refundCreate.refund
		) {
			throw new Error(
				`Shopify refundCreate failed: ${response.refundCreate.userErrors.map((error) => error.message).join("; ")}`,
			);
		}

		return {
			id: response.refundCreate.refund.id,
			providerMode: "live",
		};
	}

	private async graphqlRequest<T>(
		query: string,
		variables: Record<string, unknown>,
	): Promise<T> {
		if (!this.config.shopDomain || !this.config.accessToken) {
			throw new Error("Shopify Admin API credentials are missing.");
		}

		const endpoint = `https://${this.config.shopDomain}/admin/api/2025-10/graphql.json`;
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Shopify-Access-Token": this.config.accessToken,
			},
			body: JSON.stringify({ query, variables }),
		});

		if (!response.ok) {
			throw new Error(
				`Shopify Admin API request failed with status ${response.status}`,
			);
		}

		const payload = (await response.json()) as {
			data?: T;
			errors?: Array<{ message: string }>;
		};

		if (payload.errors && payload.errors.length > 0) {
			throw new Error(
				`Shopify Admin API errors: ${payload.errors.map((error) => error.message).join("; ")}`,
			);
		}

		if (!payload.data) {
			throw new Error("Shopify Admin API returned empty data payload.");
		}

		return payload.data;
	}
}
