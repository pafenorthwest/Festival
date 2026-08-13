# Tenant-Bound Shopify Secret Keyring

## Overview

Implement GitHub issue #83 by replacing the legacy single-key Shopify client-secret encryptor with a configured Festival-wide AES-256-GCM keyring. Every new ciphertext envelope is versioned and authenticated to the owning Festival organization and the fixed `shopify-client-secret` purpose. The active key encrypts new values; retained configured keys decrypt older envelopes.

When both keyring environment variables are absent, the backend may start with Shopify services disabled. Any partial or invalid keyring configuration fails startup. This task supplies the encryption boundary consumed by #75 but does not implement Shopify credential rotation or token-cache invalidation.

## Goals

1. Load and strictly validate a Festival-wide AES-256-GCM keyring from `FESTIVAL_SECRET_KEYS_JSON` and `FESTIVAL_ACTIVE_SECRET_KEY_ID`.
2. Permit backend startup with Shopify disabled only when both variables are absent; fail startup for partial or invalid configuration.
3. Replace legacy `v1` encryption with one strictly parsed, bounded, versioned envelope containing key ID, organization ID, fixed purpose, IV, authentication tag, and ciphertext.
4. Authenticate canonical version/organization/purpose context with AES-GCM additional authenticated data.
5. Encrypt new/updated Shopify secrets with the active key and decrypt by embedded key ID using any retained configured key.
6. Reject cross-organization/purpose use, missing keys, malformed encoding, invalid lengths, unsupported versions, and tampering explicitly and safely.
7. Pass resolved organization identity and fixed purpose through Shopify integration and membership-product call sites.
8. Remove Shopify runtime dependence on `AES_ENCRYPTION_KEY` without adding legacy compatibility or migration.
9. Prevent plaintext, envelopes, IVs, tags, encoded/decoded keys, and raw keyring configuration from responses, public errors, and captured logs.
10. Document safe local key generation, multi-key configuration, active-key switching, retained-key reads, and issue boundaries.
11. Add deterministic configuration, cryptographic, call-site binding, failure, and redaction tests and pass canonical verification.

## Non-goals

