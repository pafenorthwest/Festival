# Monorepo TypeScript Project Structure

## Metadata

- Name: Festival Registration Monorepo
- Type: Bun workspace monorepo
- Language/Runtime: TypeScript on Node.js + browser
- Package Manager: Bun
- Workspaces: `packages/common`, `packages/backend`, `packages/frontend`
- Linting: Biome
-

## Objectives

- Share domain contracts and rule logic in `@festival/common`.
- Run an Hono backend that orchestrates Shopify and Stripe flows.
- Run a SolidJS browser frontend for class selection and checkout initiation.
- Keep Shopify reference docs under `reference/shopify/`.
- Keep root verification commands stable and runnable.

## Layout

```text
/
├── package.json
├── tsconfig.json
├── tsconfig.base.json
├── project-structure.md
├── reference/
│   ├── solidjs/
│   └── shopify/
└── packages/
    ├── common/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/
    │   └── tests/
    ├── backend/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/
    │   └── tests/
    └── frontend/
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        ├── index.html
        ├── src/
        └── tests/
```

## Actions

- Place shared types and business rules in `packages/common/src`.
- Place backend HTTP routes and orchestration services in `packages/backend/src`.
- Place frontend UI and API client logic in `packages/frontend/src`.
- Keep tests close to each workspace under `tests/`.
- Use Hono for web application https://hono.dev/
- Use Biome for linting and formating https://biomejs.dev/.

## Verification

- Lint: `bun run lint-format`
- Build: `bun run build`
- Test: `bun run test`

## Constraints

- Use workspace links (`workspace:*`) for internal dependencies.
- Keep TypeScript strict mode enabled.
- Keep eligibility/cart constraints implemented in custom app logic rather than Shopify discount scripts.
- Keep student metadata ownership in app logic, with Shopify metadata as synchronization output.

## Success Criteria

- Root lint/build/test pass.
- Shared domain logic is consumed by backend and frontend.
- Backend exposes payer/pass/checkout/refund APIs.
- Frontend executes registration flow in browser.
- Shopify references exist under `reference/shopify/` with cited API docs.

## Non-Goals

- Deployment infrastructure and CI/CD wiring.
- Discount rule implementation.
- Full production-grade persistence and webhook processing guarantees.
