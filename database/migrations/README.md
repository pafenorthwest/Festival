# PostgreSQL Migration Protocol

## Immutable Baseline

`database/postgres17-schema.sql` serves as the canonical v0.0.0 baseline. It represents the complete and consolidated empty-database schema definition for application bootstrapping and testing.

## Sequential Versioned Migrations

All future schema changes following v0.0.0 will be placed in `database/migrations/` using sequential, timestamped naming:

```
YYYYMMDDHHMMSS_<description>.sql
```

Migrations in this directory are one-shot scripts designed for deployment against existing populated databases.

## Interim Migrations Retirement

All pre-release interim migrations (dated September–October 2026) were retired and removed as part of the v0.0.0 schema consolidation.
