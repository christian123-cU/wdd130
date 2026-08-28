#!/usr/bin/env bash
# One-shot setup for the ChallengeAid Disbursement System (Mac/Linux).
# Run this from the challengeaid-system/ folder: ./setup.sh
set -e

echo "== 1/5: Installing root tooling (concurrently) =="
npm install

echo "== 2/5: Installing backend dependencies =="
npm install --prefix backend

echo "== 3/5: Installing frontend dependencies =="
npm install --prefix frontend

if [ ! -f backend/.env ]; then
  echo "== 4/5: Creating backend/.env from template =="
  cp backend/.env.example backend/.env
  echo "   -> Edit backend/.env with your real PostgreSQL credentials and a JWT_SECRET before continuing."
else
  echo "== 4/5: backend/.env already exists, leaving it as-is =="
fi

if [ ! -f frontend/.env ]; then
  echo "== 5/5: Creating frontend/.env from template =="
  cp frontend/.env.example frontend/.env
else
  echo "== 5/5: frontend/.env already exists, leaving it as-is =="
fi

echo ""
echo "Setup complete. Next steps:"
echo "  1. Edit backend/.env (PostgreSQL credentials, JWT_SECRET)."
echo "  2. Create the database, e.g.: createdb challengeaid_disbursement"
echo "  3. Apply the schema:   npm run migrate"
echo "  4. Seed demo data:     npm run seed"
echo "  5. Start everything:   npm run dev"
echo "     (backend on :3000, frontend on :5173)"
