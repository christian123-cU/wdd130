# One-shot setup for the ChallengeAid Disbursement System (Windows PowerShell).
# Run this from the challengeaid-system\ folder: .\setup.ps1

Write-Host "== 1/5: Installing root tooling (concurrently) =="
npm.cmd install

Write-Host "== 2/5: Installing backend dependencies =="
npm.cmd install --prefix backend

Write-Host "== 3/5: Installing frontend dependencies =="
npm.cmd install --prefix frontend

if (-not (Test-Path "backend\.env")) {
  Write-Host "== 4/5: Creating backend\.env from template =="
  Copy-Item "backend\.env.example" "backend\.env"
  Write-Host "   -> Edit backend\.env with your real PostgreSQL credentials and a JWT_SECRET before continuing."
} else {
  Write-Host "== 4/5: backend\.env already exists, leaving it as-is =="
}

if (-not (Test-Path "frontend\.env")) {
  Write-Host "== 5/5: Creating frontend\.env from template =="
  Copy-Item "frontend\.env.example" "frontend\.env"
} else {
  Write-Host "== 5/5: frontend\.env already exists, leaving it as-is =="
}

Write-Host ""
Write-Host "Setup complete. Next steps:"
Write-Host "  1. Edit backend\.env (PostgreSQL credentials, JWT_SECRET)."
Write-Host "  2. Create the database, e.g. using pgAdmin or: createdb challengeaid_disbursement"
Write-Host "  3. Apply the schema:   npm.cmd run migrate"
Write-Host "  4. Seed demo data:     npm.cmd run seed"
Write-Host "  5. Start everything:   npm.cmd run dev"
Write-Host "     (backend on :3000, frontend on :5173)"
