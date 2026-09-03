# Goals Extract

- Task name: issue-113-webhook-readiness-results
- Iteration: v0
- State: locked

## Goals

1. Add allowlisted shared webhook-readiness statuses and failure categories,
   including bounded optional request IDs and safe operator messages.
2. Persist webhook readiness independently from store verification, resetting it
   on integration changes and updating it on every reconciliation attempt.
3. Make webhook discovery/create/delete failures retain their safe stage,
   category, and Shopify request ID without exposing raw upstream errors.
4. Keep Save & Test store verification successful after webhook failure and
   return both settings and the current webhook result.
5. Run webhook and public Storefront diagnostics independently and return both
   completed typed checks even when either one fails.
6. Render store verification, capabilities, webhook readiness, and public
   Storefront diagnostics as separate Admin UI results with actionable safe
   messages.
7. Add focused common, backend, route, repository, and frontend coverage for all
   locked transitions, classifications, redaction boundaries, and quality gates.

## Non-goals

- Manual Shopify Admin webhooks or a generic webhook management UI.
- Changing Shopify credentials, required scopes, payment, order projection,
  entitlement, checkout, or public/customer behavior.
- Returning raw Shopify GraphQL errors, response bodies, credentials, tokens,
  internal tenant identifiers, full callback secrets, or customer data.
- Live Shopify environment remediation tracked by issue #112.

## Success criteria

- [G1] Shared contracts expose bounded independent store/webhook/storefront
  results and reject stale or unsafe readiness metadata.
- [G2] Persistence resets readiness on integration rotation and records
  checking/ready/failed with safe category, timestamp, and optional request ID.
- [G3] Save & Test retains `verificationStatus: ok`, verified identity, and
  capabilities when webhook reconciliation fails, while returning that failure
  separately.
- [G4] Diagnostics return both webhook and public Storefront checks when either
  one fails, and known failures remain HTTP 200 typed results.
- [G5] Automated coverage proves creation/exact-subscription success, missing
  scope, protected-data/user error, callback, upstream, timeout, persistence,
  redaction, and UI behavior; all pinned checks pass.
