# AgenPay — Production Readiness Review

Date: 2026-07-05
Scope: `agenpay-backend` (Express/Prisma/SQLite), `agenpay-frontend` (Next.js), `agenpay-facilitator` (x402 signer).

## Verdict

**Not production-ready yet.** Critical code-level issues fixed below. Remaining blockers require decisions/actions outside the codebase (secret rotation, DB migration) — see "Still Required" section.

---

## Findings (original review)

### Critical
- Real secrets sitting in plaintext `.env` files across all 3 apps: OpenAI, Gemini, Minimax, Notion client secret, Privy app secret, Gmail app password, and a raw **Sei private key** in `agenpay-facilitator/.env` used to sign on-chain settlements. If these ever land in git or a screenshot, funds/accounts are gone.
- `JWT_SECRET` in backend `.env` is still the placeholder value `"your-super-secret-jwt-key-change-this-in-production"`.
- `WalletService.createPrivyWallet()` was a **mock** — fabricated wallet id/address instead of calling Privy. Core payment feature was non-functional.
- `WalletService.sendBlockchainTransaction()` was also a **mock** — returned a random fake tx hash instead of actually signing/broadcasting.
- X402Pay routes (`x402PayService.app`) were mounted on the Express app **before** `helmet`, `cors`, and the rate limiter were registered — payment endpoints ran with zero security headers, zero CORS restriction, zero rate limiting.

### High
- `DATABASE_URL="file:./dev.db"` — SQLite. Fine for a demo, wrong for real multi-user production (write contention, no HA, no backups story).
- `NODE_ENV="development"` in backend `.env` — gates stack-trace leakage in error responses and disables production optimizations.
- `app.use(cors())` had no origin allowlist — accepted any origin.
- `console.log(user)` in the login route dumped the full user record (including password hash) to server logs.

### Medium
- ~~`/api/workspace-status/:userId` is public, no auth~~ — **fixed**, see table below.
- `middleware.ts` only checks token *presence* (cookie or header), never verifies JWT signature/expiry. Not exploitable for data access since the real API (`authenticateToken`) validates properly — just means an unauthenticated user could load the dashboard shell before its data fetch fails. Left as-is: UX polish, not a security gap.
- ~~Facilitator `/verify` and `/settle` have no request auth or rate limit~~ — **fixed**, see table below.

---

## Fixes Applied (code only, `.env` untouched)

| File | Change |
|---|---|
| `agenpay-backend/server.js` | Removed `console.log(user)` credential/password-hash leak in `/api/auth/login`. |
| `agenpay-backend/server.js` | `cors()` now restricted to `FRONTEND_URL` (comma-separated allowlist supported) instead of reflecting any origin. |
| `agenpay-backend/server.js` | Moved the X402Pay route mount to **after** `helmet`/`cors`/rate-limiter registration, so payment routes are actually covered by them. |
| `agenpay-backend/lib/WalletService.js` | `createPrivyWallet()` now calls the real `privy.walletApi.create({ chainType: 'ethereum' })` instead of generating a fake address. |
| `agenpay-backend/lib/WalletService.js` | `sendBlockchainTransaction()` now calls the real `privy.walletApi.ethereum.sendTransaction(...)` to sign and broadcast, instead of returning a random fake hash. `sendCrypto()` updated to pass the wallet's `walletId` through. |
| `agenpay-backend/server.js` | `GET /api/workspace-status/:userId` now requires `authenticateToken` and returns 403 if the caller's own id doesn't match the requested `:userId`. |
| `agenpay-frontend/app/auth/notion-callback/page.tsx` | The workspace-status poll now sends `Authorization: Bearer <token>` (token is already stored right before polling starts) to satisfy the new auth requirement. |
| `agenpay-facilitator/index.js` | Added a request-rate limiter (60/min window, 30 req cap) on `/verify` and `/settle`. Added an **optional** shared-secret check (`FACILITATOR_API_KEY`): if that env var is set, requests must send `Authorization: Bearer <key>` or get `401`; if unset, behavior is unchanged (open) so nothing breaks without a `.env` edit. |
| `agenpay-backend/lib/X402PayService.js` | Facilitator client now sends `Authorization: Bearer <FACILITATOR_API_KEY>` via x402's `createAuthHeaders` hook, but only if that env var is set on the backend side too — no-op otherwise. |

Verified with `node --check` on all edited backend/facilitator files, `tsc --noEmit` on the frontend, and live curl tests against a running instance (401 with no token, 200 for own id, 403 for someone else's id; facilitator `/verify` still returns its normal 400 schema error, not 401, confirming the open-by-default path is untouched).

---

## Still Required (not code fixes — needs your action)

1. **Rotate every secret** currently in the three `.env` files (OpenAI, Gemini, Minimax, Notion, Privy, Gmail app password, facilitator private key) before this ever goes near production, and generate a real random `JWT_SECRET`. Treat all current values as burned since they've been visible in plaintext files.
2. **Set `NODE_ENV=production`** in the backend env for the deployed environment.
3. **Migrate off SQLite** to Postgres (or similar) for real multi-user load — `DATABASE_URL` + `prisma/schema.prisma` datasource provider change, plus a migration.
4. **Set `FACILITATOR_API_KEY`** to the same random value in both `agenpay-backend/.env` and `agenpay-facilitator/.env` to turn on the shared-secret check added above (currently unset = open). Also still recommended: network-restrict the facilitator (firewall/allowlist by IP, private network/service mesh) since it holds the signer key for on-chain settlement — the app-level key is defense in depth, not a replacement.
5. **Confirm Privy app config** supports the `walletApi` methods now being called (embedded/server wallets must be enabled for the app in the Privy dashboard) — this was verified against the installed SDK's type definitions but not against a live Privy account.
