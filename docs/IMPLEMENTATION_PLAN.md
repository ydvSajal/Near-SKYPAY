# Delivery plan

Research: November 14, 2026 IST. Deadline verified at November 14 23:59 UTC. Initial remaining time approximately 28 hours. Reserve the final 4 hours for clean setup, demonstration and human-controlled publishing/submission. No new integrations should displace the core workflow.

| Priority / user problem | Gap and approach | Competitive reason | Dependencies / estimate | Acceptance / status |
|---|---|---|---|---|
| P0 reliable records | Commit invoice/settlement with delivery jobs | Cascade and Remiglo emphasize reconciliation; lost receipts undermine the complete workspace | Existing Prisma transaction, 1h | Stub rollback and repeated settlement tests pass; implemented, real DB check pending |
| P0 safe recovery | Never call unknown failed from one absent read; validate evidence; startup scan never resends | Durable status polling is visible in Cascade source | RPC/ledger, 1h | Recovery and tenant tests pass; implemented |
| P0 no duplicate messages | Quarantine crashed external jobs rather than blindly retry acceptance | Accurate outcomes matter more than broad feature claims | Existing outbox, 1h | Stale-claim test passes; implemented with explicit manual recovery limitation |
| P0 correct checkout | Reject wrong/expired quote, preserve invoice amount and safe CSV | Invoice-link/Settleform overlap directly | Provider adapter, 1h | Contradictory-output and expiry tests pass; implemented |
| P0 native authority evidence | Preserve native vault; rerun direct unit and sandbox tests, verify deployed code hash, keys and NEP-148 decimals | Bursar/Payables show caps are baseline expectations | Rust/Linux, RPC, 2h | Source reviewed, historical evidence exists; fresh execution blocked by environment |
| P0 reproducible full workspace | Correct env template, document exact demo, verify Postgres/HTTP/email/Notion | Email plus Notion distinguishes SkyPay only when connected | Local Postgres, test mail/Notion account, 2?4h | Templates/docs updated; external delivery not verified |
| P0 cross-chain collection | Add durable bound checkout attempts, exact-output executable quotes and status/refund tracking, verify final NEAR token delivery before paid | Cascade provides a deeper checkout than SkyPay's preview | Mainnet adapter, provider API, per-chain refund validation, 6?10h + authorized small mainnet execution | NOT implemented; existing testnet adapter refuses mainnet. Do not claim cross-chain payment |
| P0 sponsor operations | Method argument schema implemented and tested; durable per-company cost caps/nonces, metadata/storage bounds, sponsor low-balance handling | NearHr onboarding claim raises usability bar | Sponsor RPC and owner signature, 3?5h | Guard and new argument validation unit-tested; complete no-NEAR-purchase path unverified this run |
| P1 optional refinements | Invoice creation idempotency; durable batch lines; robust Notion mappings and provider idempotency | Make current workflow reproducible | DB migrations and concurrency tests, 3?5h | Open; no scope expansion into new payroll features |
| Deferred | New x402, additional networks, multi-agent systems, arbitrary treasury automation | Feature accumulation dilutes core evidence | N/A | Deferred |

The handoff target is not fully met. Missing mainnet execution permission is a live-evidence blocker, not an excuse to label a dry quote as payment. Current safe release candidate is a native testnet demonstration, subject to fresh DB/build/contract validation. Mainnet enablement needs implementation as well as authorization; flipping RPC variables is insufficient.
