# SkyPay: invoices and controlled supplier payments in USDC on NEAR

**Track:** Real-World Money (NEAR Hackathon, November 2026) · **Network:** NEAR testnet · **License:** MIT

SkyPay is a finance workspace for a small agency. You bill clients, they pay in USDC on NEAR, and the
books update themselves. An AI agent can create invoices and pay approved suppliers, but only inside
spending rules that a NEAR smart contract enforces. The agent, and SkyPay's own server, cannot
spend outside those rules.

> **Honesty box.** Everything below runs on **NEAR testnet** with a **test token (tUSDC) that has no value**.
> Real USDC is not used, and cross-chain payment (NEAR Intents) is a **live price quote only**: no deposit address,
> no execution. See [CLAIMS.md](CLAIMS.md)
> for what is implemented, tested, and proven on-chain, with links.

## Current engineering review

The November 14 review preserved the existing NEAR implementation and concurrent user edits. It added atomic invoice/settlement outbox writes, read-only restart reconciliation, stricter sponsor arguments, quote validation and CSV hardening. **38 backend tests pass locally; frontend type checking and 5 payroll tests pass.** Production build was blocked by runner `spawn EPERM`; Rust was unavailable. Existing deployment links and historical transaction logs were not reverified. Executable cross-chain collection is still missing.

Start with [audit](docs/AUDIT.md), [competitor evidence](docs/COMPETITORS.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), [architecture](docs/ARCHITECTURE.md), [validation and acceptance matrix](docs/VALIDATION.md), [demo](docs/DEMO.md), [security](SECURITY.md) and [environment reference](.env.example). These review documents distinguish local tests, historical logs and unverified claims.

## Live demo

| | URL |
|---|---|
| App | **https://near-skypay.vercel.app** |
| API + x402 facilitator | https://skypay-near-api.onrender.com ([`/health`](https://skypay-near-api.onrender.com/health)) |

Register, fill in business details, skip or connect Notion, then click **Create NEAR account**. The **Setup** button in
the header shows which steps are done and lets you finish or edit them later.

* **First request can take 30-50 s.** The API runs on Render's free plan and sleeps when idle. Reload once if the
  first page load times out.
* **Testnet only.** Accounts are created on NEAR testnet and paid for by SkyPay's sponsor account, which holds a
  limited amount of testnet NEAR (each new company uses about 2.4). If account creation fails with an internal
  error, the sponsor needs a top-up (`npm run near:bootstrap`, see below).
* Hosting: frontend on Vercel, API on Render (`render.yaml`), Postgres on Neon.

---

## For the bookkeeper: what SkyPay does

| You want to... | In SkyPay | What you can rely on |
|---|---|---|
| Bill a client | Create an invoice (line items, due date) or tell the agent "request 10 USD from x@y.com for design" | Client gets an email with a pay link. Amounts are exact; no rounding. |
| Know if it's paid | Invoice status: **pending → paid** (or refunded) | "Paid" is set only after SkyPay reads the transfer on NEAR and checks the token, receiving account and amount. A screenshot or a claimed transaction is not enough. One transaction cannot pay two invoices. |
| Pay a supplier | Choose an approved payee and an amount, or ask the agent | Paid from a separate **operating vault** that you fund. Each payment has a per-payment cap and a daily cap; payees must be approved by you. |
| Batch payout | Finance → Payouts → Batch: up to 10 payees and amounts, one click | Paid one after another from the vault; a refused payment does not stop the rest. Each shows settled or refused, with its transaction. |
| Manage payees | Finance → Payees: edit name, email, notes; remove | Removing only affects SkyPay; the on-chain approval stays until you revoke it in the vault. |
| Employees and payroll | Finance → Employees: add staff with role and monthly pay, then Run payroll (one click), or ask the agent "run this month's payroll" | Staff are kept apart from suppliers. The agent shows the list and total first and pays only after you confirm. A payroll run name can be paid only once, so nobody is paid twice. |
| Payroll from Excel | Finance → Employees → Import Excel, or attach the file in the agent chat | Up to 25 rows (Name, Role, NEAR account, Email, Amount, Memo), read in the browser. You check a preview, approve new accounts with your own key, then pay the run. Bad rows and limit problems block payment. |
| Payouts in Notion | Automatic | A **Payouts** sub-page holds **Employees** (role, monthly pay, total paid, last paid), **Suppliers**, and **Payout runs** (payroll or supplier). Each payment also lands in **Supplier payments**. |
| Stop the agent | "Revoke agent" | Takes effect on-chain; any further agent payment is refused by the contract. |
| Close the month | Download `invoices.csv` and `payments.csv` | UTC timestamps, fixed 6-decimal amounts, transaction link per row, spreadsheet-formula injection blocked. |
| Pay network fees | Nothing | SkyPay sponsors NEAR gas. The company never has to buy NEAR. |

