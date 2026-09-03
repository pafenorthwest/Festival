# Establish Goals

## Status

- Task name: issue-112-webhook-registration-diagnosis
- Iteration: v0
- State: locked

## Request

- GitHub issue #112: `Diagnose app-created ORDERS_PAID webhook registration failures`.
- Objective: identify the exact stage and root cause of the development-store
  webhook registration failure without introducing a manually configured
  Shopify Admin webhook.
- Repository evidence at goal lock:
  - Save & Verify marks the store verified before reconciling the webhook, then
    one shared catch can rewrite the integration as failed.
  - A webhook failure is collapsed to `AppError`, which the integration service
    categorizes as `transport` regardless of the original failure.
  - The active workspace configures the Shopify secret keyring but omits
    `FESTIVAL_PUBLIC_ORIGIN`, so reconciliation fails during local callback URL
    configuration before listing or creating a Shopify subscription.
  - The configured development database is unavailable from this workspace, so
    no store credential, effective-scope, or live Shopify request evidence is
    currently available.
- Acceptance criteria:
  - The confirmed local failure stage fails fast with an actionable,
    non-secret configuration error instead of surfacing later as Shopify
    transport failure.
  - Focused tests prove no Shopify webhook request occurs when the public origin
    is absent and valid configuration retains the existing app-owned flow.
  - Setup documentation provides a short ordered checklist for app/store
    ownership, released/approved scopes, protected customer data, public HTTPS
    callback reachability, and app-owned reconciliation.
  - Investigation notes distinguish repository-confirmed findings from live
    Shopify checks that remain externally blocked.
  - Repository-pinned format, lint, build, and test commands pass.

## Blocking ambiguity

- None for the confirmed local configuration failure. Live verification against
  `test-pafe.myshopify.com` remains an explicit external gate until the running
  environment/database and Shopify configuration are accessible.

## Goals

1. Fail backend startup explicitly when Shopify services are enabled by a valid
   secret keyring but `FESTIVAL_PUBLIC_ORIGIN` is missing, because app-owned
   webhook reconciliation cannot construct its required callback in that state.
2. Add focused regression coverage proving the missing-origin failure occurs
   before Shopify access and a valid HTTPS public origin preserves Shopify
   service construction.
3. Document the ordered operator verification checklist and the evidence needed
   to classify token exchange, shop identity, effective scopes, subscription
   listing/creation, protected-data access, and callback reachability.
4. Record sanitized investigation findings and any live external blocker without
   exposing credentials, tokens, encrypted secrets, raw Shopify bodies, or PII;
   retain the bounded failure classification and Shopify request ID when the
   target environment makes them available.

## Non-goals

- The separate Save & Verify/webhook result contract, persistence model, and UI
  redesign owned by issue #113.
- Manually created Shopify Admin webhooks or copied store-level signing secrets.
- Scope expansion, payment, order-projection, entitlement, or customer UI
  changes.
- Claiming a live Shopify root cause or successful subscription without direct
  evidence from the target environment.

## Success criteria

- [G1] A keyring-enabled backend without `FESTIVAL_PUBLIC_ORIGIN` rejects startup
  with a bounded actionable error before any Shopify request can occur.
- [G2] Tests prove a valid HTTPS public origin continues to construct the
  existing Shopify services and the missing-origin regression cannot return as a
  generic Save & Verify transport failure.
- [G3] SETUP documents the ordered app/store ownership, version/scope approval,
  protected-data, callback, and app-owned reconciliation checks using no manual
  webhook workaround.
- [G4] Task evidence states the confirmed local stage and clearly records the
  external access needed to verify `test-pafe.myshopify.com`; a live run records
  the bounded failure classification and Shopify request ID when available, and
  pinned checks pass.

## Next action

- Implement only the locked v0 goals, then run focused and repository-pinned
  verification.
