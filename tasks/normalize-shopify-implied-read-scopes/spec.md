# Normalize Shopify Implied Read Scopes

## Overview

Shopify omits redundant read scopes because write permission includes read permission. Festival currently treats token scope strings as independent, falsely marking `read_products` missing when `write_products` is granted.

## Goals

1. Expand Shopify-issued scopes into an effective canonical set.
2. Use that set for diagnostics, persistence, token caching, and operation checks.
3. Preserve fail-closed behavior for genuinely missing permissions.
4. Cover the reported response and pass verification.

## Non-goals

- Removing capability enforcement, changing authorization/audit, or adding Shopify requests.

## Technical design

- Add a shared pure helper that sorts/deduplicates scopes and adds `read_products` when `write_products` exists.
- Derive capabilities from the effective set.
- Normalize the validated token response through the shared helper before caching/returning it.

## Security & privacy

- Input remains Shopify-issued and syntax-validated. Only Shopify's documented implied permission is added; no unavailable write scope is synthesized.

## Verification Commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Test: `bun run test`

## Acceptance criteria checklist

- [x] `write_products` implies product-read capability.
- [x] Token normalization carries effective product-read scope into protected operation contexts.
- [x] Missing product permissions remain denied.
- [x] Lint, build, and tests pass.

## IN SCOPE

- `packages/common/src/shopify.ts`
- `packages/common/tests/shopify.test.ts`
- `packages/backend/src/shopify/admin-api-client.ts`
- `packages/backend/tests/shopify-admin-api-client.test.ts`
- `specs/tech-requirements.md`
- This task's lifecycle artifacts.

## OUT OF SCOPE

- Frontend layout, database schema, Shopify installation queries, auth/audit policy, and unrelated worktree changes.

## Goal lock assertion

- Locked by `goals/normalize-shopify-implied-read-scopes/goals.v0.md` after the user provided the exact incomplete token scope response.

## Dirty worktree decision

- Continue surgically and preserve all prior issue #75, #81, and Admin membership endpoint work.

## Stage 2 verdict

- READY FOR PLANNING

## Implementation phase strategy
- Phase count: 4
- Sizing: agent judgment
- Active phases: 1..4
- No new scope introduced: required
