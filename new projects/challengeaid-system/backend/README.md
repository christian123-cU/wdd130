# ChallengeAid Africa — Disbursement & Reconciliation System

Phase 1 MVP backend API, built from `ChallengeAid_Disbursement_System_Design.docx` (System Design Document, Draft v2).

## What this is

A Node.js/Express + PostgreSQL API implementing the core workflow from the design doc:

```
Draft → Submitted → Finance Approved → Director Approved →
Trustee Approved (1 of 4 → 4 of 4) → Disbursed → Reconciled
```

with Rejected / More Info Requested as branch states at any approval stage.

## What's implemented

- **Data model** (`schema.sql`) — all entities from Section 9.1: Users, Centres, BudgetLines,
  PaymentRequests, Approvals (one row per individual approver decision), PaymentExecutions,
  ReconciliationDocs, plus an AuditLog table. Foreign keys, uniqueness constraints (one decision
  per approver per stage per request; one execution per request; one reconciliation doc per type
  per request), and check constraints (positive amounts, non-negative budgets) are enforced at
  the database level, not just in application code.
- **Auth** — JWT-based login (`POST /api/auth/login`). Users are provisioned by an admin, not
  self-registered, matching a finance system's usual access model.
- **User & role management** — admin-only CRUD. Enforces the "exactly four trustees" business
  rule from Section 5 (blocks a 5th active trustee; blocks dropping below four without an
  explicit `?override=true`, e.g. for a resignation pending replacement).
- **Approval workflow** (`src/services/approvalService.js`) — this is the core of the system.
  Enforces the fixed Finance → Director → all-four-Trustees sequence regardless of amount
  (Section 5), blocks a stage from acting out of order, prevents an approver from voting twice
  at the same stage, and tracks "3 of 4 trustees signed" individually. Covered by unit tests
  in `tests/approvalService.test.js`.
- **Segregated payment execution** (Section 6) — `POST /api/payment-requests/:id/execute` is a
  distinct step from approval, only callable once a request has cleared all four trustees, and
  is a manual human action — nothing in this codebase auto-pays.
- **Budget validation** (`src/services/budgetService.js`) — a new request is rejected if it
  would exceed a budget line's remaining headroom, counting both already-spent funds and
  everything else currently in the approval pipeline. Re-checked again at execution time.
- **Reconciliation rules by payment type** (Section 7) — `src/services/reconciliationService.js`
  encodes the required-document table exactly as specified and derives Reconciled /
  Pending — Missing [X] automatically as documents are uploaded.
- **Dashboard** (Section 8) — live disbursed/reconciled/outstanding counts and a 7/14/30-day
  aging report, filterable by centre.
- **Audit log** — every approval, rejection, execution, and reconciliation event writes an
  `audit_log` row with actor, action, and details (Section 10).

## Setup

1. Install Node.js 18+, then:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in real values (database credentials, a generated
   `JWT_SECRET`, Redis connection).
3. Create the database and apply the schema:
   ```bash
   createdb challengeaid_disbursement
   npm run migrate
   ```
4. Seed demo centres, budget lines, and one user per role:
   ```bash
   npm run seed
   ```
   This prints the seeded login emails and a shared demo password — change it immediately in
   any non-local environment.
5. Start the API:
   ```bash
   npm start
   ```
6. (Optional, for approver reminders) start Redis and the worker separately:
   ```bash
   npm run worker
   ```
   The worker is a stub: it will log a warning and skip sending rather than fail, since no SMS
   gateway has been chosen yet (Section 12 open question).

Run the test suite with `npm test`.

## API summary

| Method & Path | Who | Purpose |
|---|---|---|
| `POST /api/auth/login` | anyone | Get a JWT |
| `POST /api/users` | admin | Create a user |
| `DELETE /api/users/:id` | admin | Deactivate a user |
| `POST /api/centres` | admin | Create a centre |
| `POST /api/budget-lines` | admin, finance | Create a budget line |
| `POST /api/payment-requests` | staff | Submit a request |
| `GET /api/payment-requests` | all | List requests (staff see only their own) |
| `GET /api/payment-requests/:id` | all | Get one request with approval + reconciliation status |
| `POST /api/payment-requests/:id/decision` | finance, director, trustee | Approve / reject / request info |
| `POST /api/payment-requests/:id/execute` | finance, admin | Record the manual bank/mobile-money payout |
| `POST /api/payment-requests/:id/documents` | staff, finance, admin | Attach a reconciliation document |
| `GET /api/dashboard/summary` | director, trustee, finance, admin | Live counts |
| `GET /api/dashboard/aging` | director, trustee, finance, admin | 7/14/30-day aging buckets |

## Still needed before this is production-ready

This is a working API foundation with the highest-risk logic (approval sequencing, budget
enforcement, reconciliation rules) implemented and tested — but it is **not yet a complete
end-to-end system**. Notably missing:

- **Frontend** — nothing in Section 11's "multi-stage approval dashboard" is built; this is
  API-only. A React frontend (per the doc's suggested stack) would consume these endpoints.
- **Real file storage for uploads** — `documents` endpoint accepts a `fileUrl` string; there's
  no actual file upload handling (multipart, S3/object storage, virus scanning).
- **SMS gateway integration** — the worker queues jobs but no gateway is wired in (Section 12
  open question: which gateway to use).
- **Escalation/reminder triggers** — nothing currently enqueues a reminder job when a request
  sits awaiting one trustee's signature; the queue exists but is unused.
- **Bank/M-Pesa webhook handling** — execution is recorded by the Finance Officer typing in a
  transaction reference; there's no webhook to verify that reference against Cooperative Bank
  independently (planned as a Phase 2 API integration per Section 6.2).
- **Two-factor authentication** — recommended in Section 10 for Finance/Director/Trustee
  accounts; not implemented (JWT password auth only).
- **Exportable reports (PDF/Excel)** — Section 8's board-meeting export is not built.
- **More granular tests** — the approval sequence has unit test coverage; budget validation,
  reconciliation status transitions, and the HTTP layer (auth middleware, role checks, request
  validation) do not yet have their own tests.
- **Named Finance/Accounts Officer confirmation and hosting/budget decisions** — Section 12's
  open questions are still open; nothing in code depends on their answers, but they'll shape
  Phase 1 rollout.

## Design decisions worth flagging back to Finance/Programme/Board

- The "all four trustees on every request" rule is enforced exactly as specified, including for
  small amounts — the design doc itself flags (Section 5) this may be worth revisiting for
  trustee time after a few months of real use.
- Budget validation counts pipeline commitments (submitted-but-not-yet-disbursed requests), not
  just historically spent funds — this is stricter than the doc explicitly specifies, but avoids
  two requests against the same thin budget line both clearing approval and then colliding at
  execution time. Worth confirming this matches Finance's expectations.
