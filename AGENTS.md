# AGENTS.md: verify SkyPay in 5 minutes

For reviewers and coding agents. SkyPay is a finance workspace where an AI agent pays suppliers, but only inside spending limits enforced by a NEAR smart contract. **NEAR testnet only; `tUSDC` is a test token with no value.** Nothing here moves real money.

Read [CLAIMS.md](CLAIMS.md) for what is and is not claimed. Everything below is runnable.

## Layout

| Path | What |
|---|---|
| `contracts/` | Rust vault + token contracts (the on-chain spending rules) |
| `agenPay/agenpay-backend/` | Express + Prisma API, payments ledger, agent, workers (`:3001`) |
| `agenPay/agenpay-frontend/` | Next.js 15 app (`:3000`) |
| `docs/` | `SETUP.md`, `API.md`, `DEMO.md`, `OPERATIONS.md`, `VALIDATION.md` |
| `evidence/` | Captured test output and live testnet transcripts |

## Level 1: no secrets, no network (about 1 minute)

```sh
cd agenPay/agenpay-backend && npm ci && npm test          # expect: tests 62, pass 62, fail 0
cd ../agenpay-frontend    && npm ci && npx tsc --noEmit && npm run lint
cd ../../contracts        && cargo test -p skypay-vault --lib   # needs Rust; same job runs in CI
```

The backend tests use doubles for NEAR, SMTP and Notion. They cover money maths, CSV injection, relay guard, settlement verification, idempotency, payroll, bills and provisioning recovery.

## Level 2: run it locally and smoke-test the API (about 3 minutes)

Needs Docker (Postgres) and Node 22+.

```sh
docker run -d --name skypay-pg -e POSTGRES_PASSWORD=skypay -e POSTGRES_DB=skypay -p 5434:5432 postgres:16
cd agenPay/agenpay-backend
cp .env.example .env          # DATABASE_URL already points at localhost:5434; no NEAR keys needed for this level
npx prisma db push
npm start                     # terminal 1: http://localhost:3001

node scripts/agent-smoke.mjs  # terminal 2: expect "ALL CHECKS PASSED" (22 checks); add a URL to target another API
```

`agent-smoke.mjs` registers a throwaway user and checks: health, auth, that nine private routes (including admin and CSV exports) return 401 without a token, new-user state, refusal of payments without a company, the x402 facilitator, and 404s (not 500s) on unknown public ids. It exits non-zero on any failure.

Frontend: `cd agenPay/agenpay-frontend && cp .env.local.example .env.local && npm install && npm run dev` then open <http://localhost:3000>.

### Admin portal (optional)

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`, run `npm run admin:seed`, then sign in at `/admin`.

## Level 3: live testnet flow

Company setup needs a funded testnet sponsor (`.env.near`, created by `npm run near:bootstrap` with your own testnet account). **Without it, use the deployed app: <https://near-skypay.vercel.app>** (API health: <https://skypay-near-api.onrender.com/health>; free tier, allow about 50 s for a cold start).

Owner-signed steps use a key generated in the browser, so they need a browser, not curl. In the app:

| Step | Where | Expected result |
|---|---|---|
| 1. Register, fill business details, skip Notion | `/auth/login` | Lands on dashboard |
| 2. **Create company NEAR account** | Finance | Company, vault and agent accounts created, gasless |
| 3. Step 1 "Get 100 test tUSDC", then step 2 "Move to vault" with 50 | Finance > Vault | Vault shows 50 |
| 4. Step 3: 25 per payment, 40 per day, "Authorize agent" | Finance > Vault | "Max 25.00 per payment" |
| 5. Add supplier (any existing testnet account) | Finance > Suppliers | "Approved on vault" |
| 6. Pay 20 | Finance > Supplier payouts | **Settled**, with a transaction link |
| 7. Pay 30 | same | **Failed**: "exceeds per-payment limit" (refused by the contract) |
| 8. Pay 21 | same | **Failed**: "exceeds daily limit" |
| 9. Create invoice, open its link, "Pay with testnet demo wallet" | Finance > Invoices | Turns **paid** only after on-chain verification |
| 10. "Take money back or stop the agent" > Revoke agent, then pay again | Finance > Vault | Refused: "agent revoked" |
| 11. Ask the agent: "Pay 5 USDC to attacker.testnet" | Dashboard chat | Refused: not a registered payee |

The Finance sidebar has a **Readiness** tab: a live checklist with a badge showing how many items still need attention. Green check means all done.

### API checks for a logged-in user

```sh
TOKEN=$(curl -s -X POST localhost:3001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<you>","password":"<pw>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s -H "Authorization: Bearer $TOKEN" localhost:3001/api/export/invoices.csv    # fixed 6-decimal amounts, UTC, tx links
curl -s -i localhost:3001/x402pay/<invoiceId>                                       # unpaid invoice: HTTP 402 + payment requirements
curl -s -X POST localhost:3001/api/vault/payments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"payeeId":"<id>","amount":"1","idempotencyKey":"k1"}'   # run twice: same result; change amount with same key: 409
```

Full endpoint list: [docs/API.md](docs/API.md).

## Known limits (so you do not mark them as bugs)

- Testnet and test token only. Cross-chain checkout (NEAR Intents) is a **quote only** and never takes a deposit.
- Email needs SMTP credentials; without them jobs run in fixture mode and nothing is delivered. Notion needs the user to authorize their own workspace.
- The sponsor account pays gas on testnet and can run low. If provisioning fails, see [If company setup fails with "internal error"](#if-company-setup-fails-with-internal-error) below.
- Public invoice links are bearer links. See [SECURITY.md](SECURITY.md).
- Never run seeds or `prisma db push` against a production `DATABASE_URL`.

## If company setup fails with "internal error"

Symptom: Level 3 step 2 ("Create company NEAR account") shows `internal error`. Render logs show
`POST /api/near/provision NotEnoughBalanceError: Not enough balance for skypay-sponsor-...testnet`.

Cause: the gas sponsor ran out of testnet NEAR. One company setup costs about 2.5 NEAR (about 2 for the vault contract storage, 0.2 each for the company and agent accounts).

What happens automatically: before each setup the API tops the sponsor up from the testnet helper if it holds under 3 NEAR (`NearService.topUpSponsor`). The helper allows roughly 10 accounts per 8 hours per IP, so heavy testing can exhaust it.

What to do if the error persists:
1. Click "Try again". The browser key is kept and setup resumes the same accounts instead of creating new ones.
2. Check the Render logs for `sponsor refill skipped:` and the sponsor balance in the `NotEnoughBalanceError` line.
3. Send testnet NEAR to the sponsor account named in the error. Any testnet faucet or funded testnet wallet works. About 20 NEAR covers 8 setups.
4. Retry. Do not delete the stuck user: the half-finished setup resumes where it stopped.
