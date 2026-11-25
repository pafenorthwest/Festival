BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('orgs', 0));

-- Normalize pending invite emails and remove older duplicate pending invites
-- before adding the partial unique index on (organization_id, lower(email)).
UPDATE orgs.invites
SET email = lower(btrim(email))
WHERE accepted_at IS NULL
  AND email <> lower(btrim(email));

DELETE FROM orgs.invites older
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, lower(email)
        ORDER BY created_at DESC, id DESC
      ) AS row_num
    FROM orgs.invites
    WHERE accepted_at IS NULL
  ) ranked
  WHERE ranked.row_num > 1
) duplicates
WHERE older.id = duplicates.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_pending_org_email_lower
  ON orgs.invites USING btree (organization_id, lower(email))
  WHERE (accepted_at IS NULL);

COMMIT;
