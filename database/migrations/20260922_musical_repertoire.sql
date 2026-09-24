-- Organization-scoped musical repertoire catalog and immutable registration snapshots.
--
-- This is a one-shot migration. Run it once against a database that has not
-- received this repertoire schema; do not use it to repair or upgrade a partial
-- development schema. The legacy JSON is retained as an audit payload; the rows
-- below become the queryable representation.
--
-- Run database/migrations/20260922_musical_repertoire.concurrent-index.sql
-- first, outside a transaction. It creates the unique index that this
-- transactional phase attaches as a constraint. See migrations/README.md for
-- the required deployment and retry procedure.

BEGIN;

CREATE TABLE orgs.repertoire_contributors (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    display_name text NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name text NOT NULL CHECK (btrim(normalized_name) <> ''),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id),
    UNIQUE (organization_id, normalized_name)
);

CREATE TABLE orgs.repertoire_works (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    display_title text NOT NULL CHECK (btrim(display_title) <> ''),
    normalized_title text NOT NULL CHECK (btrim(normalized_title) <> ''),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id)
);

CREATE TABLE orgs.repertoire_classifications (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    display_name text NOT NULL CHECK (btrim(display_name) <> ''),
    normalized_name text NOT NULL CHECK (btrim(normalized_name) <> ''),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id),
    UNIQUE (organization_id, normalized_name)
);

