# Claims and evidence boundaries

[Project README](README.md) | [Validation details](docs/VALIDATION.md) | [Evidence index](evidence/README.md)

This file summarizes current claim support. Source references establish implementation; local tests establish only the boundaries they exercise; supplied integration transcripts are not fresh independent observations. No mainnet payment or production security audit is claimed.

## Current support matrix

| Claim | Implementation / check | Supported level and limit |
|---|---|---|
| Native NEAR controls allocated operating funds | contracts/vault; owner, agent, payee, budget and expiry checks | Source, historical direct unit/sandbox logs and supplied testnet transcripts. Rust unavailable in latest recheck |
| Company and agent authority are separate | Browser owner key; NearService.provision deletes vault keys and restricts agent key to pay | Implemented; supplied provisioning evidence. Actual deployed access keys should be inspected for the deployment being demonstrated |
| Owner company actions can be sponsored | createSignedMetaTransaction, restricted relayGuard, provisioned deposits/storage | Local guards and supplied testnet relay evidence. Requires funded infrastructure; process-local rate/replay controls are not durable sponsor budgets |
| Financial records require verified incoming payment | FINAL pinned-token receipts, receiver/amount/network and invoice memo; unique settledTxHash | Local tests and supplied memo-bound testnet run. Anyone may pay the right invoice; test token has no value |
| Invoice and settlement delivery jobs are durable | Same Prisma transaction for invoice/settlement and outbox jobs | Local rollback/retry tests; supplied real-Postgres smoke. Actual SQL failure injection/concurrent rollback remains open |
| Duplicate supplier request identity cannot silently change purpose | Recipient/amount/memo comparison, on-chain request hash | Local changed-payload tests and supplied contract replay evidence. Omitting a stable request key can create a new payment |
| Recovery does not blindly resend | ReconciliationWorker reads unresolved attempts and validates final contract state | Local tests; actual killed-process restart not independently reproduced |
| Concurrent same-name payroll reserves one run | Deterministic company/name primary key before dispatch | Local concurrency/uniqueness-double test. No schema migration required; independent real-Postgres race test not performed |
| Unknown payroll is not called failed | Batch stays processing when any line outcome is uncertain; used names remain blocked | Local regression test. Unfinished-line/aggregate recovery remains incomplete; a different name is intentionally a new run |
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
- Exactly-once external delivery, automatic recovery from failed native callbacks, durable batch line scheduling or complete batch aggregate recovery.
- Guaranteed automatic refunds, accumulated partial-payment collection, reminders or audited operational fee accounting.
- A fresh successful production build in the restricted runner, a reproduced Rust build, or independent live replay of every supplied integration transcript.

## Latest local checks

At base commit 4bf6e21 plus the reviewed working tree: **42 backend tests**, **6 payroll tests**, frontend TypeScript, ESLint and Prisma schema validation passed. WASM artifacts matched the committed manifest. Production build stopped at spawn EPERM; Cargo was unavailable. See [exact commands and actual results](docs/VALIDATION.md) rather than inferring live behavior from counts.

These are observations from the latest engineering recheck, not promises that subsequent changes will preserve the same counts. The documentation-only revision did not rerun payment scripts or send external communications.

## Reuse and provenance

The baseline-pre-near tag marks the Sei-to-NEAR migration boundary, not independent proof of pre-event authorship. The README discloses reused agent/email/Notion work and new NEAR components. Supplied evidence includes earlier sponsor identities and different account names; do not combine them into one fictional deployment or present their transaction references as a new demonstration.
