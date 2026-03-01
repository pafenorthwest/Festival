# Phase 1 — Workspace and References Foundation

## Objective
Create the baseline monorepo/tooling surfaces and concise Shopify reference docs required by implementation.

## Code areas impacted
- `package.json`
- `tsconfig.base.json`
- `tsconfig.json`
- `reference/shopify/*.md`
- `packages/common/*`
- `packages/backend/package.json`
- `packages/frontend/package.json`

## Work items
- [x] Create root workspace package scripts for lint/build/test.
- [x] Add root TypeScript configuration files for shared strict settings.
- [x] Create `reference/shopify/` markdown docs with concise summaries and API citations.
- [x] Scaffold `packages/common` with shared domain types and validators.
- [x] Scaffold backend/frontend package manifests and TypeScript project configs.

## Deliverables
- Runnable monorepo skeleton with typed shared package.
- Shopify reference docs linked to official API docs.
- Build/lint/test commands resolving workspace surfaces.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Required package and tsconfig surfaces exist and are consistent.
- [x] Shopify docs exist and include `https://shopify.dev/docs/api` references.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run lint`
  - Expected: command executes against configured workspaces without configuration errors. PASS
- [x] Command: `bun run build`
  - Expected: TypeScript project references compile. PASS

## Risks and mitigations
- Risk:
  - Root workspace scripts may fail if package references are incomplete.
- Mitigation:
  - Keep initial scripts minimal and verify after each scaffolded surface.
