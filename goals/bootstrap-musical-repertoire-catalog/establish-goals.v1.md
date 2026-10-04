# Establish Goals

## Status

- Task name: bootstrap-musical-repertoire-catalog
- Iteration: v1
- State: draft

## Request

- Build a canonical musical-repertoire catalog using the local `pafe` database
  as the source and the local `festival_sepv2_db` database as the sink.

## Blocking ambiguity

- None. The target is the single existing PAFE organization
  (`3895502d-c27e-4f85-9909-db4ddc0423e2`), and the user restated the
  catalog-only source-to-sink goal after the proposed scope was presented.

## Assumptions

- Import only the organization-owned catalog tables; registration repertoire
  snapshots are historical submissions and are out of scope.
- A canonical work is a trimmed, case-insensitive title/composer pair. Source
  records that differ only by registration-time movement text map to one work.
- Exclude source records already marked for discussion or not appropriate;
  preserve supported category labels as organization-owned classifications.
- The source is read-only. Target writes are one transaction, use deterministic
  IDs, never overwrite an existing target catalog row, and are safe to rerun.

## Goals

1. Derive the cleaned PAFE source set and load its canonical contributors,
   works, classifications, and valid relationships into the PAFE organization
   in `festival_sepv2_db`.
2. Preserve catalog invariants: target-org isolation, valid contributor roles
   and positions, no more than three contributors per work, and no artificial
   use of registration movements or division tags as catalog metadata.
3. Make the import atomic and rerunnable without duplicate canonical rows or
   updates to already curated target rows.
4. Verify source-to-target counts, source exclusions and canonical aliases,
   referential integrity, target isolation, and idempotent re-execution.

## Non-goals

- Populate or modify registration repertoire snapshot tables.
- Change checkout, UI, migrations, schema definitions, source data, or
  eligibility rules.
- Infer classifications not supported by the cleaned PAFE source.
- Merge distinct arrangements, editions, transcriptions, or instrumentation
  variants when the source demonstrates a catalog distinction.

## Success criteria

- [G1] The target PAFE organization contains exactly the approved canonical
  contributors, works, classifications, work-contributor links, and
  work-classification links from the cleaned source set.
- [G2] Every target relationship belongs to the PAFE organization, passes all
  foreign keys and role/position constraints, and no work has more than three
  contributor links.
- [G3] Rerunning the same transaction leaves all catalog row counts unchanged
  and does not alter existing target display values or IMSLP URLs.
- [G4] The delivery records exact source exclusions, canonical aliases, and
  executable local-PostgreSQL validation queries.

## Next action

- Hand off to implement
