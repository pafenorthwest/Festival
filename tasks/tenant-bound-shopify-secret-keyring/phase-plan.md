# Phase Plan
- Task name: tenant-bound-shopify-secret-keyring
- Complexity: scored:L4 (cross-system)
- Phase count: 9
- Active phases: 1..9
- Verdict: READY TO LAND

## Constraints
- During Stage 3, only planning artifacts under `tasks/tenant-bound-shopify-secret-keyring/` may change.
- During implementation, no new scope is allowed; scope, goal, verification, startup-contract, or issue-ownership drift is `BLOCKED` pending explicit relock.
- Preserve the approved absent-keyring behavior and key-ID regex exactly.
- Do not implement legacy compatibility, migration, re-encryption, key retirement, #75 credential/cache behavior, database schema changes, external key services, or general encryption APIs.
- Progress budget per stage: 45 minutes, at most 5 attempt cycles, and at most 2 consecutive no-evidence cycles.

## Phase sequence and locked-goal traceability

1. Keyring configuration contract and validation — G1, G2, G9, G12.
2. Versioned envelope model and strict parser — G3, G7, G12.
3. Tenant/purpose-bound active-key encryption — G3, G4, G5, G10, G12.
4. Retained-key decryption and tamper rejection — G5, G6, G7, G10, G12.
5. Shopify integration and product-service context binding — G8, G10, G12.
6. Application composition and optional Shopify startup behavior — G1, G2, G9, G10, G12.
7. Adversarial failure and redaction coverage — G2, G5, G7, G10, G12.
8. Documentation alignment and full regression preparation — G11, G12, G13.
9. Acceptance audit and canonical verification — G1–G13.

## Complexity scoring details
- score=16; recommended-goals=11; guardrails-all-true=false; signals=/Users/eric/pafenorthwest/Festival/tasks/tenant-bound-shopify-secret-keyring/complexity-signals.json
- Ranges: goals=8-13; phases=6-9
- Locked goals remain 13; the scorer enforces the phase minimum but does not rewrite already locked goals.

## Execution order

- Phases are sequential; each focused gate passes before the next phase begins.
- Root `format:check`, `build`, and `test` run in Phase 9 and final closeout.
- Any need for schema migration, legacy reads, re-encryption, #75 cache invalidation, or external key storage is drift and stops implementation.