**What a CSV row means.** `amount_due` and `settled_amount` are USDC stablecoin units (6 decimals), **not**
bank-deposited dollars. `network_fee_paid_by_merchant` is 0 because fees are sponsored. `transaction_url`
opens the NEAR block explorer for that payment.

---

## How it works

```mermaid
flowchart LR
  subgraph Browser
    O["Owner<br/>(key generated in browser,<br/>never sent to SkyPay)"]
    C["Client<br/>/invoice/:id"]
  end
  subgraph SkyPay backend
    API["Express API"]
    R["Sponsor relayer<br/>(pays gas only)"]
    AG["Agent<br/>(LLM + typed tools)"]
    OB["Outbox<br/>email / Notion"]
    DB[("Postgres<br/>invoices, attempts")]
  end
  subgraph NEAR
    CO["Company account<br/>(receives invoice payments)"]
    V["Operating vault contract<br/>(Rust, no keys)"]
    AA["Agent account<br/>(can only call vault.pay)"]
    T["USDC / tUSDC<br/>(NEP-141)"]
  end
  C -- "pays USDC" --> T --> CO
  API -- "verifies tx on-chain" --> T
  O -- "signed delegate action" --> R -- "relays" --> V
  AG -- "pay_supplier" --> AA -- "pay(id, payee, amount)" --> V -- "ft_transfer" --> T
  API --> DB --> OB
```

* **Company account** receives client payments. Its key is created in the owner's browser.
* **Operating vault** (`contracts/vault`) holds money the owner explicitly moves in. It enforces: caller is a
  live agent, payee is allow-listed, per-payment limit, daily limit, request expiry, payment-ID replay
  protection, and reservation-before-transfer with a single release on failure. All its access keys are
  deleted after deployment, so nobody (including SkyPay) can change its code or move funds outside its rules.
* **Agent account** holds only a *function-call key* restricted to `vault.pay`. It cannot transfer tokens,
  change limits, or add keys.
* **Sponsor relayer** submits the owner's signed [delegate actions](https://docs.near.org/web3-apps/tutorials/meta-transactions)
  and pays gas. It refuses anything except vault policy methods and funding the company's *own* vault
  (`lib/near/relayGuard.js`).
* **Settlement check** (`NearService.evaluateReceipt`) reads NEP-141 `ft_transfer` events emitted *by the pinned
  token contract* in successful receipts. Client input is never trusted.
* **Outbox** sends invoice/receipt emails and Notion updates from durable jobs. Invoice/settlement jobs commit with financial records. Expired running claims require provider review; exactly-once external delivery is not guaranteed. Receipts are only
  sent after verified settlement. Without credentials it runs in a clearly logged *fixture* mode.

---

## Try it (do X → see Y)

### Prerequisites

* Node.js 22+, npm, Docker (for Postgres)
* Optional for rebuilding contracts: Rust stable + `wasm32-unknown-unknown`, `cargo-near` (prebuilt wasm is committed in `agenPay/agenpay-backend/near-artifacts/` with `SHA256SUMS`)
* Optional: a Gemini / OpenRouter / OpenAI key for the chat agent

### 1. Database and backend

