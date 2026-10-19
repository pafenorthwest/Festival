# Goals Extract

- Task name: allow-all-api-routes
- Iteration: v0
- State: locked
- Approval: the user's implementation request authorizes this scope; no additional approval required.

## Goals

1. Allow every existing legitimate frontend and public API method/path through
   `docker/nginx.festival.conf`, including routes identified as missing by the
   completed route inventory audit. Expand the explicit allowlist for the 44
   omitted paths and their supported methods; preserve default denial for
   unknown API paths.
2. Preserve the intentional public boundary: deny backend `/health` and both
   `/api/internal/reconcile/shopify-orders` and
   `/api/internal/reconcile/firebase-claims` endpoints; retain public `/healthz`
   and existing request, header, and proxy protections.
3. Add regression coverage that compares the complete registered API inventory,
   including conditional drop/transfer routes, against effective Docker nginx
   path and method rules so future route omissions are detected.
4. Verify the change with the repository lint, build, test, and format checks,
   and prepare a reviewed, scoped pull request from a new branch based on the
   latest `origin/main`.

## Non-goals

- No changes to host `nginx/festival.conf`.
- No public exposure of private health or scheduler reconciliation endpoints.
- No backend authorization, frontend navigation, business logic, dependency,
  infrastructure deployment, or unrelated cleanup changes.

## Success criteria

- [G1] Every existing frontend route remains reachable through the SPA fallback,
  and every public API declaration is permitted for its registered method.
- [G2] The three documented private backend endpoints remain denied by Docker
  nginx; the public health endpoint and existing hardening remain available.
- [G3] Inventory-based regression tests cover the full set of runtime routes,
  model nginx location precedence and method restrictions, and fail for an
  omitted public path or method.
- [G4] Pinned validation and independent code review pass, the diff remains in
  scope, the branch merges cleanly with `main`, and a pull request is ready.
