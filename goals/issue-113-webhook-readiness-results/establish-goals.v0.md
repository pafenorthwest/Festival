# Establish Goals

## Status

- Task name: issue-113-webhook-readiness-results
- Iteration: v0
- State: locked

## Request

- GitHub issue #113: `Separate webhook reconciliation errors from Shopify store validation`.
- Objective: preserve successful Shopify store verification while reporting
  paid-order webhook readiness as a separate, typed, actionable result in Save &
  Test, diagnostics, persistence, and the Admin UI.
- Acceptance criteria:
  - Store verification, effective capabilities, paid-order webhook readiness,
    and public Storefront access are distinct typed results.
  - A webhook failure never rewrites a successfully verified store or clears its
    capabilities.
  - Save & Test and Run diagnostics both show webhook readiness separately.
  - Diagnostics complete independent checks even when one fails.
  - Safe messages distinguish configuration, missing scope, permission,
    protected-data, callback, upstream, and transport failures and retain only a
    bounded Shopify request ID when supplied.
  - Persisted readiness is reset on integration rotation, marked checking before
    an attempt, and replaced by the current ready/failed result so stale success
    is never presented as current.
  - Focused service, repository, contract, route, and frontend tests cover
    creation, an existing exact subscription, missing effective `read_orders`,
    protected-data/user errors, callback failure, upstream failure, timeout,
    redaction, and UI states.
  - Repository-pinned format, lint, build, and test commands pass.

## Blocking ambiguity

- None. Store verification remains the existing authority for credentials,
  identity, and capabilities. Webhook readiness is an independent persisted
  check result and does not gate unrelated verified capabilities.

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
   completed typed checks even when either check fails.
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

## Next action

- Implement only the locked v0 goals and task specification, then run the pinned
  verification commands.
