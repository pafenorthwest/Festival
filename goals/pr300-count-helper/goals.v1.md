# Shared confirmed-entitlement count

User scope: extract a transaction-aware confirmed-entitlement count helper and use all four existing SQL call sites, leaving attachCart otherwise intact. Run relevant tests and update PR #300.

1. Share tenant/class-scoped confirmed-count SQL and number conversion through one helper accepting the caller's connection or transaction.
2. Preserve existing initialization, transaction/lock boundaries, filters, results, and attachment flow at all four sites.
3. Run PostgreSQL-enabled coverage and static/build checks, independently review, commit/push the existing PR branch, and update PR #300.

Non-goals: further attachment decomposition, line-reader changes, indexing changes, capacity policy changes, deployment or merging into main.
