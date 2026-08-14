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
  - Bounded LRU DNS, tenant/integration discovery, and issuer/JWKS caches with configured TTL/byte/entry bounds, same-key single-flight, fail-closed expiry/error behavior, immediate integration invalidation, unknown-key refresh, and safe aggregate metrics.
  - Deterministic adversarial, concurrency, invalidation, rotation, and cache-bound tests plus a mocked-Shopify session-creation benchmark.
  - README and SETUP documentation for the security model, defaults, controls, observability, single-process limitation, tradeoffs, and benchmark procedure.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue — preflight found only the approved v0/v1 goal artifacts, this task scaffold, and their manifest update on the task-specific `eric/SSRF-validation` branch.

## Quality gate results

- Lint: passed — `bun run format:check`
- Build: passed — `bun run build`
- Tests: passed — `bun run test` (209 tests: 21 common, 161 backend, 27 frontend)
- Performance: passed — `bun run benchmark:customer-account-cache`; latest warm run 2,289/s and 5.53 ms p95 versus uncached 2,182/s and 6.75 ms p95, with DNS/discovery/JWKS calls reduced from 20/20/10 to 1/0/1.
- Code review: passed — `code-review-validate.sh harden-customer-account-ssrf-throughput validate main` returned `READY`, verdict `patch is correct`, confidence 0.94.
- Clean merge: pending `land-the-plan` stage.
