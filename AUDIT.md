# Baseline audit (tag `baseline-pre-near`, 13 Nov 2026)

What the pre-hackathon SkyPay/AgenPay code actually did, before any NEAR work. Statuses: working / partial / missing / broken.

| Area | Status | Evidence | What we changed |
|---|---|---|---|
| Chain | Sei testnet (EVM) only; no NEAR code | `WalletService.js`, `X402PayService.js` | Native NEAR adapter + Rust vault |
| Company wallet | partial: Privy server wallet signs for the agent | `WalletService.sendBlockchainTransaction` | Company account key generated in browser; server never holds it |
| Agent spending limits | **missing**: scheduler sent whatever a DB row said | `SchedulingService.executeOutgoingPayment` | Limits, payees, expiry, replay enforced on-chain |
| Incoming tracking | partial: native SEI verified; x402 path marked paid on timeout if a header was present | `X402PayService.js` (timeout handler) | Event-based NEP-141 verification; closes once |
| Money representation | broken for accounting: `Float` columns | `prisma/schema.prisma` | Integer base-unit strings |
| Outgoing failure handling | partial: any error marked `failed`, even if a tx may have landed | `SchedulingService` | Attempt persisted first; `unknown` + reconcile |
| Email | working, sent inline from an agent tool | `AgentPayAgent.sendPaymentEmail` | Idempotent outbox; receipt only after settlement |
| Notion | working: workspace setup, upsert by request id | `NotionService.updateOrCreateIncomingPaymentRecord` | Reused from the outbox |
| CSV export | missing | — | `invoices.csv`, `payments.csv` |
| Gas sponsorship | missing | — | Delegate-action relay with allow-list |
| Cross-chain | missing (OKX DEX module mocked/disabled) | `OKXDexService.js` | Not built (testnet) |
| Tests | broken: `npm test` pointed at a missing file | `package.json` | `node --test` suites + Rust tests |
| Build | `agent.js` failed syntax check (duplicate exports); frontend failed after dependency update | — | Fixed in baseline commit |
