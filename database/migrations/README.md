# PostgreSQL Migration Protocol

## Current schema snapshot

[`database/postgres17-schema.sql`](../postgres17-schema.sql) is a generated,
schema-only PostgreSQL 17 snapshot of an empty database after running the full
[`initializePostgresSchema`](../../packages/backend/src/repo/postgres-schema.ts)
runtime initializer for `orgs`. Refresh it from a freshly initialized database
when the runtime schema changes. It contains the schema needed to bootstrap a
fresh database, without application data.

## Versioned migrations

Keep one-shot upgrade scripts for existing databases in this directory using
timestamped filenames.

```
YYYYMMDDHHMMSS_<description>.sql
```

Apply the migrations needed to bring an existing database up to date. A fresh
database restored from the current snapshot or created by the current runtime
initializer already has the corresponding schema changes.

## PAFE concerto catalog

After creating the `pafe` organization, run this data migration from the
repository root with PostgreSQL 17 `psql` and the target connection string.

```powershell
psql -X --dbname $env:DATABASE_URL --file database/migrations/20261109000000_load_pafe_concertos.sql
```

The [UTF-8 CSV](../bootstrap/pafe-concertos.csv) has the fixed header
`work_id,title,composer,imslp_url`. It contains the 25 work IDs from the PAFE
database export whose class names start with `SC`, `CC`, `PC`, or `WC`. IDs
use the `pafe-bootstrap-work-` prefix. Source IDs 21 and 22 are retained as
separate entries with identical titles and composers.

The migration replaces PAFE's Concerto catalog in one transaction. Works
omitted from the file lose their Concerto classification. Their catalog
records, other classifications, and historical registration and review
links are retained.

The import prefers an existing work with the same source ID. When the title
and primary composer identify a single source entry, the import can also
reuse an existing work with those values. It applies the source title and
score URL and makes the imported works available for Concerto registration.
New works retain their source IDs. The migration can be run again and rejects
an empty source, ambiguous matches, or conflicting source IDs.
