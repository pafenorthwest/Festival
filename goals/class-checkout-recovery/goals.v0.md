# Class checkout recovery goals v0

- State: locked
- Approval: user selected option 2 and explicitly authorized its implementation on a new branch, prioritizing recorded recovery-required outcomes, released worker leases, preserved evidence, and deterministic behavior over perfect upstream results.
- Branch: `codex/class-checkout-recovery-plan`, based on `ericp/registration-flow-redesign`.
- Implementation plan: [plan](../../tasks/class-checkout-recovery/implementation-plan.md).

## Goals and success criteria

1. Maintain one Festival identity for an immutable checkout submission across recoverable failures. Verify same-payload replay and different-payload conflict, with owner and festival isolation.
2. Before returning recovery-required, atomically record its result and evidence and release the worker lease. Verify commit failure, response loss, replay, and lease-expiry behavior.
3. Resolve unknown Shopify outcomes deterministically through preserved late evidence and audited operator resolution. Verify no blind recreation, no expiry-as-cancellation assumption, and retained uncertainty/evidence on abandonment.
4. Serialize workers with short claims, bounded leases, and generation fencing. Verify concurrent requests, alternate keys/sessions, crashed workers, stale completions, and competing resolutions.
5. Resume known Shopify carts and retry URL reads safely under existing capacity rules. Verify no unnecessary recreation or local supersession after read failures.
6. Preserve frontend cart/key/recovery reference, provide safe status checking, and lock handoff through departure. Verify the actual registration hook and submitted-snapshot cleanup.
7. Keep Festival idempotency keys inside Festival and customer DTOs free of Shopify cart IDs/secrets. Verify adapters, routes, logs, and authorization boundaries.
8. Deliver schema/migration parity and proportional unit, route, frontend, and PostgreSQL concurrency tests, reporting all skipped or unavailable checks.

## Non-goals

- Distributed atomicity or exactly-once Shopify cart creation guarantees.
- New persistent frontend drafts, a separate frontend cart identity, or automatic unknown-outcome recreation.
- Changes to membership checkout behavior, payment policy, or capacity allocation policy unrelated to deterministic class recovery.
- Deployment, live Shopify mutations, production data access, or publishing without further user direction.
