# PostgreSQL migration deployment

Most Festival schema setup is the canonical empty-database initializer. Files
in this directory are exceptional, one-shot migrations for an already-populated
database; they are not run by application startup.

## 20260922 musical repertoire

This migration deliberately has two phases because PostgreSQL prohibits
`CREATE UNIQUE INDEX CONCURRENTLY` inside a transaction block. Run the commands
with `psql` (or an equivalent migration facility that preserves these same
transaction boundaries):

```sh
psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" \\
  -f database/migrations/20260922_musical_repertoire.concurrent-index.sql
psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" \\
  -f database/migrations/20260922_musical_repertoire.sql
```

Phase one may take time, but does not block ordinary inserts, updates, or
deletes. It performs two table scans and can still fail—for example, if the
existing data violates the new uniqueness rule. Do not run it through a runner
that applies an outer `BEGIN`/`COMMIT`.

Phase two is internally transactional. It backfills first, then its five-second
`lock_timeout` limits the lock wait while PostgreSQL attaches the valid index as
a unique constraint. This keeps the `ALTER TABLE` lock out of the backfill.
If phase two times out or any statement in it fails, it rolls back in full; do
not rerun phase one. After resolving the contention or error, rerun phase two
only. Once phase two commits, record the migration as applied and do not rerun
either file.

If phase one fails, inspect the index before retrying:

```sql
SELECT index_name, index.indisvalid, index.indisready
FROM (VALUES (to_regclass(
  'orgs.registration_metadata_id_organization_id_key'
))) AS expected(index_name)
LEFT JOIN pg_index AS index ON index.indexrelid = expected.index_name;
```

If that query reports an invalid index, remove it outside a transaction and
then retry phase one:

```sql
DROP INDEX CONCURRENTLY orgs.registration_metadata_id_organization_id_key;
```

If the index is valid, do not drop it: proceed with phase two. A failed unique
concurrent build can begin enforcing uniqueness before PostgreSQL marks the
index valid, so resolve the conflicting writes/data before retrying.
