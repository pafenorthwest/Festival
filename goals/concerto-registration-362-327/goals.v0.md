# Goals Extract
- Task name: concerto-registration-362-327
- Iteration: v0
- State: locked

## Goals

1. Use the repertoire title field to suggest active concertos in signup and both account editing routes. Support keyboard and screen-reader navigation and allow families to enter any piece manually.
2. Allow unlinked concerto repertoire through checkout and metadata updates. Preserve valid existing links and validate supplied IDs against the registration's organization and concerto classification.
3. Rank exact titles and title prefixes first, retain case-insensitive title fragment and composer matches, and cap authenticated registration suggestions at 100.

## Non-goals

- Catalog administration, editing-cutoff changes, and updates to other account workflows.

## Success criteria

- [G1] Debounced search cancels superseded work and ignores stale results. Suggestions show title and composer. Manual entry carries the typed title and works with matches, no matches, and search errors. Multiple pieces retain their own selection.
- [G2] Manual pieces save and reload without catalog IDs. Valid catalog links survive edits. Inactive, unknown, cross-organization, malformed, and non-concerto links are rejected for concerto classes. Piece fields, durations, limits, and editing cutoffs continue to be enforced. Orders uses the registration entitlement ID and festival short name for metadata saves.
- [G3] Ranking is deterministic, filtering precedes the 100-result limit, and the caller's organization and festival remain authorized. Compare PostgreSQL plans for the old and new query on the PAFE seed and a larger catalog.
