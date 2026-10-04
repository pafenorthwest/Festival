# Establish Goals

## Status

- Task name: bootstrap-musical-repertoire-catalog
- Iteration: v3
- State: locked

## Request

- Replace the live-`pafe` database importer with version-controlled canonical
  repertoire data, a load command for the active Festival database, and a
  deliberately scoped destructive nuke command. Delete the old importer once
  the repository-owned workflow is complete.

## Blocking ambiguity

- None. The user approved deletion of loader-owned catalog data only:
  contributors, works, classifications, and their joins. Registration
  snapshots and review rows stay outside the destructive boundary.

## Assumptions

- Durable source data lives at `database/seeds/musical-repertoire/pafe/` as a
  manifest plus normalized JSON assets. It is the only input to the new
  loader; `pafe` is never contacted after the files are committed.
- The loader resolves the `pafe` organization by slug in the active Festival
  database rather than embedding a local database name or organization UUID.
- Catalog IDs remain `pafe-bootstrap-*` for compatibility with the current
  local catalog. Canonical work, contributor, classification, and relationship
  data remains identical to the approved 70/127/3/104 data set.
- `nuke-music-rep` deletes only loader-owned catalog records and their joins,
  never registration snapshots, registration metadata, or review records. It
  aborts before clearing a historic catalog link, touching a non-loader-owned
  catalog row, or traversing a mixed loader/manual relationship.

## Goals

1. Store the complete canonical PAFE catalog as reviewable, normalized files
   in `database/seeds/musical-repertoire/pafe/`, including source provenance,
   canonical aliases, exclusions, counts, and all required catalog links.
2. Add `bun run load-music-rep`, which uses only committed seed files and the
   active Festival database connection to atomically load the PAFE catalog;
   it must be repeatable and never overwrite data.
3. Add `bun run nuke-music-rep`, which deletes only loader-owned catalog rows
   and joins. It must be target- and organization-scoped, transactional,
   lock-protected, and reject historic references, mixed catalog links, and
   unexpected catalog rows.
4. Add focused automated checks for seed-file validity, relationship closure,
   SQL load/nuke invariants, idempotency, and command registration; remove
   the source-coupled `run-import.sh` after the replacement is validated.

## Non-goals

- Query or write the `pafe` database after committed seed files exist.
- Change checkout, UI, repertoire schema, migrations, or eligibility rules.
- Invent classifications, merge source-distinct arrangements, or put movement
  text or division tags into catalog seed files.
- Delete historical registrations, registration metadata, or repertoire-review
  data.

## Success criteria

- [G1] The committed seed files reproduce exactly 70 contributors, 127 works,
  3 classifications, 127 work-contributor links, 104 work-classification
  links, 82 IMSLP URLs, seven excluded source rows, and five canonical aliases.
- [G2] `bun run load-music-rep` contacts no `pafe` database, validates the
  active target and PAFE organization, inserts atomically, and passes an
  immediate no-op rerun without altering existing catalog fields.
- [G3] `bun run nuke-music-rep` deletes loader-owned catalog data only, cannot
  cross organization/database boundaries or clear historic links, and either
  completes atomically or leaves all target data unchanged.
- [G4] Tests reject malformed files, invalid links, duplicate canonical work
  pairs, invalid roles/positions, and unsafe generated SQL; root package
  scripts invoke both commands exactly as requested.
- [G5] `tasks/bootstrap-musical-repertoire-catalog/run-import.sh` is absent,
  and documentation states the seed location, commands, and destructive scope.

## Next action

- Hand off to implement
