import { ShopifyWebhookOperationError } from "./shopify-errors.js";
import {
	type ShopifyUserErrorPayload,
	throwIfWebhookUserErrors,
	webhookOperationError,
} from "./shopify-graphql-mappers.js";
import type { ShopifyGraphqlTransport } from "./shopify-graphql-transport.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyWebhookSubscriptionClient,
} from "./shopify-types.js";

interface WebhookSubscriptionNode {
	id?: string;
	topic?: string;
	uri?: string;
}

const LIST_WEBHOOKS_QUERY = `query ListOrdersPaidWebhookSubscriptions {
	webhookSubscriptions(first: 250) {
		nodes { id topic uri }
	}
}`;

const CREATE_WEBHOOK_MUTATION = `mutation CreateOrdersPaidWebhook($uri: String!) {
	webhookSubscriptionCreate(topic: ORDERS_PAID, webhookSubscription: { uri: $uri }) {
		webhookSubscription { id topic uri }
		userErrors { field message }
	}
}`;

const DELETE_WEBHOOK_MUTATION = `mutation DeleteOrdersPaidWebhook($id: ID!) {
	webhookSubscriptionDelete(id: $id) {
		deletedWebhookSubscriptionId
		userErrors { field message }
	}
}`;

export class ShopifyWebhooksAdminClient
	implements ShopifyWebhookSubscriptionClient
{
	constructor(private readonly transport: ShopifyGraphqlTransport) {}

	async reconcileOrdersPaidWebhook(
		context: ShopifyAdminOperationContext,
		callbackUrl: string,
	): Promise<ShopifyAdminResult<void>> {
		try {
			this.transport.assertOperationContext(context, "read_orders");
		} catch (error) {
			throw webhookOperationError(error, "access_token");
		}
		if (
			!/^https:\/\/[^/?#]+\/api\/shopify\/webhooks\/orders-paid$/.test(
				callbackUrl,
			)
		) {
			throw new ShopifyWebhookOperationError("subscription_create", "callback");
		}
		const accessToken = await this.fetchOrdersAccessToken(context);
		const subscriptions = await this.listOrdersPaidSubscriptions(
			context.credentials.storeDomain,
			accessToken,
		);
		const matching = subscriptions.nodes.filter(
			(subscription) => subscription.topic === "ORDERS_PAID" && subscription.id,
		);
		const exact = matching.filter(
			(subscription) => subscription.uri === callbackUrl,
		);
		let keep = exact.shift();
		let requestId = subscriptions.requestId;
		if (!keep) {
			const created = await this.createOrdersPaidSubscription(
				context.credentials.storeDomain,
				accessToken,
				callbackUrl,
			);
			keep = created.subscription;
			requestId = created.requestId ?? requestId;
		}
		for (const subscription of matching) {
			if (!subscription.id || subscription.id === keep.id) continue;
			const deletedRequestId = await this.deleteWebhookSubscription(
				context.credentials.storeDomain,
				accessToken,
				subscription.id,
			);
			requestId = deletedRequestId ?? requestId;
		}
		return { value: undefined, requestId };
	}

	private async fetchOrdersAccessToken(
		context: ShopifyAdminOperationContext,
	): Promise<string> {
		try {
			const token = await this.transport.fetchOperationAccessToken(
				context,
				"read_orders",
			);
			return token.accessToken;
		} catch (error) {
			throw webhookOperationError(error, "access_token");
		}
	}

	private async listOrdersPaidSubscriptions(
		storeDomain: string,
		accessToken: string,
	): Promise<{ nodes: WebhookSubscriptionNode[]; requestId?: string }> {
		const subscriptions = await this.transport.webhookGraphqlRequest<{
			webhookSubscriptions?: { nodes?: WebhookSubscriptionNode[] };
		}>(storeDomain, accessToken, LIST_WEBHOOKS_QUERY, {}, "subscription_list");
		return {
			nodes: subscriptions.value.webhookSubscriptions?.nodes ?? [],
			requestId: subscriptions.requestId,
		};
	}

	private async createOrdersPaidSubscription(
		storeDomain: string,
		accessToken: string,
		callbackUrl: string,
	): Promise<{ subscription: WebhookSubscriptionNode; requestId?: string }> {
		const created = await this.transport.webhookGraphqlRequest<{
			webhookSubscriptionCreate?: {
				webhookSubscription?: WebhookSubscriptionNode;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(
			storeDomain,
			accessToken,
			CREATE_WEBHOOK_MUTATION,
			{ uri: callbackUrl },
			"subscription_create",
		);
		const payload = created.value.webhookSubscriptionCreate;
		throwIfWebhookUserErrors(
			payload?.userErrors,
			"subscription_create",
			created.requestId,
		);
		const subscription = payload?.webhookSubscription;
		if (
			!subscription?.id ||
			subscription.topic !== "ORDERS_PAID" ||
			subscription.uri !== callbackUrl
		) {
			throw new ShopifyWebhookOperationError(
				"subscription_create",
				"upstream",
				created.requestId,
			);
		}
		return { subscription, requestId: created.requestId };
	}

	private async deleteWebhookSubscription(
		storeDomain: string,
		accessToken: string,
		subscriptionId: string,
	): Promise<string | undefined> {
		const deleted = await this.transport.webhookGraphqlRequest<{
			webhookSubscriptionDelete?: {
				deletedWebhookSubscriptionId?: string;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(
			storeDomain,
			accessToken,
			DELETE_WEBHOOK_MUTATION,
			{ id: subscriptionId },
			"subscription_delete",
		);
		throwIfWebhookUserErrors(
			deleted.value.webhookSubscriptionDelete?.userErrors,
			"subscription_delete",
			deleted.requestId,
		);
		if (
			deleted.value.webhookSubscriptionDelete?.deletedWebhookSubscriptionId !==
			subscriptionId
		) {
			throw new ShopifyWebhookOperationError(
				"subscription_delete",
				"upstream",
				deleted.requestId,
			);
		}
		return deleted.requestId;
	}
}
