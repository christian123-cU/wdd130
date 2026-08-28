# ChallengeAid Africa — Disbursement & Reconciliation System

Everything in one place: the API backend and the web frontend, organized so the whole
system comes up with one setup pass.

```
challengeaid-system/
├── backend/     Node.js/Express API + PostgreSQL schema (the workflow engine)
├── frontend/    React (Vite) app your boss clicks through
├── package.json Root convenience scripts (install/run both together)
├── setup.sh     One-shot setup — Mac/Linux
└── setup.ps1    One-shot setup — Windows PowerShell
```

Each folder also has its own detailed README (`backend/README.md`, `frontend/README.md`)
covering exactly what's implemented and what isn't yet — read those for the full picture.
This file is just the fastest path to "it's running."

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL installed and running locally (or a connection string to one)
- Redis, only if you want the notification worker running too (optional for a demo —
  the app works fully without it)

## Quick start

### Mac / Linux

```bash
cd challengeaid-system
./setup.sh
```

### Windows (PowerShell)

```powershell
cd challengeaid-system
.\setup.ps1
```

Either script installs dependencies for both projects and creates `backend/.env` and
`frontend/.env` from their templates. **It will pause you here to edit `backend/.env`** —
fill in your real PostgreSQL username/password and generate a `JWT_SECRET` (e.g.
`openssl rand -hex 32`, or any long random string if that command isn't available on your
system). The frontend's `.env` needs no changes for local use.

### Then, from the `challengeaid-system` folder:

```bash
# 1. Create the database (name must match PGDATABASE in backend/.env)
createdb challengeaid_disbursement

# 2. Apply the schema
npm run migrate

# 3. Seed demo centres, budget lines, and one login per role
npm run seed

# 4. Start both the API and the frontend together
npm run dev
```

`npm run dev` runs the backend (port 3000) and frontend (port 5173) side by side in one
terminal, each prefixed and color-coded so you can tell their logs apart. Open
**http://localhost:5173** — that's what your boss opens too.

If you'd rather run them in two separate terminals (useful for debugging one in isolation):

```bash
npm run dev:backend    # terminal 1
npm run dev:frontend   # terminal 2
```

## Logging in

The seed script prints login emails and a shared demo password to the terminal
(default `ChangeMe123!` unless you changed `SEED_ADMIN_PASSWORD` in `backend/.env`).
One account per role: `admin@`, `staff@`, `finance@`, `director@`, and four trustees
(`trustee1@` through `trustee4@`), all `@challengeaid.org`.

`frontend/README.md` has a full step-by-step script for demoing the entire approval →
execution → reconciliation workflow across those accounts.

## Verifying it's actually working

```bash
npm test                          # backend's automated tests
curl http://localhost:3000/health # should return {"status":"ok"}
```

If `npm run dev` is running and you can log in at `localhost:5173` and see the request
list, both halves are wired together correctly.

## Before showing this to anyone outside your team

- **Do not commit `backend/.env` or `frontend/.env`** — both are already listed in their
  respective `.gitignore` files, but double-check before pushing to a shared repo.
- Change the seeded demo password immediately if this ever runs anywhere other than your
  own machine.
- Read the "Still needed" sections in `backend/README.md` and `frontend/README.md` before
  calling this production-ready — this is a working Phase 1 MVP (per the design doc's
  phasing), not a finished system. It's honest about the gaps so nobody is surprised later.
