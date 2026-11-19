# PostgreSQL Migration Protocol

## Current schema snapshot

[`database/postgres17-schema.sql`](../postgres17-schema.sql) is a generated,
schema-only PostgreSQL 17 snapshot of the canonical
[`orgs` schema](../../packages/backend/src/repo/postgres-schema.ts).
Refresh it from a freshly initialized PostgreSQL 17 database when the canonical
schema changes.

The local and cloud Docker Compose stacks mount this snapshot as
`/docker-entrypoint-initdb.d/01-bootstrap.sql`. The PostgreSQL entrypoint
loads it when initializing a new data directory. It skips initialization scripts
on retained volumes, including databases that lack a migration ledger.

## Versioned migrations

Keep one-shot upgrade scripts for existing databases in this directory using
timestamped filenames.

```
YYYYMMDDHHMMSS_<description>.sql
```

Applied migrations are recorded in `orgs.schema_migrations` (`version`,
`filename`, `checksum`, `applied_at`). Run pending migrations in order with:

```powershell
bun run migrate
```

[`scripts/migrate.ts`](../../scripts/migrate.ts) acquires a PostgreSQL advisory
lock, creates `orgs.schema_migrations` if missing, verifies SHA-256 checksums
for previously applied files, and applies each pending `.sql` file in its own
transaction. The snapshot contains the current schema and an empty
`orgs.schema_migrations` table. Run `bun run migrate` against the bootstrapped
database before adding application data to apply pending files and populate the
ledger. Continue using `bun run migrate` to upgrade retained databases.

## PAFE concerto catalog

After creating the `pafe` organization, run this manual `\copy` bootstrap seed
from the repository root with PostgreSQL 17 `psql` and the target connection
string (it is kept outside `database/migrations/` so `bun run migrate` does not
execute `psql` meta-commands).

```powershell
psql -X --dbname $env:DATABASE_URL --file database/bootstrap/20261109000000_load_pafe_concertos.sql
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
