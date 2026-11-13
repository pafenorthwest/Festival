\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE concerto_seed (
    work_id text PRIMARY KEY CHECK (work_id ~ '^pafe-bootstrap-work-[0-9]+$'),
    title text NOT NULL CHECK (title = btrim(title) AND title <> ''),
    composer text NOT NULL CHECK (composer = btrim(composer) AND composer <> ''),
    imslp_url text
) ON COMMIT DROP;

\copy concerto_seed (work_id, title, composer, imslp_url) FROM 'database/bootstrap/pafe-concertos.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8', FORCE_NULL (imslp_url))

CREATE TEMP TABLE concerto_seed_target ON COMMIT DROP AS
SELECT id AS organization_id FROM orgs.organizations WHERE slug = 'pafe';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM concerto_seed_target) THEN
        RAISE EXCEPTION 'Create the pafe organization before loading its concerto catalog';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM concerto_seed) THEN
        RAISE EXCEPTION 'The PAFE concerto seed is empty';
    END IF;
END $$;

-- Keep the catalog stable while resolving identities and replacing membership.
LOCK TABLE orgs.repertoire_contributors, orgs.repertoire_works,
    orgs.repertoire_work_contributors, orgs.repertoire_classifications,
    orgs.repertoire_work_classifications IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE concerto_seed_matches ON COMMIT DROP AS
WITH seed_identities AS (
    SELECT *, count(*) OVER (PARTITION BY lower(title), lower(composer)) AS identity_count
    FROM concerto_seed
)
SELECT seed.work_id, seed.title, seed.composer, seed.imslp_url,
    target.organization_id, matched.id AS existing_work_id
FROM seed_identities AS seed
CROSS JOIN concerto_seed_target AS target
LEFT JOIN LATERAL (
    SELECT work.id
    FROM orgs.repertoire_works AS work
    JOIN LATERAL (
        SELECT credit.repertoire_contributor_id
        FROM orgs.repertoire_work_contributors AS credit
        WHERE credit.organization_id = work.organization_id
          AND credit.repertoire_work_id = work.id
          AND credit.contributor_role = 'Composer'
        ORDER BY credit.position
        LIMIT 1
    ) AS primary_credit ON true
    JOIN orgs.repertoire_contributors AS contributor
      ON contributor.organization_id = work.organization_id
     AND contributor.id = primary_credit.repertoire_contributor_id
    WHERE work.organization_id = target.organization_id
      AND work.normalized_title = lower(seed.title)
      AND contributor.normalized_name = lower(seed.composer)
      -- Repeated source title/composer pairs keep their distinct source IDs.
      AND (seed.identity_count = 1 OR work.id = seed.work_id)
    ORDER BY (work.id = seed.work_id) DESC
    FETCH FIRST ROW WITH TIES
) AS matched ON true;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM concerto_seed_matches GROUP BY work_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Multiple PAFE catalog works match a seed title and composer';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM concerto_seed_matches AS seed
        JOIN orgs.repertoire_works AS work ON work.id = seed.work_id
        WHERE work.id IS DISTINCT FROM seed.existing_work_id
    ) THEN
        RAISE EXCEPTION 'A PAFE seed work ID already belongs to a different catalog work';
    END IF;
END $$;

INSERT INTO orgs.repertoire_contributors (id, organization_id, display_name, normalized_name)
SELECT gen_random_uuid()::text, organization_id, composer, lower(composer)
FROM (
    SELECT DISTINCT organization_id, composer
    FROM concerto_seed_matches WHERE existing_work_id IS NULL
) AS composers
ON CONFLICT (organization_id, normalized_name) DO NOTHING;

INSERT INTO orgs.repertoire_works (id, organization_id, display_title, normalized_title, imslp_url)
SELECT work_id, organization_id, title, lower(title), imslp_url
FROM concerto_seed_matches WHERE existing_work_id IS NULL;

UPDATE orgs.repertoire_works AS work
SET display_title = seed.title, imslp_url = seed.imslp_url,
    is_active = true, updated_at = clock_timestamp()
FROM concerto_seed_matches AS seed
WHERE work.organization_id = seed.organization_id
  AND work.id = seed.existing_work_id
  AND (work.display_title, work.imslp_url, work.is_active)
      IS DISTINCT FROM (seed.title, seed.imslp_url, true);

INSERT INTO orgs.repertoire_work_contributors
    (organization_id, repertoire_work_id, repertoire_contributor_id, contributor_role, position)
SELECT seed.organization_id, seed.work_id, contributor.id, 'Composer', 1
FROM concerto_seed_matches AS seed
JOIN orgs.repertoire_contributors AS contributor
  ON contributor.organization_id = seed.organization_id
 AND contributor.normalized_name = lower(seed.composer)
WHERE seed.existing_work_id IS NULL;

INSERT INTO orgs.repertoire_classifications AS classification
    (id, organization_id, display_name, normalized_name)
SELECT 'pafe-bootstrap-classification-concerto', organization_id, 'Concerto', 'concerto'
FROM concerto_seed_target
ON CONFLICT (organization_id, normalized_name) DO UPDATE
SET is_active = true, updated_at = clock_timestamp()
WHERE NOT classification.is_active;

-- Remove omitted works from concerto search without deleting their catalog records.
DELETE FROM orgs.repertoire_work_classifications AS link
USING concerto_seed_target AS target, orgs.repertoire_classifications AS classification
WHERE link.organization_id = target.organization_id
  AND classification.organization_id = link.organization_id
  AND classification.id = link.repertoire_classification_id
  AND lower(trim(classification.normalized_name)) = 'concerto'
  AND NOT EXISTS (
      SELECT 1 FROM concerto_seed_matches AS seed
      WHERE coalesce(seed.existing_work_id, seed.work_id) = link.repertoire_work_id
  );

INSERT INTO orgs.repertoire_work_classifications
    (organization_id, repertoire_work_id, repertoire_classification_id)
SELECT seed.organization_id, coalesce(seed.existing_work_id, seed.work_id), classification.id
FROM concerto_seed_matches AS seed
JOIN orgs.repertoire_classifications AS classification
  ON classification.organization_id = seed.organization_id
 AND classification.normalized_name = 'concerto'
ON CONFLICT (repertoire_work_id, repertoire_classification_id) DO NOTHING;

COMMIT;