```bash
docker run -d --name skypay-pg -e POSTGRES_PASSWORD=skypay -e POSTGRES_DB=skypay -p 5434:5432 postgres:16
cd agenPay/agenpay-backend
npm ci
cp .env.example .env            # set DATABASE_URL=postgresql://postgres:skypay@localhost:5434/skypay and JWT_SECRET
npx prisma db push
npm run near:bootstrap          # creates the testnet sponsor + test token; writes secrets to .env.near (gitignored)
npm test                        # expect: 34 pass, 0 fail (frontend: node --test lib/payroll-core.test.ts, 5 pass)
node server.js                  # expect: "NEAR testnet: token ..., relayer ..."
```

`near:bootstrap` funds the sponsor from the public testnet helper. The helper allows about 10 accounts per IP per
8 hours; if it is rate-limited the script prints an account id to fund manually and exits.

### 2. Frontend

```bash
cd agenPay/agenpay-frontend
npm ci
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > .env.local
npm run build && npx next start -p 3000
```

### 3. Walk through it

Locally use http://localhost:3000; or use the live app at https://near-skypay.vercel.app.

1. Register. Onboarding asks for business details (printed as the seller on invoices), Notion (optional, can be
   skipped) and the NEAR account.
   → **See:** step 4, "Create your NEAR company account".
2. Click **Create NEAR account** (~30 s).
   → **See:** receiving account, vault and agent account with explorer links. You bought no NEAR.
   Skipped a step? The **Setup** button in the header shows each step as *Connected* / *Not set up* and finishes it later.
3. Click **Download owner key backup** and keep the file. (The key exists only in this browser.) Then open **Finance**.
4. Create an invoice: client email, one line item `Design sprint · 1 · 10`, click **Create & email invoice**.
   → **See:** `INV-0001 … pending`; the backend log shows the invoice email (fixture mode if no SMTP).
5. Open the invoice link in a private window. Click **Connect wallet & pay**, pick MyNearWallet or Meteor, approve one
   transfer (on testnet it first mints you test tUSDC) — the page verifies it and flips to paid by itself.
   No testnet wallet? Use **Pay with testnet demo wallet** instead.
   → **See:** "Payment verified on NEAR" with the transaction hash; status is **paid** in Finance; a receipt job runs.
   (Before paying, the **Pay from another chain** panel can fetch a live NEAR Intents quote: pick e.g. *USDC on base*,
   enter a refund address on that chain, click **Get quote** → amount to send, provider fee, ETA and expiry. Quote only.)
6. Click **Get 100 test tUSDC**, then **Fund vault** with 50.
   → **See:** "Vault available 50", and an explorer link showing the relayer (not you) paid gas.
7. Set agent limits 25 per payment / 40 per day, click **Authorize agent**.
8. Add a payee (any existing testnet account) → it is registered and allow-listed on the vault.
9. Pay that payee 20 → **settled** with tx link. Pay 30 → **Refused by vault: exceeds per-payment limit**.
   Pay 21 → **Refused by vault: exceeds daily limit** (20 + 21 > 40).
10. Click **Revoke agent**, try any payment → **Refused by vault: agent revoked**.
11. Click **invoices.csv** / **payments.csv** → every row above, with transaction links.

With an LLM key set (`AI_PROVIDER=gemini` + `GEMINI_API_KEY`), the dashboard chat accepts the same actions in plain
English: *"Request 12.50 USD from client@example.com for logo design"*, *"Pay Pixel Supplies 2 USDC"*. The agent
cannot pay an address it was given in chat or email; it can only use payees the owner registered.

### Headless checks (no browser)

```bash
cd agenPay/agenpay-backend
node scripts/near-e2e.mjs        # vault lifecycle on testnet incl. refusals -> evidence/near-testnet-e2e.txt
node scripts/api-smoke.mjs       # full HTTP flow (server must be running) -> evidence/api-smoke-testnet.txt
node scripts/intents-quote.mjs   # live NEAR Intents 1Click dry quotes, no keys needed -> evidence/intents-dry-quote.txt
```

Contract tests (Linux/WSL):

```bash
cd contracts
cargo test -p skypay-vault --lib                                   # 19 unit tests
cargo build --release --target wasm32-unknown-unknown && cargo test -p skypay-vault --test sandbox   # real token, real callbacks
```

