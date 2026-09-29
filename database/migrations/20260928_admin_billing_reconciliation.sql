BEGIN;

CREATE TABLE IF NOT EXISTS orgs.credit_balances (
    organization_id uuid NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    customer_id text NOT NULL,
    balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    currency_code text NOT NULL DEFAULT 'USD',
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, customer_id)
);

CREATE TABLE IF NOT EXISTS orgs.billing_adjustments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    customer_id text NOT NULL,
    admin_user_id text NOT NULL,
    adjustment_type text NOT NULL CHECK (adjustment_type IN ('refund', 'credit_issue', 'credit_apply', 'manual_charge', 'write_off')),
    amount_cents integer NOT NULL CHECK (amount_cents > 0),
    currency_code text NOT NULL DEFAULT 'USD',
    reason text NOT NULL,
    reference_type text,
    reference_id text,
    approved_decision_id text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (organization_id, reference_type, reference_id, adjustment_type)
);

CREATE TABLE IF NOT EXISTS orgs.billing_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    customer_id text NOT NULL,
    entry_type text NOT NULL CHECK (entry_type IN ('credit', 'debit', 'adjustment')),
    amount_cents integer NOT NULL,
    direction text NOT NULL CHECK (direction IN ('inflow', 'outflow')),
    balance_after_cents integer NOT NULL CHECK (balance_after_cents >= 0),
    currency_code text NOT NULL DEFAULT 'USD',
    adjustment_id uuid REFERENCES orgs.billing_adjustments(id) ON DELETE SET NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_org_customer_created
    ON orgs.billing_ledger (organization_id, customer_id, created_at);

CREATE TABLE IF NOT EXISTS orgs.invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    customer_id text NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'cancelled', 'written_off')),
    total_cents integer NOT NULL DEFAULT 0,
    currency_code text NOT NULL DEFAULT 'USD',
    due_date date,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS orgs.invoice_line_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL REFERENCES orgs.invoices(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    description text NOT NULL,
    amount_cents integer NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    reference_type text,
    reference_id text
);

COMMIT;
