# Claims and evidence boundaries

[Project README](README.md) | [Validation details](docs/VALIDATION.md) | [Evidence index](evidence/README.md)

This file summarizes current claim support. Source references establish implementation; local tests establish only the boundaries they exercise; supplied integration transcripts are not fresh independent observations. No mainnet payment or production security audit is claimed.

## Current support matrix

| Claim | Implementation / check | Supported level and limit |
|---|---|---|
| Native NEAR controls allocated operating funds | contracts/vault; owner, agent, payee, budget, expiry, reference-length and storage-reserve checks | 24 unit tests (incl. storage-reserve boundary) + sandbox scenario rerun November 14 on a fresh cargo-near rebuild (evidence/contract-rebuild-20261114-review.txt). A live company ran the first rebuild; the review-fix build (ba41312d…) is covered by unit/sandbox tests, not yet by a live provisioning. Older deployed vaults keep older code (no length caps) |
| Supplier bills are paid only to the registered supplier, once | lib/bills.js: registry match by email/claimed account, flags, status-claimed dispatch with deterministic payment id, crash repair, reconcile sync | 11 local tests (in-flight request vs crash repair, redirect attempt, duplicates, company boundary, refusal retry, unknown not resent, crash repair) and a live testnet run (evidence/bills-smoke-testnet.txt). Per-bill owner approval is enforced by the API, not the contract |
| Interrupted setup does not create duplicate accounts | NearService.provision persists encrypted keys and step progress before each chain action and checks chain state on resume | Local test crashes after every chain operation and resumes; live setup ran through the new path once. A real mid-setup crash on testnet was not reproduced |
| A wrong owner-key backup is refused before use | Frontend derives the public key and compares it with the registered owner key before storing | Browser check on November 14 with a random key: refused, nothing stored |
| Health reports database readiness | /health runs `SELECT 1` with a 3 s timeout; 503 when it fails | Live 200 observed locally; failure path not injected |
| Company and agent authority are separate | Browser owner key; NearService.provision deletes vault keys and restricts agent key to pay | Implemented; supplied provisioning evidence. Actual deployed access keys should be inspected for the deployment being demonstrated |
| Owner company actions can be sponsored | createSignedMetaTransaction, restricted relayGuard, provisioned deposits/storage | Local guards and supplied testnet relay evidence. Requires funded infrastructure; process-local rate/replay controls are not durable sponsor budgets |
| Financial records require verified incoming payment | FINAL pinned-token receipts, receiver/amount/network and invoice memo; unique settledTxHash | Local tests and supplied memo-bound testnet run. Anyone may pay the right invoice; test token has no value |
| Invoice and settlement delivery jobs are durable | Same Prisma transaction for invoice/settlement and outbox jobs | Local rollback/retry tests; supplied real-Postgres smoke. Actual SQL failure injection/concurrent rollback remains open |
| Duplicate supplier request identity cannot silently change purpose | Recipient/amount/memo comparison, on-chain request hash | Local changed-payload tests and supplied contract replay evidence. Omitting a stable request key can create a new payment |
| Recovery does not blindly resend | ReconciliationWorker reads unresolved attempts and validates final contract state | Local tests; actual killed-process restart not independently reproduced |
| Concurrent same-name payroll reserves one run | Deterministic company/name primary key before dispatch | Local concurrency/uniqueness-double test. No schema migration required; independent real-Postgres race test not performed |
| Unknown payroll is not called failed | Batch stays processing when any line outcome is uncertain; used names remain blocked; worker recomputes stale runs from persisted lines | Local regression tests. Lines never dispatched before a crash make the run partial, not done; they are not resumed automatically |
| Settled payments survive reporting failure | Sponsor cost-ledger failure isolated from payment outcome | Local regression test preserves settled status and transaction hash; cost entry repair remains operational work |
| CSV protects exact amounts and spreadsheet use | Integer token amounts, UTC, quoting, formula/control-character neutralization | Local tests; fixed merchant-fee field does not measure actual gas |
| Email/Notion report the business workflow | Durable outbox, invoice/receipt rendering, workspace projections | Local rendering tests plus supplied SMTP/Notion acceptance logs. Not exactly-once; SMTP acceptance does not prove inbox delivery/read |
| Agent operates through typed authenticated tools | AgentPayAgent and SkyPay services; owner-registered recipients | Source and supplied agent transcript. Payroll confirm is model-supplied, not a separately signed human approval |
| Cross-chain source pricing uses NEAR Intents | Catalog-derived source choices; dry EXACT_OUTPUT quote to mainnet USDC | Local adapter tests and historical provider dry quotes. Current route/fee availability is not guaranteed |
| x402 shares invoice verification | Self-hosted exact near-testnet mapping with memo checks | Local tests and supplied testnet transcript. Not an official protocol certification or cross-chain flow |

## Not implemented or not established

- Executable Intents checkout sessions, deposit handling, provider refund lifecycle and verified cross-chain collection.
- Mainnet-native payment support and real USDC settlement. The backend is intentionally testnet-only; token/RPC changes alone do not implement the missing workflow.
- Production readiness, confidential blockchain payments, independent security certification or a verified hackathon award/ranking.
- Exactly-once external delivery, automatic recovery from failed native callbacks, durable batch line scheduling or resuming undispatched batch lines.
- Owner-authorized invoice refunds, automatic refunds, accumulated partial-payment collection, reminders or audited operational fee accounting.
- On-chain per-bill approval, PDF bill extraction, agent key replacement/allowance renewal, social login, passkeys or custodial key recovery.
- A bit-for-bit reproducible WASM build (cargo-near `non-reproducible-wasm` was used), or independent live replay of every supplied integration transcript.

## Latest local checks

November 14, 2026: **58 backend tests**, frontend TypeScript and ESLint passed; **24 vault unit tests and the sandbox test** passed on a fresh rebuild in WSL; the supplier bill inbox ran live on testnet against a freshly provisioned company. See [exact commands and actual results](docs/VALIDATION.md) rather than inferring live behavior from counts.

These are observations from the latest engineering recheck, not promises that subsequent changes will preserve the same counts. The documentation-only revision did not rerun payment scripts or send external communications.

## Reuse and provenance

The baseline-pre-near tag marks the Sei-to-NEAR migration boundary, not independent proof of pre-event authorship. The README discloses reused agent/email/Notion work and new NEAR components. Supplied evidence includes earlier sponsor identities and different account names; do not combine them into one fictional deployment or present their transaction references as a new demonstration.