- Legacy `v1` ciphertext decryption or compatibility.
- Database migration, backfill, or preserving local development integration rows.
- Stored-record re-encryption, batch/automatic re-encryption, or re-encryption tooling.
- Previous-key deletion/retirement or determining retirement safety.
- Shopify credential/shop rotation, verification changes, or access-token cache invalidation (#75).
- Per-tenant/per-client keys or encryption of non-Shopify data.
- Browser-facing/general-purpose encryption APIs.
- External KMS/HSM/vault services, new cryptography packages, or PostgreSQL key storage.

## Use cases / user stories

- As an operator without Shopify configured, I can run the backend with both keyring variables absent and Shopify routes fail closed as unavailable.
- As an operator configuring Shopify, I receive an immediate startup failure for a partial, malformed, empty, or internally inconsistent keyring.
- As a Festival tenant, my stored Shopify client-secret ciphertext cannot be copied to another organization and decrypted there.
- As an operator switching active keys, new secrets use the new key while ciphertext created with a retained previous key remains readable.
- As an operator/developer, cryptographic material never appears in errors, API responses, or logs.

## Current behavior

- Notes:
  - `packages/backend/src/shopify/encryption.ts` accepts one Base64 `AES_ENCRYPTION_KEY`, emits a colon-delimited legacy `v1` envelope, and authenticates ciphertext but no tenant/purpose context.
  - `AppEnv` reads optional `AES_ENCRYPTION_KEY`; `createApp` constructs one `AesSecretEncryptor` and disables Shopify services when it is absent.
  - Integration save encrypts without organization context, and keep-existing-secret decrypts without verifying tenant/purpose ownership.
  - Membership-product credential loading decrypts a repository value without authenticated organization context.
  - Tests cover only a basic round trip and service behavior, not keyring validation, key switching, tenant binding, strict envelope parsing, or cryptographic redaction.
  - `README.md` and `SETUP.md` document the single legacy variable.
- Key files:
  - `packages/backend/src/shopify/encryption.ts`
  - `packages/backend/src/config/env.ts`
  - `packages/backend/src/app.ts`
  - `packages/backend/src/shopify/shopify-integration-service.ts`
  - `packages/backend/src/shopify/shopify-membership-product-service.ts`
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/tests/shopify-integration-service.test.ts`
  - `packages/backend/tests/shopify-membership-product-service.test.ts`
  - `packages/backend/tests/organization-routes.test.ts`
  - `README.md`
  - `SETUP.md`
  - `specs/tech-requirements.md`

## Proposed behavior

- Behavior changes:
  - Parse `FESTIVAL_SECRET_KEYS_JSON` as a non-empty object of approved key IDs to canonical Base64-encoded 32-byte AES keys.
  - Validate `FESTIVAL_ACTIVE_SECRET_KEY_ID` against the configured map before Shopify services are constructed.
  - Both variables absent produces no keyring and leaves Shopify services disabled; exactly one present or any invalid value aborts startup explicitly.
  - Encrypt using only the active key and a new envelope/AAD contract bound to the resolved organization and fixed purpose.
  - Decrypt only with the embedded configured key ID and caller-provided expected context.
  - Retained previous keys remain read-capable after active-key switching; removed/missing key IDs fail explicitly.
  - Service call sites always use the repository/tenant organization ID, never browser-provided context.
- Edge cases:
  - Reject arrays, primitives, empty objects, inherited/prototype-sensitive shapes, non-string values, and unknown active IDs.
  - Key IDs must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
  - Reject whitespace-tolerant or otherwise non-canonical Base64 even if a runtime decoder could produce 32 bytes.
  - Reject oversized, unsupported-version, truncated, missing/extra-field, invalid-Base64, wrong-length IV/tag, wrong-tenant/purpose, and tampered envelopes.
  - Fixed purpose is an application constant/type, not browser-controlled input or a general secret-purpose namespace.
  - No fallback attempts legacy `v1` parsing.

## Technical design

### Architecture / modules impacted

- Environment parsing returns either no Shopify keyring configuration (both variables absent) or one fully validated configuration; partial/invalid states throw before runtime service construction.
- A dedicated Shopify secret-keyring abstraction owns key validation, new envelope serialization/parsing, AES-256-GCM encryption/decryption, active-key selection, and retained-key lookup.
- Canonical AAD includes the envelope format version, exact Festival organization ID, and fixed purpose using an unambiguous representation.
- Integration and product services depend on the keyring abstraction and provide organization context at every encrypt/decrypt call.
- Runtime composition constructs one immutable keyring and shares it across Shopify services.
- Tests inject deterministic key material but retain random production IV generation; no new external dependency is needed because Node crypto is already used.

### API changes (if any)

- No browser API request/response fields are added.
- Internal encryption methods change from `encrypt(plaintext)` / `decrypt(ciphertext)` to tenant-bound operations requiring the expected organization and fixed Shopify purpose.
- Existing public Shopify configuration responses remain secret-free.

### UI/UX changes (if any)

None. Existing Shopify forms/routes show their current unavailable/error behavior when Shopify keyring configuration is absent or invalid.

### Data model / schema changes (PostgreSQL)

- Migrations: none. The encrypted client-secret column remains opaque text.
- Backward compatibility: none for legacy `v1`; the local development database is wiped before using the new format.
- Rollback: application rollback requires a compatible database reset/re-entry of Shopify credentials; do not attempt mixed-format reads.

## Security & privacy

- One Festival-wide key may encrypt multiple tenants because AES-GCM AAD authenticates the exact organization and fixed purpose.
- Embedded organization/purpose fields are not trusted by themselves; callers supply expected context, which must match and authenticate.
- Keys decode to exactly 32 bytes; IVs are random 12-byte values; tags are exactly 16 bytes.
- Key IDs select key material but do not provide tenant isolation.
- Plaintext, serialized envelope, IV, tag, encoded/decoded keys, and raw configuration JSON are prohibited from public errors, responses, and logs.
- Error messages use bounded classifications and never echo input cryptographic material.
- Key maps are immutable after startup; active-key changes occur by configuration and process restart.

## Observability (logs/metrics)

- Configuration/encryption/decryption failures are explicit but contain only bounded safe categories.
- No cryptographic input/output or keyring configuration is logged.
- No new metrics, audit table, or routine logging is introduced.

## Verification Commands

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy

- Unit:
  - Keyring configuration absent/partial/valid and every named invalid form.
  - Approved/rejected key IDs and canonical Base64 32-byte validation.
  - Active-key round trip and envelope structural/length validation.
  - Active-key switch for new writes and retained previous-key reads.
  - Wrong tenant/purpose, unavailable key, tampered AAD/ciphertext/tag, malformed/truncated/oversized/non-canonical envelope rejection.
  - Seeded-value absence from caught errors and captured logs.
- Integration:
  - Integration save/retain-secret uses exact tenant organization context.
  - Membership-product credential loading uses the record/request organization and rejects substituted cross-tenant ciphertext.
  - Application composition allows both variables absent, rejects partial/invalid configuration, and enables Shopify services only with a valid keyring.
- E2E / UI (if applicable): none; existing route tests verify safe unavailable/error behavior without live Shopify or database dependencies.

## Acceptance criteria checklist

- [ ] Both keyring variables absent allows backend startup with Shopify services disabled.
- [ ] Partial or invalid keyring configuration fails startup explicitly; valid multi-key configuration selects exactly one active key.
- [ ] Key IDs match the approved regex and every key is canonical Base64 decoding to exactly 32 bytes.
- [ ] Every new Shopify client secret uses the new bounded versioned envelope and active key.
- [ ] Encryption/decryption authenticates version, exact organization ID, and fixed `shopify-client-secret` purpose.
- [ ] Cross-tenant/purpose copying and all malformed/tampered inputs fail explicitly and safely.
- [ ] Retained previous keys decrypt prior envelopes after active-key switching; missing referenced keys fail.
- [ ] Integration/product call sites pass resolved server-side organization context.
- [ ] No legacy `v1` read path, migration, re-encryption, key retirement, #75 rotation/cache work, or general encryption surface is added.
- [ ] No prohibited cryptographic material appears in responses, public errors, or captured logs.
- [ ] Configuration documentation uses placeholders and accurately explains active/previous-key semantics and non-goals.
- [ ] Issue-specific tests and `bun run format:check`, `bun run build`, and `bun run test` pass.

## IN SCOPE

- Shopify secret keyring and tenant-bound encryption contracts under `packages/backend/src/shopify/`.
- Backend environment parsing and application composition for the two new keyring variables.
- Existing Shopify integration and membership-product service call-site changes needed to pass organization/purpose context.
- Directly affected backend route/composition tests for disabled/invalid/valid keyring states.
- Focused encryption, integration-service, membership-product-service, and redaction tests.
- Directly affected `README.md`, `SETUP.md`, and `specs/tech-requirements.md` configuration documentation.
- Lifecycle artifacts under `goals/tenant-bound-shopify-secret-keyring/` and `tasks/tenant-bound-shopify-secret-keyring/`.

## OUT OF SCOPE

- PostgreSQL schema/data migration, backfill, or legacy ciphertext compatibility.
- Stored-record re-encryption, key deletion/retirement, or retirement-safety tooling.
- Shopify credential/shop rotation, verification enhancements, Admin-token cache invalidation, capability/scope changes, mutation auditing, or Admin UI changes owned by #75.
- Customer authentication, cart/checkout, webhook/order/entitlement/refund work, or #81 setup UI.
- Encryption for non-Shopify data, per-tenant keys, external secret services, or new crypto dependencies.

## Goal lock assertion

- Locked goals approved from `goals/tenant-bound-shopify-secret-keyring/goals.v0.md`.
- No reinterpretation or expansion is allowed without reopening goal lock.

## Ambiguity check

- Blocking ambiguity: none.
- Locked decisions:
  - Both variables absent permits backend startup with Shopify disabled.
  - Partial/invalid configuration fails startup.
  - Key IDs match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
  - Envelope serialization is a planning choice constrained by strict deterministic parsing, bounds, required fields, and tests.

## Governing context

- Rules: root/repository `AGENTS.md` lifecycle, goal-lock, scope, verification, and drift contracts.
- Project records: `.codex/codex-config.yaml` and `.codex/project-structure.md`.
- Lifecycle resources: home fallback Stage 2 bootstrap, worktree, and task-scaffold scripts selected by repository resolution.
- Current branch: `eric/admin-security-basics`; code-review base: `main`.

## Execution posture lock

- Simplicity: use Node's existing AES-GCM primitives and one small immutable keyring; add no crypto package or external service.
- Surgical change: touch only encryption/config/composition/call-site/test/documentation surfaces required above.
- Fail fast: reject partial/invalid configuration and malformed/mismatched cryptographic state explicitly.
- No source implementation begins during Stage 2.

## Dirty worktree decision

- Decision: continue.
- Stage 2 safety prep observed `?? goals/` and `?? tasks/` only.
- These contain this task's approved #83 lifecycle artifacts plus the related, currently blocked #75 lifecycle artifacts that depend on #83; no source changes are present.
- #75 artifacts are preserved but not modified except by a later explicit lifecycle action.

## Change control

- Any change to locked goals, startup behavior, key-ID syntax, envelope security requirements, issue ownership boundaries, scope surfaces, or verification commands requires explicit relock.
- Override authority rests with the user.

## Readiness verdict

READY FOR PLANNING

## Implementation phase strategy
- Complexity: scored:L4 (cross-system)
- Complexity scoring details: score=16; recommended-goals=11; guardrails-all-true=false; signals=/Users/eric/pafenorthwest/Festival/tasks/tenant-bound-shopify-secret-keyring/complexity-signals.json
- Active phases: 1..9
- No new scope introduced: required
