# Canonical musical repertoire catalog audit

## Scope and target

- Durable source: `database/seeds/musical-repertoire/pafe/`.
- Sink: the local active Festival database's PAFE organization, resolved by
  slug at load time rather than by a stored organization ID.
- Catalog tables only. Registration repertoire snapshots and review records
  remain outside the seed and cleanup scope.

## Canonicalization

- Include a source work only when `flag_for_discussion = false` and
  `is_not_appropriate = false`.
- A work key is lower-cased, trimmed title plus lower-cased, trimmed primary
  contributor. The lowest source work ID is its deterministic representative.
- `all_movements` is registration-time information and was not imported into
  the catalog. Division tags are likewise not catalog classifications.
- Source category labels map only to the PAFE-supported `Concerto`,
  `Ensemble`, and `Solo` classifications.

## Data lineage

| Stage | Works | Contributors | Work contributors | Classifications | Work classifications |
| --- | ---: | ---: | ---: | ---: | ---: |
| Raw source | 139 | 101 | — | — | — |
| Clean source | 132 | 70 | 132 | 3 | 108 |
| Canonical import | 127 | 70 | 127 | 3 | 104 |

82 imported works include an IMSLP URL. All retained work-contributor rows are
position `1` with role `Composer`.

### Excluded source work records

All seven excluded works have `flag_for_discussion = true` and
`discussion_notes = 'TEST ENTRY'`:

- `185` — Duplicate Sonata — Ludwig van Beethoven
- `190` — Missing Rank Sonata — Ludwig van Beethoven
- `203` — Program Piece PT.72.A — Test Composer
- `204` — Program Piece PT.73.A — Test Composer
- `205` — Program Piece PT.74.A — Test Composer
- `206` — Program Piece PT.75.A — Test Composer
- `207` — Program Piece PT.76.A — Test Composer

### Canonical aliases

| Canonical source ID | Alias source ID | Work / contributor | Difference retained only in source audit |
| ---: | ---: | --- | --- |
| 21 | 22 | Violin Concerto No. 2 in D minor, Op. 22 — Henryk Wieniawski | II. Romance / III. Allegro |
| 48 | 119 | Fun Song — Carl Philipp Stamitz | Exact duplicate |
| 215 | 216 | Violin Sonata No. 1 in G minor, BWV 1001 — J. S. Bach | I. Adagio / II. Fuga |
| 262 | 268 | Nocturne in C minor, Op. 48 No. 1 (Lento) — Frédéric Chopin | Exact duplicate |
| 265 | 284 | Histoires — Jacques Ibert | Distinct performed movements |

## Seed and verification

The canonical catalog is now represented by normalized, UTF-8 JSON Lines files
and an auditable manifest. `bun run load-music-rep` validates those files, takes
an advisory lock, resolves the PAFE organization in the active Festival
database, and inserts in one transaction with `ON CONFLICT DO NOTHING`.
It never accesses the legacy `pafe` database or overwrites catalog fields.

`bun run nuke-music-rep` is a developer-only, destructive companion. It deletes
only the stable loader-owned catalog IDs after proving that no historical
snapshot or review refers to them and that no manual catalog row is mixed into
their joins. It must not be used as routine verification.

Committed-seed results:

| Check | Result |
| --- | ---: |
| Contributors | 70 |
| Works | 127 |
| Work-contributor links | 127 |
| Classifications | 3 |
| Work-classification links | 104 |
| Concerto links | 21 |
| Ensemble links | 8 |
| Solo links | 75 |
| Unlinked historical registration snapshots | 2 |
| Cross-organization relationship violations | 0 |
| Duplicate canonical title/contributor pairs | 0 |
| Duplicate normalized contributor/classification names | 0 |
| Works with more than three contributors | 0 |
