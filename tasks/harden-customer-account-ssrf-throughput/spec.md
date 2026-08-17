# Harden Customer Account SSRF and cache throughput

## Goal reference

- `goals/harden-customer-account-ssrf-throughput/goals.v1.md` (locked)

## Scope

### In scope

- Customer Account-only outbound DNS pinning, complete public-address validation, and connection lease enforcement.
- Bounded process-local DNS, discovery, and JWKS caches with LRU eviction, same-key single-flight, safe metrics, and locked defaults.
- Deterministic security/concurrency tests and mocked-Shopify relative performance evidence.
- README/SETUP operator documentation and configuration.

### Out of scope

- Shopify Admin API transport changes, frontend behavior, external/shared caches, multi-replica coordination, rate limiting, and external Shopify throughput guarantees.
- Caching OAuth/session/customer/order data or weakening existing authentication and tenant controls.

## Approach

- Introduce a Customer Account-specific bounded cache and pinned transport abstraction, then route discovery/JWKS/API traffic through it without altering the Admin transport.
- Cache only validated DNS, discovery, and signing-key material; bind entries to security-relevant identity and fail closed on expiry or invalidation.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered:
  - Customer Account-only HTTPS transport with complete resolved-address validation, DNS-to-connection pinning, hostname TLS verification/authority, redirect denial, response bounds, and connection pools scoped to DNS leases.
  - Shopify discovery compatibility fix: allow the exact `shopify.com` root used by current Customer Account authentication and GraphQL endpoints while retaining boundary-safe rejection of suffix lookalikes.
  - Review fix: DNS lease retirement now removes expired pools from new use immediately while deferring `Agent.destroy()` until every already-started response has finished consuming its body; explicit lifecycle state, fail-fast balance checks, and detailed concurrency comments document the invariant.
  - Bounded LRU DNS, tenant/integration discovery, and issuer/JWKS caches with configured TTL/byte/entry bounds, same-key single-flight, fail-closed expiry/error behavior, immediate integration invalidation, unknown-key refresh, and safe aggregate metrics.
  - Deterministic adversarial, concurrency, invalidation, rotation, and cache-bound tests plus a mocked-Shopify session-creation benchmark.
  - README and SETUP documentation for the security model, defaults, controls, observability, single-process limitation, tradeoffs, and benchmark procedure.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue — the compatibility-fix preflight found a clean worktree on the task-specific branch.

## Quality gate results

- Lint: passed — `bun run format:check`
- Build: passed — `bun run build`
- Tests: passed — `bun run test` (233 tests: 24 common, 177 backend, 32 frontend), including exact Shopify root-host acceptance, suffix-lookalike rejection, and concurrent response streaming across metrics-triggered DNS expiry.
- Performance: passed — `bun run benchmark:customer-account-cache`; latest warm run 1,554/s and 8.86 ms p95 versus uncached 828/s and 34.06 ms p95, with DNS/discovery/JWKS calls reduced from 20/20/10 to 1/0/1.
- Code review: pending rerun after resolving the recorded DNS lease lifecycle finding.
- Clean merge: pending `land-the-plan` stage.
