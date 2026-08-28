-- ChallengeAid Africa — Disbursement & Reconciliation System
-- Schema v1 (Phase 1 MVP), matches Section 9 of the design doc.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Enumerations
-- ============================================================

CREATE TYPE user_role AS ENUM (
  'staff',
  'finance',
  'director',
  'trustee',
  'admin'
);

CREATE TYPE payment_type AS ENUM (
  'coach_fee',
  'foodstuffs',
  'supplies',
  'cleaning',
  'other'
);

CREATE TYPE request_status AS ENUM (
  'draft',
  'submitted',
  'finance_approved',
  'director_approved',
  'trustee_approved',   -- all 4 of 4 signed
  'rejected',
  'more_info_requested',
  'disbursed',
  'reconciled'
);

CREATE TYPE approval_stage AS ENUM (
  'finance',
  'director',
  'trustee'
);

CREATE TYPE approval_decision AS ENUM (
  'approved',
  'rejected',
  'more_info_requested'
);

CREATE TYPE payment_method AS ENUM (
  'cooperative_bank_transfer',
  'mco_op_cash'
);

CREATE TYPE document_type AS ENUM (
  'signed_payment_form',
  'coach_acknowledgement',
  'vendor_receipt',
  'delivery_note',
  'supervisor_confirmation',
  'service_confirmation',
  'other_evidence'
);

-- ============================================================
-- Core entities
-- ============================================================

CREATE TABLE centres (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  location      TEXT NOT NULL, -- e.g. 'Kenya', 'Tanzania'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, location)
);

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  email          CITEXT,
  password_hash  TEXT NOT NULL,
  role           user_role NOT NULL,
  centre_id      UUID REFERENCES centres(id) ON DELETE SET NULL,
  contact        TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CITEXT (case-insensitive email) requires the citext extension.
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE users ALTER COLUMN email TYPE CITEXT;
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Exactly four active trustees is a business rule enforced at the
-- application layer (see services/userService), not the DB — Postgres
-- has no clean way to cap a row count via constraint. The app layer
-- blocks creating a 5th active trustee and blocks deactivating one
-- below four without an explicit override flag.

CREATE TABLE budget_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  centre_id        UUID REFERENCES centres(id) ON DELETE SET NULL,
  allocated_amount NUMERIC(14,2) NOT NULL CHECK (allocated_amount >= 0),
  spent_to_date    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (spent_to_date >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id        UUID NOT NULL REFERENCES users(id),
  centre_id           UUID NOT NULL REFERENCES centres(id),
  budget_line_id      UUID NOT NULL REFERENCES budget_lines(id),
  payment_type        payment_type NOT NULL,
  recipient_name      TEXT NOT NULL,
  recipient_account   TEXT,      -- bank account number, if applicable
  recipient_phone     TEXT,      -- for M-Co-op Cash, if applicable
  amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  justification        TEXT NOT NULL,
  status              request_status NOT NULL DEFAULT 'draft',
  rejection_reason    TEXT,
  submitted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    recipient_account IS NOT NULL OR recipient_phone IS NOT NULL
  )
);

CREATE INDEX idx_payment_requests_status ON payment_requests(status);
CREATE INDEX idx_payment_requests_centre ON payment_requests(centre_id);
CREATE INDEX idx_payment_requests_requester ON payment_requests(requester_id);

-- One row per individual approval action (Finance, Director, and each
-- of the four Trustees individually), per Section 9.1.
CREATE TABLE approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  approver_id   UUID NOT NULL REFERENCES users(id),
  stage         approval_stage NOT NULL,
  decision      approval_decision NOT NULL,
  comments      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A given approver can only act once per request per stage (no
  -- duplicate/overwriting approvals — a correction requires a new
  -- decision row to be prevented instead by the app layer, which
  -- checks for an existing decision before insert).
  UNIQUE (request_id, approver_id, stage)
);

CREATE INDEX idx_approvals_request ON approvals(request_id);

CREATE TABLE payment_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL UNIQUE REFERENCES payment_requests(id) ON DELETE CASCADE,
  executed_by       UUID NOT NULL REFERENCES users(id),
  method            payment_method NOT NULL,
  transaction_reference TEXT NOT NULL,
  execution_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_reference)
);

CREATE TABLE reconciliation_docs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  document_type document_type NOT NULL,
  file_url      TEXT NOT NULL,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, document_type)
);

CREATE INDEX idx_reconciliation_docs_request ON reconciliation_docs(request_id);

-- Full audit log — every approval/rejection/execution/reconciliation
-- change is written here in addition to its own table, per Section 10.
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID REFERENCES payment_requests(id) ON DELETE SET NULL,
  actor_id      UUID REFERENCES users(id),
  action        TEXT NOT NULL,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_request ON audit_log(request_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- ============================================================
-- updated_at trigger helper
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_budget_lines_updated_at BEFORE UPDATE ON budget_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payment_requests_updated_at BEFORE UPDATE ON payment_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
