# ChallengeAid Disbursement Tracker — Frontend

A React (Vite) frontend for the [ChallengeAid Disbursement & Reconciliation API](../challengeaid-disbursement).
This is what your boss actually clicks through.

## Setup

1. Make sure the backend API is running first (see the backend project's README —
   PostgreSQL set up, seeded, `npm start` running on port 3000).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` — the default (`http://localhost:3000/api`) matches the
   backend's default port, so you usually don't need to change anything.
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Open the URL Vite prints (usually `http://localhost:5173`).

## Logging in for a demo

If you ran the backend's `npm run seed`, these accounts exist (password is whatever
`SEED_ADMIN_PASSWORD` was in the backend's `.env`, default `ChangeMe123!`):

| Email | Role |
|---|---|
| `admin@challengeaid.org` | System Admin |
| `staff@challengeaid.org` | Staff-in-Charge |
| `finance@challengeaid.org` | Finance Officer |
| `director@challengeaid.org` | Director |
| `trustee1@challengeaid.org` … `trustee4@challengeaid.org` | Trustee (all four) |

## Walking your boss through the full workflow

1. **Log in as `staff@challengeaid.org`** → New Request → fill in a centre, budget line,
   payment type, recipient, and amount → Submit.
2. **Log out, log in as `finance@challengeaid.org`** → open the request from the list →
   Approve.
3. **Log in as `director@challengeaid.org`** → open the same request → Approve.
4. **Log in as each of the four trustee accounts in turn** → open the request → Approve.
   Watch the stamp row fill in one trustee at a time — the request only moves to "Fully
   Approved" once all four have signed.
5. **Log in as `finance@challengeaid.org`** again → the request now shows an "Execute
   payment" form → pick a method, enter any reference number, submit. Status becomes
   "Disbursed."
6. Still as Finance (or as staff) → attach the reconciliation documents required for that
   payment type (the page tells you which ones) → once all are attached, status flips to
   "Reconciled" automatically.
7. **Log in as `director@challengeaid.org`** or **`admin@challengeaid.org`** → open
   Dashboard → see the live disbursed/reconciled/outstanding counts and the aging report.

This mirrors Section 4 of the design doc end to end.

## What's here vs. not yet

- Every screen in this walkthrough is real and talks to the live API — nothing is mocked.
- File uploads are simulated with a text field for a file reference (URL or path), since the
  backend doesn't yet handle real file storage (see the backend README's "Still needed").
- No SMS reminders, no 2FA, no PDF/Excel export — same gaps as documented in the backend
  README, since this frontend is a thin layer over that API.
- Styling is a custom "ledger and stamp" visual system (not a UI framework), built to keep the
  approval chain — the core of this whole project — visually literal: an unsigned request
  looks like a stack of blank stamps; a fully approved one looks like a stamped, signed
  document.
