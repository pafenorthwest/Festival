BEGIN;

CREATE TABLE IF NOT EXISTS orgs.rooms (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    festival_id text NOT NULL REFERENCES orgs.festivals(id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (festival_id, organization_id) REFERENCES orgs.festivals(id, organization_id) ON DELETE CASCADE,
    UNIQUE (id, festival_id, organization_id)
);

CREATE TABLE IF NOT EXISTS orgs.room_piano_configurations (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    festival_id text NOT NULL REFERENCES orgs.festivals(id) ON DELETE CASCADE,
    room_id text NOT NULL,
    piano_type text NOT NULL CHECK (piano_type IN ('upright', 'grand')),
    count integer NOT NULL CHECK (count > 0),
    FOREIGN KEY (festival_id, organization_id) REFERENCES orgs.festivals(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (room_id, festival_id, organization_id) REFERENCES orgs.rooms(id, festival_id, organization_id) ON DELETE CASCADE,
    UNIQUE (room_id, piano_type)
);

CREATE INDEX IF NOT EXISTS rooms_org_festival_idx
    ON orgs.rooms (organization_id, festival_id);

CREATE INDEX IF NOT EXISTS room_piano_configurations_room_idx
    ON orgs.room_piano_configurations (room_id);

COMMIT;
