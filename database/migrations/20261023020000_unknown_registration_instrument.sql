BEGIN;

-- Older Bun bindings encoded snapshot objects as JSON strings. Recover only
-- valid, representable JSON objects; leave unrelated strings and scalars alone.
UPDATE orgs.registration_metadata
SET registration_snapshot = CASE
    WHEN (registration_snapshot #>> '{}') IS JSON OBJECT
         AND pg_input_is_valid(registration_snapshot #>> '{}', 'jsonb')
    THEN (registration_snapshot #>> '{}')::jsonb
    ELSE registration_snapshot
END
WHERE jsonb_typeof(registration_snapshot) = 'string';

-- Preserve absent historical selections and every other original snapshot field.
UPDATE orgs.registration_metadata
SET registration_snapshot = jsonb_set(registration_snapshot, '{instrument}', '"unknown"'::jsonb, true)
WHERE jsonb_typeof(registration_snapshot) = 'object'
  AND (NOT registration_snapshot ? 'instrument'
       OR registration_snapshot -> 'instrument' = 'null'::jsonb);

COMMIT;
