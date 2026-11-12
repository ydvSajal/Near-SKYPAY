# PowerShell script to remove .env files from git tracking and secure your repository

Write-Host "🔒 Securing AgenPay Repository..." -ForegroundColor Cyan
Write-Host ""

# Navigate to repository root
Set-Location $PSScriptRoot

Write-Host "Step 1: Removing .env files from git tracking..." -ForegroundColor Yellow
try { git rm --cached agenpay-backend/.env 2>$null } catch { Write-Host "  ⚠ agenpay-backend/.env not in git" }
try { git rm --cached agenpay-facilitator/.env 2>$null } catch { Write-Host "  ⚠ agenpay-facilitator/.env not in git" }
try { git rm --cached agenpay-frontend/.env 2>$null } catch { Write-Host "  ⚠ agenpay-frontend/.env not in git" }
try { git rm --cached agenpay-frontend/.env.local 2>$null } catch { Write-Host "  ⚠ agenpay-frontend/.env.local not in git" }

Write-Host ""
Write-Host "Step 2: Adding .env.example files..." -ForegroundColor Yellow
git add agenpay-backend/.env.example 2>$null
git add agenpay-facilitator/.env.example 2>$null

Write-Host ""
Write-Host "Step 3: Updating .gitignore files..." -ForegroundColor Yellow
git add agenpay-backend/.gitignore
git add agenpay-facilitator/.gitignore
git add agenpay-frontend/.gitignore

Write-Host ""
Write-Host "Step 4: Creating commit..." -ForegroundColor Yellow
git commit -m "Security: Remove .env files from tracking, add .env.example templates

- Remove all .env files from git tracking
- Update .gitignore to properly exclude .env files  
- Add .env.example templates for setup
- Rotate all sensitive credentials
"

Write-Host ""
Write-Host "✅ Local changes committed!" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  IMPORTANT NEXT STEPS:" -ForegroundColor Red
Write-Host "1. Review your commit with: git show"
Write-Host "2. Update ALL secrets in your .env files (new values)"
Write-Host "3. To push to GitHub: git push origin main --force-with-lease"
Write-Host ""
Write-Host "⚠️  TO REMOVE SECRETS FROM GITHUB HISTORY:" -ForegroundColor Red
Write-Host "Visit: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository"
Write-Host "Or use BFG Repo-Cleaner: https://rtyley.github.io/bfg-repo-cleaner/"
Write-Host ""
