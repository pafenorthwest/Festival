# Establish Goals

## Status

- Task name: admin-divisions-card
- Iteration: v0
- State: ready-for-confirmation

## Request

- Read GitHub issue #25, create a new repository lifecycle task, and establish explicit goals for the Organization Admin Divisions card.

## Blocking ambiguity

- None.

## Assumptions

- Issue #24's Organization division and timezone Admin APIs are the authoritative backend contract and are available before this task is implemented.
- The Divisions card links to a dedicated Organization Admin configuration page, consistent with the existing Admin card/page navigation pattern.
- Reordering uses accessible explicit controls (for example, move up/down); drag-and-drop behavior is not required.
- Existing application banners and design-system patterns are reused for success and failure feedback rather than introducing a new notification system.

## Goals

1. Add an Organization Admin Divisions card and dedicated tenant-scoped Admin page integrated with the existing route, breadcrumb, navigation, and access-control patterns.
2. Load and render all configured divisions in deterministic server order, including display name and active/inactive status, and load the Organization's current timezone from the existing #24 APIs.
3. Allow authorized Organization Admins to create and rename divisions with explicit client-visible validation, normalized-name conflict handling, loading protection, and success/failure feedback.
4. Allow authorized Organization Admins to activate or deactivate divisions and clearly explain before or alongside deactivation that inactive divisions remain on historical purchases but cannot be selected for new purchases.
5. Allow authorized Organization Admins to reorder divisions with keyboard-accessible controls, persist the complete order through the existing API, and keep the displayed order synchronized with the accepted server response.
6. Allow authorized Organization Admins to select and persist a valid IANA Organization timezone used for entitlement dates, while preserving the last accepted value when validation or backend persistence fails.
7. Provide explicit loading, empty, configured, validation, conflict, authorization, mutation-in-progress, success, and backend-failure states consistent with the existing frontend design system, without exposing mutation controls to non-Admins.
8. Add automated frontend coverage for the complete Divisions card workflow and pass the repository-pinned lint, build, and test commands.

## Non-goals

- Changes to the #24 division/timezone backend contract or persistence model.
- Teacher or accompanist profile editing, profile colors, multi-division directory membership, or public discovery tracked by issue #97.
- Editing existing entitlement or checkout snapshots.
- Implementing the customer purchase flow tracked by issue #77.
- Drag-and-drop reordering or a new reusable notification framework.

## Success criteria

- [G1] The Organization Admin home displays a Divisions card; an authorized Admin can navigate to a dedicated tenant-scoped Divisions page with the expected Admin header/back-navigation behavior; a non-Admin sees no usable mutation entry point or controls.
- [G2] Loading the page calls only trusted-slug Admin APIs and renders the server-returned division order, names, active states, and current timezone; empty and failed loads produce explicit, non-stale UI states.
- [G3] Creating or renaming a valid division updates the rendered server-backed state; invalid names and normalized duplicates produce actionable messages; controls cannot submit duplicate concurrent mutations.
- [G4] Activating or deactivating a division preserves its stable identity and updates its visible status, and the UI states that inactive divisions remain on historical purchases but are unavailable for new purchases.
- [G5] An Admin can move divisions through accessible controls, boundary controls are disabled when movement is impossible, the full order is persisted, and a failed reorder does not falsely present an unaccepted order as saved.
- [G6] The timezone control offers or accepts valid IANA timezone values, saves the selected value through the tenant Admin API, and surfaces validation/backend failures without replacing the last server-confirmed timezone.
- [G7] Loading, empty, configured, validation, conflict, authorization, mutation, success, and backend-failure states follow existing UI conventions; non-Admin rendering and actions do not issue mutation requests.
- [G8] Automated frontend tests cover card/route wiring, empty and configured lists, create, rename, reorder, activation/deactivation, timezone selection, validation, authorization, and backend failures; `bun run lint`, `bun run build`, and `bun run test` pass.

## Next action

- Request explicit user approval of v0; if approved, create and lock the next immutable iteration for implementation handoff.
