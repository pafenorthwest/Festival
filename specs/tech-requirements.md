# Technical Requirements

This document records the baseline Hono and SolidJS practices for the Phase 0 onboarding integration work.

## Invariants

- The canonical organization route is `/org/:shortOrgName`.
- Frontend routing uses `@solidjs/router`.
- Frontend API integration keeps the current API helper pattern in `packages/frontend/src/lib/api.ts`.
- Frontend pages must reference and follow `specs/Style.md`.

## Hono Practices

- Use Hono as the backend HTTP boundary for app and API routes.
- Compose larger API surfaces with route modules and `app.route()`.
- Keep handlers close to route definitions so path parameters remain type-inferred.
- Use middleware for cross-cutting request concerns such as Firebase bearer-token verification, tenant resolution, role checks, CORS, and consistent JSON errors.
- Attach authenticated identity and tenant context to typed Hono context variables before route handlers use them.
- Return explicit JSON error responses for authentication, authorization, validation, conflict, not-found, and server failures.
- Keep Firebase ID tokens as the v1 bearer-token model; do not mint a separate application JWT unless a later requirement justifies it.

## Shopify Authorization

- Use Shopify Dev Dashboard app install plus client credentials grant for backend Shopify Admin API access.
- Configure Shopify access scopes in released Dev Dashboard app versions; do not request scopes from Festival token calls.
- Request Shopify access tokens server-side only when needed, use them transiently, and do not persist access tokens in Festival storage.
- Keep Shopify HTTP/API details, token requests, endpoint construction, response parsing, and Shopify-specific errors inside the dedicated backend Shopify module.
- Keep `/api/...` reserved for Festival internal APIs that use Firebase authentication and tenant authorization.

## SolidJS Practices

- Use a SolidJS SPA with `@solidjs/router` for page routing, navigation, and route parameters.
- Do not require SolidStart or file-based routing for this repository.
- Keep API calls isolated behind the existing frontend API helper layer.
- Use Firebase client helpers for Google SSO and passwordless email-link sign-in, then pass Firebase ID tokens to API helpers.
- Represent authenticated routing state explicitly: unauthenticated, loading session, no membership, one membership, multiple memberships, and error.
- When a user has multiple memberships, show an organization chooser before navigating to `/org/:shortOrgName`.
- Keep pages and components aligned with `specs/Style.md`, using the Skeleton-inspired theme, clean forms, panels where appropriate, consistent spacing, and accessible controls.

## References

- `specs/Style.md`
- `specs/Multi-Tenant-Starter.md`
- Hono best practices: https://hono.dev/docs/guides/best-practices
- Hono middleware: https://hono.dev/docs/guides/middleware
- SolidJS routing and navigation: https://docs.solidjs.com/guides/routing-and-navigation
