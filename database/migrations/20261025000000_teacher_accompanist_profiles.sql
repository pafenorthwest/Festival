BEGIN;

CREATE TABLE IF NOT EXISTS orgs.teacher_profiles (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES orgs.organizations (id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    public_directory_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, customer_id),
    FOREIGN KEY (customer_id, organization_id) REFERENCES orgs.festival_customers (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orgs.teacher_profile_divisions (
    teacher_profile_id TEXT NOT NULL REFERENCES orgs.teacher_profiles (id) ON DELETE CASCADE,
    division_id TEXT NOT NULL REFERENCES orgs.organization_divisions (id) ON DELETE CASCADE,
    PRIMARY KEY (teacher_profile_id, division_id)
);

CREATE TABLE IF NOT EXISTS orgs.accompanist_profiles (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES orgs.organizations (id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    public_directory_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, customer_id),
    FOREIGN KEY (customer_id, organization_id) REFERENCES orgs.festival_customers (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orgs.accompanist_profile_divisions (
    accompanist_profile_id TEXT NOT NULL REFERENCES orgs.accompanist_profiles (id) ON DELETE CASCADE,
    division_id TEXT NOT NULL REFERENCES orgs.organization_divisions (id) ON DELETE CASCADE,
    PRIMARY KEY (accompanist_profile_id, division_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_profiles_org
    ON orgs.teacher_profiles (organization_id);

CREATE INDEX IF NOT EXISTS idx_teacher_profiles_directory
    ON orgs.teacher_profiles (organization_id, public_directory_opt_in, approval_status);

CREATE INDEX IF NOT EXISTS idx_teacher_profile_divisions_division_id
    ON orgs.teacher_profile_divisions (division_id);

CREATE INDEX IF NOT EXISTS idx_accompanist_profiles_org
    ON orgs.accompanist_profiles (organization_id);

CREATE INDEX IF NOT EXISTS idx_accompanist_profiles_directory
    ON orgs.accompanist_profiles (organization_id, public_directory_opt_in, approval_status);

CREATE INDEX IF NOT EXISTS idx_accompanist_profile_divisions_division_id
    ON orgs.accompanist_profile_divisions (division_id);

COMMIT;
