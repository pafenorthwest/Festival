# Lazy route preloading

- Task name: lazy-route-preloading
- Iteration: v0
- State: locked
- Approval: The user's 2026-10-23 instruction explicitly authorizes lazy loading with navigation hover/focus preloading, eager shell/authentication, and rebuild/performance comparison.

## Request and assumptions

- Keep Home, organization chooser, the application shell, and authentication eager.
- Split the other route pages and preload their modules on navigation intent.
- Preserve existing routes, authorization, API behavior, and navigation semantics.
- Measure real browser navigation against a production baseline; report the environment and limits rather than infer latency from bundle bytes.
- No blocking questions remain within this scope.

## Goals

1. Load non-shell route pages lazily while keeping shell, Home, organization chooser, and authentication eager.
2. Preload navigation destinations on pointer hover and keyboard focus, covering internal links and navigation buttons without triggering navigation, authentication, mutations, or page data loading.
3. Preserve routing and authorization behavior, present a route loading fallback, and handle failed chunk loads without hiding the eager shell.
4. Validate the changes, compare exact production bundle sizes, and measure cold, warm, and preloaded navigation in a reproducible browser environment.

## Non-goals

- Authentication deferral, API changes, dependency upgrades, route redesign, broad caching/deployment changes, commits, pushes, and production deployment.

## Success criteria

- [G1] Production output contains deferred route chunks; eager startup retains shell/authentication and Home/organization chooser.
- [G2] Hover and focus initiate only the matching module preload for supported internal destinations; repeated intent reuses the module load; external/auth/mutation/disabled controls do not trigger preload.
- [G3] Existing frontend tests and focused lazy/preload tests pass, with meaningful loading/error-path coverage; original navigation and permission checks remain intact.
- [G4] TypeScript, scoped Biome, production build, and independent review pass or any pre-existing blocker is evidenced explicitly.
- [G4] Report exact minified and gzip startup/total bytes against the preserved baseline and real browser cold/warm/preloaded timings with trial count, environment, and method.
