# Establish Goals

## Status

- Task name: harden-customer-account-ssrf-throughput
- Iteration: v1
- State: locked

## Request

- Establish goals for closing the Shopify Customer Account BFF's DNS-rebinding and incomplete address-validation gaps while increasing customer session-creation throughput through bounded, security-aware in-memory caching and request coalescing. Align with `specs/tech-requirements.md`, `specs/ROADMAP-2026.md`, and locked Customer Account goals without weakening tenant isolation, endpoint discovery, TLS verification, token handling, or fail-closed behavior.

## Blocking ambiguity

- None. The user approved Customer Account-only scope, the proposed configurable cache defaults and fail-closed policy, and relative Festival-controlled performance acceptance using deterministic mocked Shopify responses.

## Assumptions

- This task hardens the existing single-backend Customer Account implementation; shared/distributed caches and multi-replica coordination remain out of scope.
- Scope is limited to Shopify Customer Account discovery, OIDC, token, JWKS, GraphQL, and logout traffic; the Shopify Admin API transport is unchanged.
- Configurable process-local defaults are 1,024 validated DNS host entries retained for at most 60 seconds and never beyond authoritative TTL, 1,024 tenant/integration-version discovery entries retained for 5 minutes, and 1,024 issuer/JWKS entries retained for 5 minutes, all with LRU eviction, a 256 KiB per-entry retained-payload ceiling, and a 16 MiB aggregate retained-payload ceiling; implementation/runtime overhead is measured separately in the benchmark.
- Every outbound connection is bound to an address from the exact validated DNS result used for that request while preserving the original hostname for HTTP `Host`, TLS SNI, and certificate verification.
- IPv4 and IPv6 validation rejects loopback, private, link-local, unique-local, unspecified, multicast, carrier-grade NAT, documentation/reserved, IPv4-mapped private, and cloud metadata destinations; mixed public/private answers fail closed.
- DNS and metadata caches are performance optimizations, never authority. Expiry, eviction, resolution failure, invalid metadata, integration version changes, issuer/key mismatch, and transport errors fail closed rather than using stale data.
- Cache keys include all security-relevant identity: normalized hostname and port policy for DNS; organization/integration version/storefront domain for discovery; issuer and JWKS URI for signing keys. Customer tokens, authorization codes, OAuth state/nonce, session cookies, customer/order responses, and unnecessary PII are never cached by this layer.
- Memory use is bounded, observable, and configurable; cache contents and metrics do not expose secrets, tokens, customer identifiers, raw URLs with query strings, or unnecessary tenant data.
- Same-key cold misses may be coalesced, but unrelated tenants, hostnames, issuers, sessions, and token refreshes are not globally serialized.
- The existing 500-request-per-second roadmap target remains a performance objective, not an authentication rate limit, and external Shopify capacity is not represented as Festival-controlled throughput.
- Performance acceptance uses deterministic mocked Shopify responses: cache hits perform zero additional DNS/discovery/JWKS fetches, unrelated keys are not globally serialized, and recorded warm-cache throughput and p95 latency must improve or remain no worse than the uncached Festival-controlled baseline; no absolute end-to-end Shopify login RPS is claimed.
- Repository verification remains `bun run format:check`, `bun run build`, and `bun run test` from the repository root.

## Goals

1. Replace check-then-resolve outbound behavior for Customer Account HTTP calls with a fail-closed transport contract that validates every resolved IPv4/IPv6 address and connects only to an address from that same validated result while retaining hostname-based TLS SNI, certificate verification, and HTTP authority.
2. Reject every non-global, ambiguous, malformed, credential-bearing, non-HTTPS, explicit-port, mixed-safety, redirected, or disallowed Shopify destination before request data is sent; prevent DNS rebinding, alternate address-family, IPv4-mapped IPv6, and connection-reuse bypasses across discovery, token, JWKS, GraphQL, and logout endpoint handling.
3. Add bounded process-local DNS caching that respects a conservative configurable ceiling and authoritative TTL when available, stores only fully validated address sets, coalesces concurrent same-host misses, expires associated connection leases with validation, and never serves stale entries after expiry or resolution/validation failure.
4. Add bounded tenant/integration-version discovery caching for validated OIDC and Customer Account API metadata, with deterministic invalidation on configuration or credential version changes and no caching of failed, partial, oversized, redirected, or schema-invalid responses.
5. Add bounded issuer/JWKS caching for verified Shopify signing-key sets, with issuer/JWKS binding, algorithm/key-use validation, expiry, same-key single-flight, and one forced refresh on an unknown key ID before failing closed; never allow cached keys to weaken issuer, audience, nonce, signature, or tenant/store validation.
6. Preserve shared connection pooling and keep-alive only within the validated DNS lease, avoid per-request client/pool construction, and ensure cache locking/coalescing is scoped by security key so concurrent tenants and sessions are not globally serialized.
7. Bound cache entry counts and retained byte sizes, use deterministic eviction, expose safe hit/miss/coalescing/eviction/expiry/error counters and current-entry gauges, and document configurable memory/TTL controls without logging cache keys or sensitive payloads.
8. Add deterministic security tests covering DNS answer changes between validation and connection, all rejected IPv4/IPv6 classes, mixed answers, rebinding, connection lease expiry, invalid/redirected endpoints, cache poisoning/isolation, stale-on-error denial, integration-version invalidation, JWKS rotation/unknown-key refresh, and absence of secrets or customer data from caches/metrics.
9. Add deterministic concurrency and performance tests proving warm requests avoid redundant DNS/discovery/JWKS work, same-key cold misses coalesce once, different security keys proceed independently, cache limits remain bounded under churn, and the hardened transport does not regress Festival-controlled session-creation throughput or p95 latency against the recorded uncached baseline.
10. Update `README.md`, `SETUP.md`, and task documentation with the outbound security model, cache boundaries/defaults/configuration, memory-versus-CPU tradeoff, single-process limitation, fail-closed behavior, safe observability, and reproducible benchmark procedure; pass the pinned repository formatting, build, and test commands.

