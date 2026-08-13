# Confidential Shopify Customer Account authentication

## Goal reference

- `goals/shopify-customer-account-auth/goals.v2.md` (locked)

## Scope

### In scope

- Separate tenant-scoped Customer Account Admin configuration and persistence.
- Dynamic Shopify OIDC/Customer Account discovery and confidential OAuth BFF flows.
- Encrypted durable customer tokens, opaque cookie sessions, single-process refresh serialization, CSRF/origin controls, and logout.
- Allowlisted minimal session/profile and cursor-paginated order DTOs with protected-data fail-closed behavior.
- Minimal Admin and customer SolidJS surfaces under `/org/:shortOrgName`.
- Focused automated coverage and `README.md`/`SETUP.md` operator documentation.

### Out of scope

- Existing Firebase Admin identity behavior and Shopify Admin API integration behavior except principal separation and the new distinct configuration card.
- Storefront cart/checkout, webhooks/reconciliation, financial mutations, registration/entitlement behavior, distributed session coordination, and rate limiting.
- Obtaining Shopify protected-customer-data approval or changing deployment/WAF/network infrastructure.

## Approach

- Reuse the existing tenant keyring, repository, route-security inventory, safe-error, API-helper, and Admin integration patterns.
- Keep Customer Account configuration, credentials, endpoints, tokens, and session records distinct from Admin API state.
- Deliver the BFF first, then the smallest UI needed to exercise configuration, sign-in/session, orders, and logout.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: separate tenant-scoped Customer Account configuration and PostgreSQL persistence; validated OIDC/API discovery; confidential authorization-code callback; signed ID-token validation; one-time state/nonce; encrypted token/session storage; opaque secure cookie; single-process serialized refresh; tenant/credential rotation invalidation; CSRF/origin-protected logout; allowlisted order DTO and protected-data denial; distinct Admin setup card; minimal customer account page; nginx routes; README/SETUP guidance; focused automated coverage.
- Exceptions: None from the locked goals. The intentional issue #76/#79 rate-limit deferral remains documented and is not claimed as delivered.
- Deferred work: evidence-based auth rate limits after benchmarking/load testing; multi-replica distributed refresh coordination; all issue #77/#78 cart, checkout, webhook, reconciliation, financial, and entitlement work.
- Dirty-worktree decision: continue — preflight found only the approved goal artifacts, generated task scaffold, and their manifest update; no unrelated user changes are present.

## Quality gate results

- Lint: passed — `bun run format:check` (106 files, no fixes required)
- Build: passed — `bun run build` (common/backend TypeScript and frontend Vite production build)
- Tests: passed — `bun run test` (21 common, 151 backend, 27 frontend; 199 total)
- Code review: passed — no findings, `patch is correct`, confidence 0.94
- Clean merge: pending
