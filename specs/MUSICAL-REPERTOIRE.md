## Festival Software Spec: Musical Repertoire

### 1. Purpose

This specification defines the organization-scoped repertoire catalog and the
registration-time record of musical pieces. It replaces a JSON-only repertoire
model as the authoritative representation of submitted repertoire while
preserving the original text supplied by registrants.

The design supports:

* consistent selection of composers and works through a catalog;
* different catalog rules and terminology for each organization;
* reuse of works across years;
* classifications such as Concerto, Ensemble, and Sonata;
* later class eligibility rules based on those classifications; and
* historically accurate registrations and programs after catalog cleanup.

### 2. Scope and principles

The catalog is owned by an organization. Records must not be shared across
organizations at runtime. A future starter catalog is implemented by copying or
importing seed records into an organization's own catalog, rather than by
making a global catalog the source of truth.

Catalog data represents the current, curated description of a work. A
registration represents what was submitted at a particular time. Updating,
merging, renaming, or reclassifying a catalog record must never silently alter
the historical registration or a published program.

There is no staff approval workflow for ordinary unknown composers or works.
The registration experience should strongly encourage catalog selection through
typeahead, filtering, and dropdown choices, while still permitting free-text
entries where the relevant class permits them.

### 3. Catalog model

All catalog tables include `organization_id`, have organization-bound foreign
keys, and are constrained so a child cannot reference a record from another
organization.

#### 3.1 Contributors

`repertoire_contributors` is the canonical list of people associated with
works. It contains at least a display name and optionally normalized search
fields or aliases. It is the preferred source for composer selection.

`repertoire_works` represents a distinct musical work as it is programmed by
the organization. A different arrangement, transcription, edition, or
instrumentation is a different work record, even if it derives from the same
underlying composition.

`repertoire_work_contributors` joins contributors to works. It stores a role
and an ordinal position. A work may have up to three contributor rows. The
permitted role values are:

* Composer
* Copyist
* Editor
* Arranger
* Transcriber
* Realizer
* Orchestrator

The role is a property of a contributor's relationship to a work; it is not a
property of the contributor globally.

#### 3.2 Classifications

`repertoire_classifications` is an organization-owned controlled vocabulary.
Examples include `concerto`, `ensemble`, and `sonata`.

`repertoire_work_classifications` joins works to one or more classifications.
Classifications describe the entire musical work, not a particular performance
or a movement. They must be modeled as records rather than a PostgreSQL enum so
each organization can evolve its own vocabulary and rules.

#### 3.3 Movements

Movement guidance varies by organization, work, arrangement, and transcription
and is not modeled as a canonical movement catalog in this phase. The performed
movement or excerpt is registration-time free text.

### 4. Registration repertoire snapshot

`registration_repertoire_items` contains one row per piece submitted with a
registration. It is linked to the registration record (currently represented by
`registration_metadata`), has a display order, and contains:

* nullable `catalog_work_id` pointing to the selected organization work;
* the submitted/display work title snapshot;
* `performed_movement_text`, free text describing the movement or excerpt the
  performer intends to perform;
* duration in positive whole seconds (fractional seconds are not permitted);
* timestamps and organization scope.

`registration_repertoire_item_contributors` contains the immutable submitted
contributor snapshots for each registration item. It includes the contributor
display name, role, and ordinal position, and may retain a nullable link to the
catalog contributor used at submission time. It also permits up to three
contributors per registration item.

When a registrant selects a catalog work, the checkout flow creates the
registration item and copies its title and contributor display values into the
snapshot rows. When the registrant enters a work or composer as free text, the
same snapshot structure is populated without catalog references. The snapshot,
not the current catalog record, is the source for historic registration and
program display.

### 5. Future eligibility: Concerto requirement

Tracked separately as issue #197: when a class requires a concerto, checkout
must require a selected catalog work classified as `concerto`. A free-text or
unclassified work cannot satisfy that requirement.

Classes without that requirement continue to allow free-text repertoire. This
keeps the normal registration flow flexible while ensuring an automated rule is
based on governed catalog data, not a registrant's unverified label.

The anticipated policy table associates a festival class configuration with one
or more required repertoire classifications. It supports eligibility checks
without putting class-specific policy on a reusable work.

### 6. Exceptions and audit trail

Division chairs and organization administrators may make future eligibility
decisions, including exceptions to a classification requirement. Such decisions
are recorded in append-only
`registration_repertoire_validation_events`, rather than overwriting a prior
status.

Each event includes the organization, registration repertoire item, applicable
class configuration, event type, timestamp, actor (nullable for automated
checks), reason, and a JSON policy snapshot. Event types include at least
`automated_pass`, `automated_fail`, `override_approved`, and `override_denied`.
The effective decision is derived from the most recent applicable event; the
event history provides who made an exception, why, when, and the rule evaluated
at the time.

### 7. Migration and compatibility

`registration_metadata.repertoire_json` is not the long-term authoritative
format. During migration it may be retained as an immutable intake/audit
payload and as a backwards-compatible read source for older registrations.

The migration creates registration-item and contributor-snapshot rows from
existing JSON values, retaining their original wording. A historic entry that
omitted a composer receives the explicit snapshot placeholder `(composer not
supplied)` while the original JSON remains available for audit. Catalog links
are nullable: historical entries are not forcibly deduplicated or matched to a
catalog work. After all supported reads use the relational snapshot tables,
new checkout writes populate those tables transactionally. The JSON field may
be removed only after a separate compatibility and retention review.

### 8. Constraints and indexes

Foreign keys protect organization ownership and registration/catalog links.
Unique constraints should include organization scope for catalog identity where
appropriate. Child foreign-key columns must be indexed when parent deletion or
key updates are supported. Registration-item retrieval is indexed by its
registration ID and display order; catalog search is indexed by organization
and normalized contributor/work display fields.

The model preserves the existing checkout lifecycle: a registration metadata
row may be created before the eventual class entitlement is linked. Repertoire
snapshot rows are associated with that registration record and remain intact as
the entitlement is finalized.
