# Festival

Monorepo for a festival registration app with Shopify/Stripe orchestration.

## Workspaces
- `packages/common`: shared domain models and business rules.
- `packages/backend`: Hono Backend with TypeScript API server.
- `packages/frontend`: SolidJS browser app.

## Commands
- `bun install`
- `bun run lint`
- `bun run build`
- `bun run test`

## Run locally
1. Start backend: `bun --cwd packages/backend run dev`
2. Start frontend: `bun --cwd packages/frontend run dev`

Set env vars for live integrations:
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
- `STRIPE_SECRET_KEY`
