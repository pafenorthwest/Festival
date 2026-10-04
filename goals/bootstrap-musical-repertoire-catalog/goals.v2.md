# Goals Extract
- Task name: bootstrap-musical-repertoire-catalog
- Iteration: v2
- State: draft

## Goals

1. Store the complete canonical PAFE catalog as reviewable, normalized files
   in `database/seeds/musical-repertoire/pafe/`, including source provenance,
   canonical aliases, exclusions, counts, and all required catalog links.
2. Add `bun run load-music-rep`, which uses only committed seed files and the
   active Festival database connection to atomically load the PAFE catalog;
   it must be repeatable and never overwrite data.
3. Add `bun run nuke-music-rep`, whose final deletion boundary is resolved by
   the blocking question above. It must be target- and organization-scoped,
   transactional, lock-protected, and reject unexpected rows or references.
4. Add focused automated checks for seed-file validity, relationship closure,
   SQL load/nuke invariants, idempotency, and command registration; remove
   the source-coupled `run-import.sh` after the replacement is validated.


## Non-goals

- Query or write the `pafe` database after committed seed files exist.
- Change checkout, UI, repertoire schema, migrations, or eligibility rules.
- Invent classifications, merge source-distinct arrangements, or put movement
  text or division tags into catalog seed files.
- Delete historical registrations or repertoire review data unless the user
  explicitly resolves the blocking deletion-scope question in favor of it.


## Success criteria

- [G1] The committed seed files reproduce exactly 70 contributors, 127 works,
  3 classifications, 127 work-contributor links, 104 work-classification
  links, 82 IMSLP URLs, seven excluded source rows, and five canonical aliases.
- [G2] `bun run load-music-rep` contacts no `pafe` database, validates the
  active target and PAFE organization, inserts atomically, and passes an
  immediate no-op rerun without altering existing catalog fields.
- [G3] `bun run nuke-music-rep` follows the user-approved data-removal scope,
  cannot cross organization/database boundaries, and either completes
  atomically or leaves all target data unchanged.
- [G4] Tests reject malformed files, invalid links, duplicate canonical work
  pairs, invalid roles/positions, and unsafe generated SQL; root package
  scripts invoke both commands exactly as requested.
- [G5] `tasks/bootstrap-musical-repertoire-catalog/run-import.sh` is absent,
  and documentation states the seed location, commands, and destructive scope.
