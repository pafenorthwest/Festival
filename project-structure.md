# Monorepo TypeScript Project Structure

## Metadata
- Name: TypeScript Monorepo
- Type: Monorepo product structure
- Language/Runtime: TypeScript on Node.js (Bun workspace tooling)
- Package Manager: Bun
- Primary Workspaces: `packages/common`, `packages/backend`, `packages/frontend`

## Objectives
- Maintain a Bun workspace monorepo with shared tooling and dependency orchestration.
- Centralize shared types, schemas, and helpers in `@repo/common`.
- Deliver an Express TypeScript backend that consumes shared contracts.
- Deliver a simple HTML/SolidJS frontend that consumes shared contracts and utilities.
- Use Shopify APIS for commerce functionality including Stripe payment instruments, payments, refunds, credits, inventory
- Use postgresql database for meta-data and custome logic
- Keep lint, build, and test workflows runnable from the repository root.

## Layout
```text
/
├── package.json
├── tsconfig.json
├── tsconfig.base.json
├── eslint.config.js
├── README.md
├── reference/
|   ├── solidjs/
|   ├── shopify/
└── packages/
    ├── common/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── types/
    │   │   ├── rpc/
    │   │   └── utils/
    │   └── tests/
    ├── backend/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── routes/
    │   │   ├── controllers/
    │   │   ├── services/
    │   │   ├── utils/
    │   │   └── types/
    │   └── tests/
    │       ├── unit/
    │       └── integration/
    └── frontend/
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        ├── app.html
        ├── src/
        │   ├── lib/
        │   │   ├── components/
        │   │   ├── server/
        │   │   ├── utils/
        │   │   └── types/
        │   └── routes/
        └── tests/
            ├── mock/
            ├── data/
            ├── e2e/
            ├── db/
            └── unit/
```

## Actions
- Define and maintain shared Zod schemas and reusable utilities in `packages/common/src`.
- Export only the intended public API from `packages/common/src/index.ts`.
- Implement backend HTTP routes in `packages/backend/src/routes` and delegate business logic to controllers/services.
- Validate backend inbound payloads with shared schemas from `@repo/common`.
- Implement frontend UI components in `packages/frontend/src/lib/components`
- Place frontend server logic in `packages/frontend/src/lib/server` and shared helpers in `packages/frontend/src/lib/utils`.
- Keep tests close to each workspace domain using the `tests/` subdirectories shown in layout.

## Verification
- Lint: `bun run lint`
- Build: `bun run build`
- Test: `bun run test`

## Constraints
- Use workspace links (`workspace:*`) for internal dependencies.
- Keep TypeScript strictness aligned to `tsconfig.base.json`.
- Keep shared package code framework-agnostic and side-effect free.
- Keep runtime dependencies in owning workspaces and shared tooling at root dev dependencies.
- Use Pino for structured backend logging and avoid `console.log` in application code.
- Require schema validation for inbound and outbound API payload boundaries.

## Success Criteria
- Root workspace commands for lint, build, and test run successfully across all packages.
- `@repo/common` exports are consumed by both backend and frontend without duplicated contract definitions.
- Backend and frontend source files follow the documented layout and responsibility boundaries.
- Test suites exist for common utilities, backend behavior, and frontend behavior in their documented test directories.

## Non-Goals
- Defining deployment infrastructure or CI/CD topology.
- Prescribing database schema details or migration policy.
- Standardizing UI design systems beyond structural placement of frontend files.
- Replacing framework-specific conventions inside Express or SolidJS internals.
