# #78 Deferred Follow-up

## Bounded reconciliation pagination

The #78 reconciliation reader intentionally fails closed when the bounded Shopify
paid-order result exceeds its supported window. It records a failed reconciliation
run and the scheduler command exits non-zero, so deployment monitoring can retry
or investigate rather than incorrectly reporting a partial scan as complete.

Cursor-paginated reconciliation for high-volume tenants is deferred to a separate
issue. It requires a durable per-tenant cursor/watermark and an operator recovery
contract; neither is required to safely finish the locked #78 paid-order
projection and entitlement flow.
