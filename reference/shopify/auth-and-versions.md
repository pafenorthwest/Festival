# Auth and API Versioning

## What to use
- Admin GraphQL API for server-to-server operations requiring app credentials.
- Storefront API for cart and checkout creation.

## Practical guidance
- Pin a stable API version in API URLs (for example `2025-10`) and rotate intentionally.
- Keep Admin and Storefront credentials separate.
- Fail fast when credentials are missing; use mock mode only in local/dev flows.

## References
- https://shopify.dev/docs/api/admin-graphql
- https://shopify.dev/docs/api/storefront
- https://shopify.dev/docs/api/usage/versioning