## Non-goals

- Shopify Admin API transport changes.
- Redis, Memcached, shared/distributed caches, multi-replica cache coherence, or distributed token-refresh locking.
- Caching customer access/refresh/ID tokens beyond existing encrypted session persistence, authorization codes, OAuth state/nonce, session cookies, customer identity/profile/order data, raw GraphQL responses, or protected customer data.
- Weakening HTTPS, TLS certificate/hostname verification, endpoint allowlists, redirect denial, issuer/audience/nonce/signature validation, tenant binding, response-size/time limits, or safe error handling for performance.
- Treating cached DNS, discovery metadata, or JWKS as indefinitely trusted; stale-if-error or background-refresh behavior that permits expired security data to authorize a request.
- Auth rate limiting, WAF/edge changes, external DNS infrastructure, external service capacity guarantees, or claiming Shopify end-to-end throughput as a Festival benchmark result.
- Frontend product/UI changes beyond operator documentation of configuration and diagnostics.

## Success criteria

- [G1, G2] Tests with a controllable resolver and local target prove the connection uses only the validated address set and rejects rebinding, mixed public/private answers, every enumerated unsafe IPv4/IPv6 class, disallowed endpoint relationships, redirects, unsafe ports/credentials, and pooled connections whose validation lease expired before any sensitive request is sent.
- [G3] Cache tests prove DNS entries contain only validated bounded address data, obey configured entry/byte and TTL ceilings, respect lower authoritative TTLs, coalesce exactly one same-host cold lookup, never share unsafe/stale results, and re-resolve plus revalidate after expiry without blocking unrelated hosts.
- [G4] Tests prove valid discovery metadata is reused only for the same organization, integration version, and storefront domain; version/domain changes invalidate it immediately; failures and invalid metadata are not cached; cache churn cannot exceed configured bounds.
- [G5] Tests prove cached JWKS remain bound to the exact validated issuer/JWKS relationship, only approved signing keys are retained, unknown `kid` causes at most one coalesced forced refresh, rotation succeeds with a valid new key, and expired/invalid keys never authorize a token.
- [G6] Concurrency tests prove the implementation reuses safe pooled connections within their DNS lease, creates no client/pool per request, performs no global serialization, and allows different tenants/hosts/issuers/sessions to progress independently.
- [G7] Tests prove deterministic eviction and memory/entry bounds under adversarial cardinality; metrics distinguish hits, misses, coalesced waits, evictions, expirations, and safe failures without containing secrets, tokens, customer IDs, raw query strings, or unnecessary tenant identifiers.
- [G8] Security regression tests exercise every outbound Customer Account call class and prove cache poisoning, cross-tenant reuse, stale-on-error, address-family switching, DNS rebinding, and connection-reuse bypasses fail closed with generic browser errors and secret-free diagnostics.
- [G9] A reproducible benchmark records uncached and warm-cache Festival-controlled session-creation throughput, p50/p95 latency, outbound DNS/discovery/JWKS call counts, concurrency, CPU, and bounded memory; warm-cache execution makes zero redundant DNS/discovery/JWKS calls per valid cache key, shows no throughput or p95 regression, and clearly excludes external Shopify capacity from its claims.
- [G10] Documentation review proves `README.md` and `SETUP.md` describe the security/cache model, defaults and configuration, invalidation, memory-versus-CPU tradeoff, metrics, single-process limitation, fail-closed behavior, and benchmark commands; `bun run format:check`, `bun run build`, and `bun run test` pass.

## Next action

- Hand the locked v1 goals directly to implementation.
