# Changelog

## 0.2.0

- Rebuilt the disposable PostgreSQL test environment as `festival_sepv2_db` on
  PostgreSQL 17.
- This is a clean-slate operational break: existing user and application data
  is intentionally not migrated, backfilled, or preserved.
- Root and workspace packages are versioned together at `0.2.0`.
