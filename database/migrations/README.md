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
