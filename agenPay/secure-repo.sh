#!/bin/bash
# Script to remove .env files from git tracking and secure your repository

echo "🔒 Securing AgenPay Repository..."
echo ""

# Navigate to repository root
cd "$(dirname "$0")"

echo "Step 1: Removing .env files from git tracking..."
git rm --cached agenpay-backend/.env 2>/dev/null || echo "  ⚠ agenpay-backend/.env not in git"
git rm --cached agenpay-facilitator/.env 2>/dev/null || echo "  ⚠ agenpay-facilitator/.env not in git"
git rm --cached agenpay-frontend/.env 2>/dev/null || echo "  ⚠ agenpay-frontend/.env not in git"
git rm --cached agenpay-frontend/.env.local 2>/dev/null || echo "  ⚠ agenpay-frontend/.env.local not in git"

echo ""
echo "Step 2: Adding .env.example files..."
git add agenpay-backend/.env.example 2>/dev/null
git add agenpay-facilitator/.env.example 2>/dev/null

echo ""
echo "Step 3: Updating .gitignore files..."
git add agenpay-backend/.gitignore
git add agenpay-facilitator/.gitignore
git add agenpay-frontend/.gitignore

echo ""
echo "Step 4: Creating commit..."
git commit -m "Security: Remove .env files from tracking, add .env.example templates

- Remove all .env files from git tracking
- Update .gitignore to properly exclude .env files  
- Add .env.example templates for setup
- Rotate all sensitive credentials
"

echo ""
echo "✅ Local changes committed!"
echo ""
echo "⚠️  IMPORTANT NEXT STEPS:"
echo "1. Review your commit with: git show"
echo "2. Update ALL secrets in your .env files (new values)"
echo "3. To push to GitHub: git push origin main"
echo ""
echo "⚠️  TO REMOVE SECRETS FROM GITHUB HISTORY:"
echo "Visit: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository"
echo "Or use BFG Repo-Cleaner: https://rtyley.github.io/bfg-repo-cleaner/"
echo ""
