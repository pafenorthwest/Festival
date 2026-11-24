CREATE TABLE IF NOT EXISTS orgs.scheduling_class_rule_revisions (
	organization_id TEXT NOT NULL,
	festival_id TEXT NOT NULL,
	revision INTEGER NOT NULL CHECK (revision > 0),
	rules JSONB NOT NULL CHECK (jsonb_typeof(rules) = 'array'),
	actor_uid TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	PRIMARY KEY (organization_id, festival_id, revision),
	FOREIGN KEY (festival_id, organization_id) REFERENCES orgs.festivals (id, organization_id) ON DELETE CASCADE
);
