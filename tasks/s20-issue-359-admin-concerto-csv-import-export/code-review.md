# Code Review
- Task name: s20-issue-359-admin-concerto-csv-import-export
- Findings status: none

## Context
- Branch / worktree: `C:\Users\gusto\.gemini\antigravity\worktrees\Festival\issue359_concerto_csv_import`
- Audited against:
  - `goals/s20-issue-359-admin-concerto-csv-import-export/goals.v0.md` (`[G1]`–`[G4]` and `Non-goals`)
  - `tasks/s20-issue-359-admin-concerto-csv-import-export/spec.md` (`### In scope`, `### Out of scope`, `## Approach` Rules 1–5)
  - `specs/bounded-contexts-2026.md` (`catalog-repertoire` single-writer SQL ownership, acyclic imports, `RepertoireUpdated` invalidation event, and file/class/function size ceilings)
- Scope & structural invariance:
  - All modified and untracked working-tree files match `### In scope` (`0` edits in `database/**`, `repertoire.routes.ts`, or `S17`–`S19` `teacher-directory` / Customer Account files; `0` `console.*` debug statements; `0` hardcoded credentials).
  - All source and test files satisfy size and boundary gates (`<= 500` lines per file, `packages/frontend/src/lib/api.ts` at `121` lines `<= 200` lines; `architecture-boundaries.test.ts`, `file-size-ratchet.test.ts`, `route-security.test.ts`, `nginx-security.test.ts`, and `bun run check:sql` all pass).
- Security, transactional & resolution verification:
  - All four Admin concerto repertoire endpoints (`template`, `export`, `preview`, `import`) enforce `requireAuth`, `requireTenant`, `requireTenantRole(["Admin"])`, `authenticationClass: "admin"`, and NGINX `GET`/`POST` allowlists in both `nginx/festival.conf` and `docker/nginx.festival.conf`, with zero cross-org existence leakage (`unknown_work_id`).
  - `preview` and rejected `import` paths (`409` stale digest, `400` syntax / missing `confirmClearAll`, `422` row validation errors) perform zero DB writes; confirmed `import` acquires `pg_advisory_xact_lock(hashtextextended($1, 0))` for `concerto-csv:${organizationId}` inside `sql.begin`, recomputes live `catalogDigest` inside the transaction, preserves shared `repertoire_contributors` records and secondary credits (`position > 1`), deletes only `'concerto'` links on omitted works (preserving canonical works, non-`'concerto'` classifications, `registration_repertoire_items`, and `repertoire_review_items`), and emits `RepertoireUpdated`.
  - All four initial findings (`F1` blank-`work_id` target collision when a distinct single work matches in the catalog, `F2` header-only `clearsEntireCatalog` / `confirmClearAll` enforcement on empty catalogs, `F3` `409` `catalogDigest` wire field alignment across backend and frontend, and `F4` deterministic `(lower(display_title) COLLATE "C", display_title COLLATE "C", id COLLATE "C")` export/snapshot ordering with UTF-8 byte collation) have been cleanly resolved and covered by unit, route, frontend API client, and PostgreSQL 17 integration regression tests.

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.98
- Justification: Every `[G1]`–`[G4]` success criterion, `Non-goals` boundary, `spec.md` Rule 1–5 requirement, and `catalog-repertoire` bounded-context invariant is satisfied, and all four initial review findings (`F1`–`F4`) are resolved with deterministic unit, route, frontend, and PostgreSQL 17 integration coverage and zero introduced defects.
