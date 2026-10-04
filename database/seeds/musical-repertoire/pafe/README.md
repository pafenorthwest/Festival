# PAFE canonical musical-repertoire seed

This directory is the repository-owned, UTF-8 source for the PAFE starter
catalog. It is a static export of the canonical catalog already loaded into the
local Festival database; loading it never reads the legacy PAFE database.

The loader reads manifest.json and the five newline-delimited JSON files, then
writes the records to the PAFE organization in the active Festival database.
The seed records intentionally contain no organization ID. The loader supplies
the organization context after resolving manifest.organizationSlug.

## Files

- contributors.jsonl — { id, displayName, normalizedName }
- works.jsonl — { id, displayTitle, normalizedTitle, imslpUrl }
- classifications.jsonl — { id, displayName, normalizedName }
- work-contributors.jsonl — { workId, contributorId, contributorRole, position }
- work-classifications.jsonl — { workId, classificationId }

IDs are stable catalog IDs retained from the original bootstrap. References in
the two link files are to those IDs. Null IMSLP URLs are intentional and must
not be replaced with empty strings.

## Canonicalization and lineage

The original source excluded seven records flagged for discussion as test
entries. It de-duplicated five source records by normalized title and primary
contributor, retaining the lowest source work ID. The specific exclusions and
aliases are recorded in manifest.json so the decisions remain auditable after
legacy PAFE access is removed.

Classifications are restricted to Concerto, Ensemble, and Solo.
Performed-movement text and division tags are registration-time information and
are deliberately absent from this catalog.

## Expected catalog

The manifest declares the required post-load counts: 70 contributors, 127
works, 3 classifications, 127 work-contributor links, 104
work-classification links, and 82 non-null IMSLP URLs. A loader must validate
these counts and the cross-file IDs before committing its transaction.

The catalog model and the required separation between catalog records and
historical registration snapshots are defined in specs/MUSICAL-REPERTOIRE.md.
