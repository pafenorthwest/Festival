# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): tenant-bound-shopify-secret-keyring

## Request restatement

- Establish and lock explicit, verifiable implementation goals for GitHub issue #83: replace the legacy single-key Shopify client-secret encryptor with a small configured AES-256-GCM keyring whose versioned ciphertext envelopes are authenticated to the Festival organization and fixed Shopify-client-secret purpose, without performing migration, re-encryption, or Shopify credential/cache rotation work.

## Context considered

- Repo/rules consulted: root and repository `AGENTS.md`; establish-goals template/checklist; `.codex/codex-config.yaml`; `.codex/project-structure.md`; goal scaffold/extract/validation scripts.
- GitHub context: current issue #83 body, no comments, parent architecture issue #74, and the locked separation from issue #75.
- Current implementation: `packages/backend/src/shopify/encryption.ts` has a single `AES_ENCRYPTION_KEY` AES-256-GCM `v1` encryptor with no key ID, tenant context, or authenticated additional data; `AppEnv`, runtime composition, integration/product services, tests, `README.md`, and `SETUP.md` use that legacy contract.
- Locked issue boundary: #83 owns keyring configuration, the new envelope, tenant/purpose authenticated encryption, active/previous-key behavior, validation, and safe configuration documentation. #75 owns Shopify credential/shop rotation and access-token cache invalidation.
- Confirmed runtime decisions: when both keyring variables are absent, backend startup is allowed but Shopify services are disabled; any partial or invalid keyring configuration fails startup. Key IDs must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
- Verification commands: `bun run format:check`, `bun run build`, and `bun run test`.
- Stage restriction: no source-code changes or implementation planning before `GOALS LOCKED`.

## Ambiguities

### Blocking (must resolve)

- None.

### Non-blocking (can proceed with explicit assumptions)

1. The envelope serialization may be selected during planning so long as it is deterministic, versioned, strictly parsed, length-bounded, and contains exactly the issue-required fields; its external compatibility is limited to this repository because legacy compatibility is explicitly excluded.
2. The fixed secret purpose is represented by a closed application constant/type, not arbitrary browser input or a general-purpose encryption API.
3. Base64 fields must be canonical and strictly decoded rather than accepting malformed/trailing data.
4. Existing local Shopify integration rows may be discarded as stated in issue #83; no read fallback for `v1` ciphertext is permitted.

## Questions for user

- None; the user resolved both blocking questions.

## Assumptions (explicit; remove when confirmed)

1. Confirmed: preserve optional Shopify configuration—both variables absent disables Shopify services, but either variable present makes the complete keyring required and any invalidity fails startup.
2. Confirmed: key IDs must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
3. The keyring holds one Festival-wide set of keys; it does not provision per-tenant or per-Shopify-client keys.
4. All configured keys are retained for decryption; only the active key is used for new encryption.
5. `organizationId` and the literal purpose `shopify-client-secret` are canonicalized into AES-GCM additional authenticated data and also represented in the envelope for explicit mismatch checks.
6. Secret/ciphertext/key material redaction includes plaintext, serialized envelopes, IVs, authentication tags, encoded keys, decoded keys, and configuration JSON.

## Goals (1-20, verifiable)

1. Replace the legacy single-key Shopify secret encryptor with a configured AES-256-GCM keyring loaded from `FESTIVAL_SECRET_KEYS_JSON` and `FESTIVAL_ACTIVE_SECRET_KEY_ID`; when both variables are absent, allow backend startup with Shopify services disabled, while any partial or invalid configuration fails startup.
2. Validate keyring configuration strictly and fail explicitly for malformed JSON, non-object or empty mappings, key IDs not matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, a missing/unknown active key, non-string key values, invalid or non-canonical Base64, and keys that do not decode to exactly 32 bytes.
3. Define one new strictly parsed, length-bounded ciphertext envelope containing a format version, encryption key ID, Festival organization ID, fixed secret purpose `shopify-client-secret`, 12-byte AES-GCM IV, 16-byte authentication tag, and ciphertext.
4. Encrypt every newly saved or updated Shopify client secret with AES-256-GCM using the configured active key and a canonical additional-authenticated-data representation of the envelope's version, organization ID, and fixed purpose.
5. Require the caller's expected Festival `organizationId` and fixed Shopify-client-secret purpose during decryption; reject envelope/caller context mismatch and make ciphertext copied across organizations or purposes fail authentication/decryption.
6. Select decryption key material only by the envelope's key ID, allow reads from every still-configured previous key after the active key changes, and fail explicitly when the referenced key ID is unavailable.
7. Fail explicitly and safely for unsupported versions, malformed/truncated/oversized envelopes, missing/extra/invalid fields, invalid Base64, invalid IV/tag lengths, tenant/purpose mismatch, ciphertext tampering, and AES-GCM authentication failure.
8. Update Shopify integration save/read and membership-product credential-loading call sites to pass the resolved Festival organization ID and fixed purpose through the new encryption interface, without adding repository migration, re-encryption, credential rotation, or token-cache behavior.
9. Update backend environment parsing and application composition to construct the keyring once, validate it at startup according to the final absence decision, and remove runtime dependence on `AES_ENCRYPTION_KEY` for Shopify client secrets.
10. Ensure no plaintext secret, serialized ciphertext envelope, IV, authentication tag, encoded or decoded key material, or raw keyring configuration is exposed through application responses, thrown public errors, or captured logs.
11. Update local configuration documentation with placeholder-only key-generation/keyring examples, active/previous-key semantics, safe active-key switching, database-wipe/no-legacy-compatibility expectations, and explicit separation from future re-encryption/key retirement and #75 credential/cache rotation.
12. Add deterministic automated tests for configuration validation; active-key round trip; tenant/purpose binding; new-write active-key selection; retained previous-key reads; missing keys; malformed/truncated/oversized/non-canonical envelopes; tampering; call-site organization binding; and log/response redaction.
13. Pass the repository's pinned `bun run format:check`, `bun run build`, and `bun run test` commands.

