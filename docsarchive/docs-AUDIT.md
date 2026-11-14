> Rechecked against commit `4bf6e21` and the working tree: 42 backend tests, 6 payroll tests, frontend type checking, lint and Prisma schema validation pass. See VALIDATION.md for current evidence; the baseline section below describes the initial review.

# SkyPay evidence audit

Research date: 2026-11-14 IST. Runtime clock reported 2026-11-13 19:56:22 UTC (2026-11-14 01:26 IST); the initial budget was approximately 28 hours until the [verified deadline](https://nearhackathon.com/HACKATHON.md), 2026-11-14 23:59 UTC / November 15 05:29 IST. Use UTC when planning; do not mistake the local date for deadline passage.

## Baseline and scope

Actual Git root is the nested `SKYPAY_FINAL-1df6e7f` directory. Branch `main`, starting HEAD `0f34799`. No applicable AGENTS.md found in the workspace or checked ancestors. Read the adjacent `SkyPay_NEAR_Agent_Handoff.md` revision 2 as specification. Its intended journey exceeds the current implementation.

Initial dirty files: backend `lib/NotionService.js`, `lib/outbox.js`, `lib/skypay.js`, `prisma/schema.prisma`. Additional agent, payroll and frontend files changed concurrently during this session; preserved. This review did not author those extensions or rewrite the frontend. No commit, push, deployment, transaction signing, real email or Notion mutation was performed.

`baseline-pre-near` resolves to `9037671`, dated November 13. This is a migration boundary, not independent proof of pre-event authorship. It contains the reused Sei/EVM product. Inspect `git diff baseline-pre-near..0f34799` for the pre-existing NEAR migration and `git diff 0f34799` for the combined current work (including user edits). Event rules allow eligible work since October 19; dates and authorship need final human confirmation. Historical root AUDIT.md describes the earlier migration, not this validation run.

## Components and traced paths

Next.js 15 frontend; Express `server.js`; Prisma/Postgres ledger; `AgentPayAgent.js` typed LangChain tools; browser-generated owner key in `frontend/lib/near.ts`; Wallet Selector in `nearWallet.ts` for payer signing; native Rust vault and open-mint test FT; SMTP outbox; Notion OAuth and workspace adapter. No active Sei RPC migration is needed: native NEAR code already exists. Backend `.env.example` was stale Sei configuration and has been corrected. Names only were inspected in actual env files; secret values were not printed.

Incoming: authenticated route/tool -> SkyPay.createInvoice -> invoice and outbox jobs -> public checkout -> NEP-141 transfer -> RPC FINAL token receipt -> invoice and attempt and receipt jobs in one DB transaction. Intents is a separate dry-quote preview only. Outgoing: authenticated payee lookup -> durable submitted attempt -> agent function-call key -> vault.pay -> reserve -> ft_transfer -> private callback -> read-only reconciliation -> Notion. Customer collection never credits vault accounting; owner funding uses ft_transfer_call with `msg: fund`.

## Findings

All paths below are relative to repository root. Status describes current evidence, not a production certification.

| Feature / status | File evidence and reproduction | Observation / impact / action |
|---|---|---|
| Native vault: partial | `contracts/vault/src/lib.rs`, `src/tests.rs`; `cargo test -p skypay-vault --lib` | Owner policy, allowlist, expiry, replay and reserved budgets exist in code. Rust absent here; direct execution unverified this run. Preserve and rerun on Linux. |
| Company custody: partial | `lib/near/NearService.js` provisionCompany, frontend `lib/near.ts`; inspect setup transactions | Owner full key generated in browser; vault deployment deletes keys; agent key restricted to pay. Deletion/provisioning claims need fresh RPC verification. Browser XSS/key backup remains risk. |
| Gas sponsorship: partial | `lib/near/relayGuard.js`, NearService.relay, frontend ownerAction; backend money-and-guards tests | Real delegate signing API present for browser key; this does not establish delegate support in external Wallet Selector wallets. Gas/receiver/method/deposit guards tested with fixtures. Rate/replay state is process-local, costs ledger often zero, registration deposit hardcoded; production sponsor budgets and nonce coordination remain gaps. |
| Invoice by instruction: partial | `lib/AgentPayAgent.js`, `lib/skypay.js`, `nearRouter.js`; authenticated create route and agent-smoke script | Tool invokes authenticated service. Unit test creates exact invoice; no fresh LLM/HTTP run. Invoice creation lacks caller idempotency key, so repeated instructions can issue two invoices. |
| Email checkout: partial | `lib/outbox.js` invoiceMail; email tests | Correct link, line items and escaped HTML tested. No current provider delivery observed. Fixture logging is not delivery. |
| Incoming verification: partial | NearService.evaluateReceipt; money-and-guards tests | Pinned token, receiver, minimum amount, successful receipt; FINAL RPC request. Added active token/network binding. Tx unique constraint prevents reuse. The current verifier requires the invoice number or ID in the transfer memo, including sponsored payer delegates. Payer identity is not restricted; anyone may pay the correct invoice. Executable cross-chain checkout-attempt binding remains missing. |
| Atomic jobs: working locally | skypay financialJobs; recovery tests | Previously a crash after DB commit could lose receipt/Notion jobs. Now jobs commit with invoice creation/settlement. Stub rollback and retry tests pass; real Postgres rollback/concurrency not exercised. |
| Supplier policy: partial | vault.pay, skypay.paySupplier; payouts and recovery tests | Owner registered payee plus direct contract restrictions. Added memo binding on retries and opaque on-chain purpose reference. Concurrent DB inserts still may return unique-constraint errors; chain ID prevents duplicate spend. |
| Recovery: working locally | skypay.reconcile, `lib/reconciliation.js`, server startup; recovery tests | Removed false failed result when payment absent. Validates agent/amount/recipient; new worker scans unresolved rows without resending. RPC failure retains uncertainty. Batch aggregate recovery remains incomplete. |
| Callback failure: partial | vault.on_paid, on_withdrawn and sandbox.rs | Transfer failure releases once; missing/failed callback leaves Reserved funds locked. No privileged override or blind retry. Recovery needs audited evidence-based design; do not redeploy immutable vaults to hide this. |
| Outbox restart: partial | outbox.processOnce; recovery tests | Expired running jobs become unknown after 15 minutes, avoiding blind duplicate delivery. An active long job can be quarantined. Ambiguous SMTP/Notion outcomes require operator review; automatic exactly-once external delivery is not claimed. |
| Notion: partial | NotionService upserts, outbox sync methods | Existing workspace/reporting retained. Provider outage does not change ledger. Create-before-local-mapping crash can still duplicate pages; setup/rebuild particularly needs review. This recheck did not perform live sync; supplied integration evidence reports API acceptance. |
| Intents collection: missing | `lib/intents.js`, public intents-quote route; intents tests | Only dry EXACT_OUTPUT quotes, no CheckoutSession, executable address or provider-status worker. Native adapter intentionally testnet-only. Complete real cross-chain collection remains a release blocker, not an implemented feature. |
| Quote safety: working locally | intents.js; intents tests | Reject contradictory output/minimum, zero input, expired/invalid provider deadline. Source catalog from API; no static fallback. Live availability and destination metadata require verification; refund validation is length-based only. |
| CSV: working locally | csvExport.js; money-and-guards/recovery tests | Integer amounts, UTC, quoting; hardened formula prefix against whitespace/control characters. Fees are not a measured cost ledger. Do not claim complete accounting compliance. |
| Tenant isolation: partial | authenticateToken, nearRouter private queries, skypay lookups; recovery test | Explicit user scope tested for reconciliation, payee tests cover foreign tenant. Not a complete HTTP/DB authorization audit. Public invoice URL is a bearer link exposing invoice/client details; sharing grants access. |
| Payroll/batches: partial | payBatch and payroll-core | Existing user work preserved; existing tests pass. Recheck: payroll names now use a deterministic primary key to reject races and reuse across failed/unresolved runs. Unknown outcomes keep the batch processing. Batch lines and aggregate recovery are still incomplete; a new payroll name intentionally creates new payments. |
| Privacy: partial | frontend near.ts, DB schema, vault arguments | Public transfers/accounts/amounts visible. New supplier references use opaque payment IDs; historical memos may contain descriptions. Email, invoice bearer links, Notion and LLM requests cross privacy boundaries. |
| Reproducibility: partial | package scripts, evidence directory; VALIDATION.md | 42 backend tests and frontend type check pass locally; build spawn blocked, cargo absent, live RPC/provider blocked. Supplied integration logs are distinguished from this recheck; see VALIDATION.md. |
| x402: out of scope | lib/x402.js and tests | Existing path preserved; do not expand before core invoice flow. |

Backend file references above use prefix `agenPay/agenpay-backend/`; frontend uses `agenPay/agenpay-frontend/`.
