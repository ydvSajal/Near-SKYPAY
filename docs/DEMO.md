# Reproduce the demonstration

Start in the nested Git root. Node 22+ and installed npm dependencies are required. The following offline checks use test doubles for DB/provider/RPC, and do not send messages or spend funds:

```powershell
cd agenPay/agenpay-backend
node --test --test-isolation=none test/*.test.js
cd ../agenpay-frontend
node node_modules/typescript/bin/tsc --noEmit
node --test --test-isolation=none lib/payroll-core.test.ts
```

See 38 backend checks and 5 payroll checks pass, plus a successful TypeScript exit. Recovery tests demonstrate exact invoice amount, atomic delivery jobs, one financial settlement on retry, wrong-token rejection, changed-memo rejection, tenant isolation, no blind restart resends and ambiguous email quarantine. These are simulations of boundaries, not a real contract or provider demonstration.

For a full native testnet app, follow README setup with a disposable local Postgres database, fresh strong secrets, `.env` from backend `.env.example` and `.env.near` from `.env.near.example`. Run `npm ci`, `npx prisma generate`, `npx prisma db push` against that disposable database. Review `npm run near:bootstrap` before running: it creates/funds testnet infrastructure. Never point db push at a shared database without reviewing the schema diff. Start `node server.js`; run frontend `npm ci`, `npm run build`, `npm start` in a second terminal. If a restricted runner reports spawn EPERM, perform build in a normal development shell; this session did not verify that build.

Judge walkthrough (native test token only):

1. Register, configure business profile, create company footprint and download owner key backup. Inspect company/vault/agent account links and actual access keys.
2. Start agent with configured model key; request 10 USD from a controlled test inbox for Design. Verify a single invoice, line items, amount and checkout link. Without model key, create the same invoice through Finance; label this as form-based creation.
3. With email credentials removed, observe fixture mail output. To prove actual delivery, explicitly authorize a message to a controlled inbox and configure SMTP; fixture output does not meet delivery acceptance.
4. Open checkout. Choose an Intents source asset/refund address and fetch a preview; show dry-quote and non-executable labels. Do not send to any preview address. Intents has no testnet.
5. Pay test tUSDC on NEAR using a testnet wallet or the clearly labeled testnet demo payer. Verify receiver/token/amount in transaction and invoice, receipt job, Notion projection and matching CSV. Notion needs a controlled authorized workspace; show fixture when absent.
6. Owner obtains test token and funds vault through ft_transfer_call. Set agent 25/payment and 40/day; approve an existing testnet supplier. Pay 20, then try 30 (per-payment refusal), 21 (daily refusal), revoke and retry (revoked refusal).
7. Reuse payment ID and unchanged payload: one transfer. Change amount/memo: refuse. Restart backend with unresolved attempts: only reads occur. Show unknown outbox claims require review.

Headless scripts already present: `node scripts/api-smoke.mjs` and `node scripts/agent-smoke.mjs` (require running API, may invoke configured integrations); `node scripts/near-e2e.mjs` submits testnet transactions; `node scripts/intents-quote.mjs` requests dry live quotes. None were run this review because live network access was blocked and communications were not authorized. Existing logs are historical, not fresh results.

Native tests on Linux/WSL with Rust and wasm target:

```sh
cd contracts
cargo test -p skypay-vault --lib
cargo build --release --target wasm32-unknown-unknown
cargo test -p skypay-vault --test sandbox
```

No mainnet demonstration is available: it needs executable checkout implementation, audited attempt binding, fresh deployment checks and explicit spending authorization. Never present the above testnet flow as cross-chain USDC collection.