### Deploying your own copy

1. **Database:** create a Neon (or any Postgres) database, then from `agenPay/agenpay-backend` run
   `DATABASE_URL=<url> npx prisma db push`.
2. **API:** create a Render service from `render.yaml` (Blueprint). Paste the `sync: false` values: `DATABASE_URL`,
   the NEAR values from your `.env.near`, `GEMINI_API_KEY`, Notion OAuth keys, and set `BASE_URL` /
   `NOTION_REDIRECT_URI` to the service URL (`https://<service>.onrender.com/api/notion/callback`).
3. **Frontend:** import the repo on Vercel with root directory `agenPay/agenpay-frontend` and
   `NEXT_PUBLIC_API_URL=https://<service>.onrender.com`.
4. Set `FRONTEND_URL` on the API to the Vercel URL (CORS and links in emails), and add the Notion redirect URI to
   your Notion integration.
5. Keep the sponsor funded: `npm run near:bootstrap` locally (same `.env.near`) tops it up from the testnet faucet.

---

## Repository map

| Path | What |
|---|---|
| `contracts/vault` | Operating vault contract (Rust, near-sdk 5.30) + unit and sandbox tests |
| `contracts/test-ft` | Test NEP-141 token with open mint (testnet stand-in for USDC) |
| `agenPay/agenpay-backend/lib/near/` | NEAR adapter, relay guard, integer money helpers |
| `agenPay/agenpay-backend/lib/skypay.js` | Invoice, settlement, payee and vault-payment rules |
| `agenPay/agenpay-backend/lib/nearRouter.js` | HTTP routes (private + public checkout + CSV) |
| `agenPay/agenpay-backend/lib/outbox.js` | Idempotent email / Notion jobs |
| `agenPay/agenpay-backend/lib/intents.js` | NEAR Intents 1Click adapter (dry quotes only) |
| `agenPay/agenpay-frontend/app/finance` | Owner workspace |
| `agenPay/agenpay-frontend/app/invoice/[id]` | Public checkout page |
| `evidence/` | Test output and live testnet transcripts with explorer links |
| `docs/legacy/` | Pre-hackathon (Sei/EVM) documentation, kept for reference |

## Hackathon disclosure

* **Baseline.** SkyPay (formerly AgenPay) existed before the hackathon as an EVM app on Sei testnet with an AI
  agent, email and Notion integration. That code is the commit tagged
  [`baseline-pre-near`](../../tree/baseline-pre-near). All NEAR work is after it:
  **[compare baseline-pre-near...main](../../compare/baseline-pre-near...main)**.
* **New during the hackathon:** the vault contract and tests, test token, NEAR adapter and sponsored relay,
  invoice/settlement model, outbox, CSV exports, agent NEAR tools, Finance and invoice pages, a self-hosted
  x402 facilitator on NEAR (`lib/x402.js`: `/x402pay/:id`, `/x402/supported|verify|settle`), NEAR Intents 1Click
  dry-quote checkout panel (`lib/intents.js`), evidence. The current recovery hardening is described in docs/VALIDATION.md; concurrent payroll/employee edits are separate user work.
* **Removed:** the legacy Sei/EVM code (Privy wallet, Sei x402 service and facilitator, wagmi/RainbowKit) was
  deleted from backend and frontend; it survives only in the `baseline-pre-near` tag and `docs/legacy/`.
* **Tools and libraries:** near-sdk-rs, near-contract-standards, near-workspaces, near-api-js, Express, Prisma,
  Next.js, LangChain/LangGraph. Code in this hackathon window was written with AI assistance (Claude Code and Codex).
* No competitor code was reused.

## Known limitations

See [CLAIMS.md](CLAIMS.md#limitations) and [MIGRATION.md](MIGRATION.md) for design decisions. In short: testnet only,
test token instead of USDC, cross-chain (NEAR Intents) is quote-only, batches have incomplete crash recovery, refunds are not automated, and the owner key lives in browser
storage (with a downloadable backup).
