# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth: mark items complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`. This is a plan until implementation begins.

## Locked-scope audit

- [x] Compare final diff with locked goals, `spec.md`, and `.scope-lock.md`.
- [x] Confirm every change maps to G1–G13 and an approved phase.
- [x] Confirm legacy compatibility, migration, re-encryption, key retirement, #75 behavior, DB schema, general encryption, external key services, and UI changes are absent.

## Configuration closeout

- [x] Both variables absent permits startup with Shopify disabled.
- [x] Partial/invalid configuration fails startup before request handling.
- [x] Key IDs and canonical Base64/32-byte key validation match the locked contract.
- [x] Runtime no longer uses `AES_ENCRYPTION_KEY` for Shopify secrets.

## Cryptographic closeout

- [x] New envelope is strictly versioned, bounded, and exact-field parsed.
- [x] AES-256-GCM uses random 12-byte IV, 16-byte tag, active key, and canonical version/tenant/purpose AAD.
- [x] Expected tenant/purpose is required on decrypt and cross-context copying fails.
- [x] Retained previous keys decrypt prior envelopes; missing keys and all tampering fail safely.
- [x] Legacy `v1` has no fallback read path.

## Service and privacy closeout

- [x] Integration and product services use resolved server-side organization context at every secret operation.
- [x] Cross-tenant substitution fails before credentials reach Shopify transport.
- [x] Plaintext, envelope, IV, tag, encoded/decoded key, and raw configuration canaries are absent from errors, responses, and logs.

## Documentation updates

- [x] `README.md`, `SETUP.md`, and `specs/tech-requirements.md` accurately describe the two variables, key generation, active/previous behavior, database wipe, and non-goals.
- [x] Examples contain placeholder material only.
- [x] EVALUATED: No ADR or API YAML is required because the change is an internal configuration/encryption contract and introduces no API surface.

## Full verification

- [x] Lint: `bun run format:check` PASS — Biome checked 91 files with no fixes required.
- [x] Build: `bun run build` PASS — common/backend TypeScript and frontend Vite production build completed.
- [x] Tests: `bun run test` PASS — 17 common, 113 backend, and 22 frontend tests passed with zero failures.

## Manual/operational QA

- [x] Verify a placeholder valid multi-key environment shape starts Shopify services without printing configuration.
- [x] Verify both variables absent starts non-Shopify backend behavior with Shopify unavailable.
- [x] EVALUATED: Live Shopify is not required because #83 changes local secret storage, not Shopify API behavior; deterministic service tests provide the required evidence.

## Code review checklist

- [x] Correctness and edge cases
- [x] Fail-fast error handling
- [x] Cryptographic context integrity
- [x] Secret/material redaction
- [x] Startup and disabled-service semantics
- [x] Maintainability and bounded parser design
- [x] Deterministic test quality

## Release / rollout notes

- [x] Record that the local development database must be wiped/re-entered because legacy `v1` is unreadable.
- [x] Record that all previous keys remain configured until separate re-encryption/retirement work exists.
- [x] Record #75 can resume only after this interface is available on its implementation base.
- [x] Backout does not attempt mixed ciphertext compatibility.

## Outstanding issues

- None at planning time. During implementation, list any blocker with severity, reproduction, and suggested in-scope remediation.
