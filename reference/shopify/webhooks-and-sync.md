# Webhooks and Synchronization

## Goal
Keep app state consistent with Shopify lifecycle changes (orders, refunds, customer changes).

## Shopify operations
- Register webhook subscriptions through Admin GraphQL.
- Subscribe to order/refund/customer topics required by reconciliation workflows.

## Notes
- Webhook handlers must be idempotent and signed-request verified.
- Store webhook event IDs and processing state in app persistence for replay safety.

## References
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/webhookSubscriptionCreate
- https://shopify.dev/docs/api/admin-graphql/latest/objects/WebhookSubscription
- https://shopify.dev/docs/api/admin-graphql/latest/queries/webhookSubscriptions
