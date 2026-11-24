CREATE TABLE IF NOT EXISTS orgs.scheduling_config_revisions (
	organization_id TEXT NOT NULL,
	festival_id TEXT NOT NULL,
	revision INTEGER NOT NULL CHECK (revision > 0),
	config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
	actor_uid TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	PRIMARY KEY (organization_id, festival_id, revision),
	FOREIGN KEY (festival_id, organization_id) REFERENCES orgs.festivals (id, organization_id) ON DELETE CASCADE
);

DO $$
BEGIN
	IF to_regclass('orgs.scheduling_class_rule_revisions') IS NOT NULL THEN
		INSERT INTO orgs.scheduling_config_revisions (
			organization_id,
			festival_id,
			revision,
			config,
			actor_uid,
			created_at
		)
		SELECT
			organization_id,
			festival_id,
			revision,
			jsonb_build_object(
				'festivalDates', '[]'::jsonb,
				'wednesdayDeadlineDate', NULL,
				'adjudicators', '[]'::jsonb,
				'roomWindows', '[]'::jsonb,
				'classRules', rules,
				'roomCompatibilityRules', '[]'::jsonb,
				'betweenClassGapMinutes', 7,
				'accompanistGapMinutes', 7,
				'lunchWindowStart', '11:45',
				'lunchWindowEnd', '12:30',
				'morningBreakWindowStart', '09:45',
				'morningBreakWindowEnd', '10:30',
				'afternoonBreakWindowStart', '14:30',
				'afternoonBreakWindowEnd', '15:30'
			),
			actor_uid,
			created_at
		FROM orgs.scheduling_class_rule_revisions
		ON CONFLICT (organization_id, festival_id, revision) DO NOTHING;

		DROP TABLE orgs.scheduling_class_rule_revisions;
	END IF;
END $$;