## Non-goals (explicit exclusions)

- Decrypting or migrating the existing legacy `v1` ciphertext format.
- Database migration, backfill, or preserving localhost development integration rows.
- Repository/service operations that re-encrypt stored records, automatic/batch re-encryption, or re-encryption tooling.
- Deleting or retiring previous key material or determining when a key is safe to retire.
- Shopify client-secret rotation, shop-identity rotation, verification workflow changes, or access-token cache invalidation owned by #75.
- Per-tenant or per-Shopify-client encryption keys.
- General encryption of non-Shopify secrets or a browser-facing/general-purpose encryption API.
- External KMS/HSM/vault services, new cryptography packages, or key storage in PostgreSQL.
- Logging secrets, ciphertext envelopes, IVs, authentication tags, or key material for diagnostics.

## Success criteria (objective checks)

- [G1, G2, G9] Environment/configuration tests prove both variables absent permits backend startup with Shopify services disabled; either variable alone and every named invalid configuration fail startup; and a valid multi-key JSON object with an active key matching the approved key-ID syntax enables Shopify secret operations.
- [G3, G4] A new encryption round trip produces a strictly valid new-version envelope using the active key ID, 12-byte random IV, 16-byte tag, required tenant/purpose fields, and authenticated canonical context.
- [G5] Tests prove the same envelope cannot decrypt under a different Festival organization ID or secret purpose and that modifying embedded context fails explicitly.
- [G6] After switching the active key, new writes use the new key while an envelope written with a retained prior key remains decryptable; removing the referenced key causes an explicit safe failure.
- [G7] Tests reject unsupported versions, malformed/truncated/oversized envelopes, missing/extra fields, non-canonical/invalid Base64, invalid IV/tag lengths, and modified ciphertext/tag/AAD without leaking cryptographic material.
- [G8] Integration-service and membership-product-service tests prove encryption/decryption receives the resolved record/tenant organization ID and fixed purpose, and cross-tenant ciphertext substitution fails.
- [G9] Runtime composition no longer reads `AES_ENCRYPTION_KEY` for Shopify secrets and constructs one validated keyring from the new environment contract.
- [G10] Seeded secret/ciphertext/IV/tag/key/config values are absent from captured logs, public errors, and API responses across configuration, encryption, decryption, and service failures.
- [G11] `README.md`/`SETUP.md` and directly affected technical requirements contain safe placeholder-only configuration and rotation semantics consistent with issue #83's non-goals.
- [G12, G13] All issue-specific tests pass, followed by `bun run format:check`, `bun run build`, and `bun run test` from the repository root.

## Risks / tradeoffs

- Strictly rejecting legacy `v1` ciphertext intentionally makes existing development rows unreadable; issue #83 accepts this because the database will be wiped.
- Environment-stored previous keys must remain configured until no ciphertext references them, but detecting that state and retiring keys are out of scope.
- Embedding organization/purpose provides inspectable context but does not create security by itself; AES-GCM additional authenticated data and caller-supplied expected context enforce integrity and tenant binding.
- A custom envelope requires strict parser/size/canonical-encoding tests to avoid ambiguity and memory abuse.

## Next action

- GOALS LOCKED. Do not reinterpret or expand this goal set in downstream stages.