CREATE TABLE orgs.repertoire_work_contributors (
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    repertoire_work_id text NOT NULL,
    repertoire_contributor_id text NOT NULL,
    contributor_role text NOT NULL CHECK (contributor_role IN ('Composer', 'Copyist', 'Editor', 'Arranger', 'Transcriber', 'Realizer', 'Orchestrator')),
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
    PRIMARY KEY (repertoire_work_id, position),
    UNIQUE (repertoire_work_id, repertoire_contributor_id, contributor_role),
    FOREIGN KEY (repertoire_work_id, organization_id)
        REFERENCES orgs.repertoire_works(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (repertoire_contributor_id, organization_id)
        REFERENCES orgs.repertoire_contributors(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE orgs.repertoire_work_classifications (
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    repertoire_work_id text NOT NULL,
    repertoire_classification_id text NOT NULL,
    PRIMARY KEY (repertoire_work_id, repertoire_classification_id),
    FOREIGN KEY (repertoire_work_id, organization_id)
        REFERENCES orgs.repertoire_works(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (repertoire_classification_id, organization_id)
        REFERENCES orgs.repertoire_classifications(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE orgs.registration_repertoire_items (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    registration_metadata_id text NOT NULL,
    repertoire_work_id text,
    title_snapshot text NOT NULL CHECK (btrim(title_snapshot) <> ''),
    performed_movement_text text,
    duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
    display_order smallint NOT NULL CHECK (display_order >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, organization_id),
    UNIQUE (registration_metadata_id, organization_id, display_order),
    FOREIGN KEY (registration_metadata_id, organization_id)
        REFERENCES orgs.registration_metadata(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (repertoire_work_id, organization_id)
        REFERENCES orgs.repertoire_works(id, organization_id) ON DELETE SET NULL (repertoire_work_id)
);

CREATE TABLE orgs.registration_repertoire_item_contributors (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    registration_repertoire_item_id text NOT NULL,
    repertoire_contributor_id text,
    display_name_snapshot text NOT NULL CHECK (btrim(display_name_snapshot) <> ''),
    contributor_role text NOT NULL CHECK (contributor_role IN ('Composer', 'Copyist', 'Editor', 'Arranger', 'Transcriber', 'Realizer', 'Orchestrator')),
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
    UNIQUE (registration_repertoire_item_id, position),
    FOREIGN KEY (registration_repertoire_item_id, organization_id)
        REFERENCES orgs.registration_repertoire_items(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (repertoire_contributor_id, organization_id)
        REFERENCES orgs.repertoire_contributors(id, organization_id) ON DELETE SET NULL (repertoire_contributor_id)
);

CREATE INDEX registration_repertoire_item_contributors_contributor_idx
    ON orgs.registration_repertoire_item_contributors (organization_id, repertoire_contributor_id)
    WHERE repertoire_contributor_id IS NOT NULL;
CREATE INDEX registration_repertoire_items_work_idx
    ON orgs.registration_repertoire_items (organization_id, repertoire_work_id)
    WHERE repertoire_work_id IS NOT NULL;
CREATE INDEX repertoire_work_classifications_classification_idx
    ON orgs.repertoire_work_classifications (organization_id, repertoire_classification_id, repertoire_work_id);
CREATE INDEX repertoire_work_contributors_contributor_idx
    ON orgs.repertoire_work_contributors (organization_id, repertoire_contributor_id);
CREATE INDEX repertoire_works_organization_title_idx
    ON orgs.repertoire_works (organization_id, normalized_title);

-- JSON entries submitted by the MVP are valid title/composer/duration objects.
-- Import a metadata record only when every piece is valid and its array fits
-- the SMALLINT display_order column. This prevents a fractional or non-positive
-- historic duration, or an oversized array, from producing a partial relational
-- snapshot; the original JSON remains available for audit.
-- Deterministic ids preserve a stable relationship to the original JSON entries.
WITH valid_legacy_registrations AS (
    SELECT metadata.id, metadata.organization_id, metadata.repertoire_json
    FROM orgs.registration_metadata AS metadata
    WHERE jsonb_typeof(metadata.repertoire_json) = 'array'
      AND jsonb_array_length(metadata.repertoire_json) > 0
      AND jsonb_array_length(metadata.repertoire_json) <= 32767
      AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(metadata.repertoire_json) AS candidate(value)
          WHERE jsonb_typeof(candidate.value) <> 'object'
             OR btrim(COALESCE(candidate.value ->> 'title', '')) = ''
             OR jsonb_typeof(candidate.value -> 'durationSeconds') <> 'number'
             OR NOT CASE
                 WHEN COALESCE(candidate.value ->> 'durationSeconds', '') ~ '^[1-9][0-9]*$'
                     THEN (candidate.value ->> 'durationSeconds')::numeric <= 2147483647
                 ELSE false
             END
      )
), legacy_pieces AS (
    SELECT
        metadata.id AS registration_metadata_id,
        metadata.organization_id,
        piece.ordinality::smallint AS display_order,
        btrim(piece.value ->> 'title') AS title_snapshot,
        NULLIF(btrim(piece.value ->> 'movement'), '') AS performed_movement_text,
        (piece.value ->> 'durationSeconds')::integer AS duration_seconds,
        COALESCE(
            NULLIF(btrim(piece.value ->> 'composer'), ''),
            '(composer not supplied)'
        ) AS composer_snapshot
    FROM valid_legacy_registrations AS metadata
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(metadata.repertoire_json) = 'array'
            THEN metadata.repertoire_json
            ELSE '[]'::jsonb
        END
    ) WITH ORDINALITY AS piece(value, ordinality)
), inserted_items AS (
    INSERT INTO orgs.registration_repertoire_items (
        id, organization_id, registration_metadata_id, repertoire_work_id,
        title_snapshot, performed_movement_text, duration_seconds, display_order
    )
    SELECT
        'legacy-repertoire-item-' || md5(registration_metadata_id || ':' || display_order::text),
        organization_id,
        registration_metadata_id,
        NULL,
        title_snapshot,
        performed_movement_text,
        duration_seconds,
        display_order
    FROM legacy_pieces
    RETURNING id, organization_id, registration_metadata_id, display_order
)
INSERT INTO orgs.registration_repertoire_item_contributors (
    id, organization_id, registration_repertoire_item_id, repertoire_contributor_id,
    display_name_snapshot, contributor_role, position
)
SELECT
    'legacy-repertoire-contributor-' || md5(items.id || ':1'),
    pieces.organization_id,
    items.id,
    NULL,
    pieces.composer_snapshot,
    'Composer',
    1
FROM legacy_pieces AS pieces
JOIN inserted_items AS items
  ON items.organization_id = pieces.organization_id
 AND items.registration_metadata_id = pieces.registration_metadata_id
 AND items.display_order = pieces.display_order;

-- Attaching an existing index needs a brief DDL lock. Keep it last: an
-- ACCESS EXCLUSIVE lock here must not be held while the tables are created and
-- historic rows are backfilled. A timeout rolls this whole phase back and
-- leaves the already-valid concurrent index available for a phase-two retry.
SET LOCAL lock_timeout = '5s';

ALTER TABLE orgs.registration_metadata
    ADD CONSTRAINT registration_metadata_id_organization_id_key
    UNIQUE USING INDEX registration_metadata_id_organization_id_key;

COMMIT;
