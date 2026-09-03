# Goals Extract

- Task name: issue-112-webhook-registration-diagnosis
- Iteration: v0
- State: locked

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
