# Add Shopify Setup Instructions

## Overview

Implement GitHub issue #81 as a small frontend-only enhancement to the tenant Admin integrations route.

## Goals

1. Show the prescribed Shopify Dev Dashboard example above the existing Shopify Integration form.
2. Generate the App URL from `window.location.origin` and the current integrations-route organization shortname.
3. Use native `<details open>` disclosure behavior with no persistence or copy controls.
4. Preserve existing integration form behavior and align styling with `specs/Style.md`.
5. Add deterministic coverage and pass canonical verification.

## Non-goals

- Disclosure persistence, local storage, or user/organization preference storage.
- Copy buttons or clipboard behavior.
- Backend, database, API, authentication, or Shopify credential changes.

## Current behavior

- The Admin integrations page renders only the Shopify Integration form.
- Key files:
  - `packages/frontend/src/pages/AdminIntegrationsPage.tsx`
  - `packages/frontend/src/styles.css`
  - `packages/frontend/tests/onboarding-integration.test.ts`

## Proposed behavior

- An expanded native disclosure labeled `Shopify app setup instructions` appears before the form.
- It contains the literal issue #81 example values and a dynamic organization-specific App URL.
- It states that production Shopify app URLs must use HTTPS.
- Collapsing leaves the native summary bar; each page load starts expanded.

## Technical design

- Add one fail-fast URL helper and native disclosure markup to `AdminIntegrationsPage.tsx`.
- Add localized card/example styles to `styles.css`.
- Extend the existing frontend source-contract test with exact assertions.
- No API or schema changes.

## Security & privacy

- The example contains no credentials or tenant secrets.
- The App URL trusts only the already-parsed route shortname and current browser origin.

## Verification Commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Test: `bun run test`

## Acceptance criteria checklist

- [x] Instructions precede Shopify Integration.
- [x] All issue #81 example values and HTTPS guidance render.
- [x] App URL uses current browser origin and route shortname.
- [x] Native disclosure starts expanded and remains keyboard accessible.
- [x] Existing form behavior is unchanged.
- [x] Lint, build, and tests pass.

## IN SCOPE

- The three frontend files listed above plus this task's lifecycle artifacts.

## OUT OF SCOPE

- All backend/common sources and all issue #75 behavior.

## Goal lock assertion

- Locked by `goals/add-shopify-setup-instructions/goals.v0.md` after the user removed persistence and copy-friendly requirements.

## Dirty worktree decision

- Decision: continue surgically.
- The current branch contains the user's in-progress issue #75 work. Issue #81 explicitly cross-references #75 and modifies only the already-touched integrations page/test plus localized CSS and task artifacts. Preserve every unrelated change.

## Stage 2 verdict

- READY FOR PLANNING

## Implementation phase strategy
- Complexity: scored:L1 (surgical)
- Complexity scoring details: score=0; recommended-goals=1; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/add-shopify-setup-instructions/complexity-signals.json
- Active phases: 1..1
- No new scope introduced: required
