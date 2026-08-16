# Establish Goals

## Status

- Task name: organization-divisions-timezone-api
- Iteration: v1
- State: locked

## Request

- Satisfy GitHub issue #24, `Organization division and timezone configuration API`, by defining durable, tenant-scoped division configuration and a required Organization IANA timezone for Teacher Membership purchase validation and entitlement-date calculation.

## Blocking ambiguity

- None.

## Assumptions

- Organization, rather than Festival, is the ownership boundary for both divisions and timezone, as stated by issue #24.
- Division display-name normalization must be deterministic and documented; the exact normalization algorithm is an implementation choice so long as equivalent names cannot bypass Organization-scoped uniqueness.
- Hard deletion is not a required Admin API. Deactivation is the supported removal path, and persistence/repository safeguards must reject deletion when a division is historically referenced.
- Existing and newly created Organizations must end with a valid IANA timezone; the migration/default mechanism is an implementation choice and must not leave invalid or missing persisted values.
- Public/customer division DTOs are read-only purchase-flow projections and expose active divisions only; Admin DTOs may expose inactive divisions for configuration.
- Historical checkout and entitlement snapshots retain the selected division identity and captured display data; later renames, reordering, or deactivation do not rewrite or invalidate them.

## Goals

1. Add durable Organization-scoped divisions with stable IDs, Organization IDs, display names, active/inactive state, and deterministic display order.
2. Enforce deterministic division-name normalization and Organization-scoped uniqueness, with explicit validation failures for invalid or duplicate names.
3. Persist a required, valid IANA timezone for every Organization so entitlement dates can be calculated in the Organization's configured civil time.
4. Provide tenant-scoped Admin APIs to list, create, rename, activate/deactivate, and reorder divisions and to read/update the Organization timezone.
5. Provide the customer/public read contract needed by the purchase flow, allowlisting only active division data intended for selection.
6. Preserve division referential history: stable IDs survive mutation, inactive divisions cannot be selected for new purchases, and rename/deactivation/reorder do not alter historical checkout or entitlement snapshots.
7. Enforce tenant and role authorization on all configuration surfaces, derive Organization authority from trusted server context, and reject browser-supplied Organization authority fields.
8. Add automated coverage for persistence, ordering, normalization, uniqueness, activation, timezone validation, referential behavior, authorization, tenant isolation, and DTO allowlists, with all repository-pinned quality commands passing.

## Non-goals

- Admin UI work tracked by issue #25.
- Teacher or accompanist profiles, stable profile colors, multi-division directory membership, or public discovery, which remain in issue #97.
- Treating division membership as an entitlement.
- Implementing the membership offering/date contract tracked by issue #92 or the purchase-selection flow tracked by issue #77 beyond exposing the configuration contracts they require.
- Adding a hard-delete Admin endpoint for divisions.

## Success criteria

- [G1] Persisted divisions have stable IDs and Organization ownership, Admin listing returns a deterministic configured order, and rename/reorder/state changes do not replace division identity.
- [G2] Creation and rename apply the same documented normalization; invalid names fail validation and normalized duplicates fail explicitly within one Organization while the same normalized name remains valid in another Organization.
- [G3] Every existing and new Organization has a persisted valid IANA timezone; Admin reads return it, valid updates persist, and invalid or missing timezone values fail explicitly.
- [G4] An Organization Admin can perform every required division and timezone operation through tenant-scoped APIs; each mutation has an explicit success response and explicit validation/conflict failures.
- [G5] Customer/public purchase-flow responses include active divisions in deterministic display order and exclude inactive divisions, tenant-internal fields, and unrelated Organization configuration.
- [G6] New-purchase validation rejects inactive, missing, or cross-Organization division IDs; historical snapshots remain readable and unchanged after the referenced division is renamed, reordered, or deactivated; attempts to delete a referenced division fail explicitly.
- [G7] Non-Admins cannot mutate configuration, one Organization cannot read another Organization's non-public configuration or mutate its divisions/timezone, and supplied Organization authority fields cannot override trusted tenant context.
- [G8] Automated tests demonstrate all mapped behaviors, including DTO field allowlists, and repository-pinned lint, build, and test commands all pass.

## Next action

- Hand the locked goals to `implement`.
