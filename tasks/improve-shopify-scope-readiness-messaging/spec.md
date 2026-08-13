# Improve Shopify Scope Readiness Messaging

## Overview

Clarify the valid-shop/missing-scope state on Integrations and make Memberships readiness presentation match the capability-gated Create button.

## Goals

1. Show verified scope-alignment warnings with actionable remediation.
2. Use the existing prerequisite predicate for Membership readiness.
3. Preserve behavior and add coverage.

## Non-goals

- Backend, capability derivation, verification, or form submission changes.

## Proposed behavior

- Admin Integrations shows an amber alert only when verification is `ok` and at least one required capability is not granted.
- The alert lists missing scope handles and advises updating/releasing/installing the Shopify app version and rerunning Save & Test.
- Admin Memberships shows `Ready`/green when `shopifyPrerequisiteMet()` and `Not Ready`/gray otherwise.

## Verification Commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Test: `bun run test`

## Acceptance criteria checklist

- [x] Verified scope mismatch warning is precise and accessible.
- [x] Aligned integrations do not show the warning.
- [x] Membership readiness text/color matches the prerequisite predicate.
- [x] Submit gating remains unchanged.
- [x] Canonical checks pass.

## IN SCOPE

- `packages/frontend/src/pages/AdminIntegrationsPage.tsx`
- `packages/frontend/src/pages/AdminMembershipProductsPage.tsx`
- `packages/frontend/src/styles.css`
- `packages/frontend/tests/onboarding-integration.test.ts`
- This task's lifecycle artifacts.

## OUT OF SCOPE

- Backend/common behavior, Shopify scope derivation, schema, and unrelated worktree changes.

## Goal lock assertion

- Locked from the user's explicit warning and readiness presentation requirements.

## Dirty worktree decision

- Continue surgically and preserve all prior work.

## Stage 2 verdict

- READY FOR PLANNING

## Implementation phase strategy
- Phase count: 3
- Sizing: agent judgment
- Active phases: 1..3
- No new scope introduced: required
