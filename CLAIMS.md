# Claims, evidence and limitations

Every public claim about SkyPay maps to code, a check you can run, and recorded evidence.
Status legend: **testnet** = executed on NEAR testnet (explorer links in `evidence/`), **sandbox** = executed against a
local NEAR sandbox node with real contracts, **unit** = deterministic test, **fixture** = runs without external
credentials and logs instead of sending, **not built** = not in this submission.

Evidence files:
* `evidence/contract-tests.txt` — `cargo test` output (19 unit + 1 sandbox scenario)
* `evidence/near-testnet-e2e.txt` — vault lifecycle on testnet, including refusals (12 Nov 2026 UTC)
* `evidence/api-smoke-testnet.txt` — full HTTP flow against the running backend on testnet
* `evidence/x402-testnet.txt` — x402 pay link paid by a gasless payer on testnet, then replayed (13 Nov 2026 UTC)
* `evidence/agent-smoke-testnet.txt` — agent creates an invoice, pays an allowed payee, refuses a chat-supplied address and an over-limit payment
* `evidence/intents-dry-quote.txt` — live NEAR Intents 1Click dry quotes (Base/Arbitrum USDC, ETH, SOL → 10 USDC on NEAR)
* `npm test` in `agenPay/agenpay-backend` — 12 node:test cases (money, guards, x402, intents)

> `near-testnet-e2e.txt`, `api-smoke-testnet.txt` and `agent-smoke-testnet.txt` were re-run on 13 Nov 2026 with the
> current sponsor (`skypay-sponsor-f97ec0.testnet`, top-level account names). `x402-testnet.txt` pays an invoice owned by
> an account under the earlier sponsor (`skypay-relayer-88e39d.testnet`), whose key was later lost locally; its
> on-chain transactions remain verifiable through the explorer links.

## Feature matrix

| Claim | Code | Check | Status |
|---|---|---|---|
| Company buys no NEAR; account, vault and agent are created and funded by the sponsor | `NearService.provision` | api-smoke step 2 | testnet |
| Owner key is generated in the browser; server never receives it | `agenpay-frontend/lib/near.ts` | code review: only the public key is POSTed | implemented |
| Owner policy actions are gasless (NEP-366 delegate actions paid by relayer) | `NearService.relay`, `lib/near.ts ownerAction` | e2e "owner policy via sponsored delegate actions"; api-smoke 11-13 | testnet |
| Sponsor only relays vault policy methods and funding of the company's own vault | `relayGuard.checkDelegate` | `npm test` A21/A22; e2e "sponsor refuses abuse"; api-smoke 14 | unit + testnet |
| Vault enforces per-payment limit | `vault/src/lib.rs pay` | unit `a09_*`; sandbox; e2e `e2e-2`; api-smoke 17 | unit + sandbox + testnet |
| Vault enforces daily limit, including concurrent unresolved payments | `pay` reserves before transfer | unit `a10_*`; sandbox; e2e `e2e-4`; api-smoke 18 | unit + sandbox + testnet |
| Only allow-listed payees can be paid | `pay`, `add_payee` | unit `a09_unlisted_recipient_refused`; sandbox | unit + sandbox |
| Same payment id never pays twice; changed payload is rejected | `pay` request hash | unit `a11`, `a12`; sandbox; e2e replay; api-smoke 16 | unit + sandbox + testnet |
| Revoked or expired agent is refused | `pay` | unit `a13_*`; sandbox; e2e `e2e-5` | unit + sandbox + testnet |
| Failed token transfer releases the reservation exactly once | `on_paid` | unit `a14_*`; sandbox (unregistered recipient) | unit + sandbox |
| Random accounts cannot spend, set limits or withdraw | `assert_owner`, agent lookup | unit `a26_*`; sandbox | unit + sandbox |
| Only owner deposits of the pinned token are credited; others refunded | `ft_on_transfer` | unit `funding_*`; sandbox | unit + sandbox |
| Owner can withdraw only unreserved funds | `withdraw` | unit `a25_*`; sandbox | unit + sandbox |
| Vault code is immutable (all keys deleted after deploy) | `NearService.provision` step 2 | explorer: vault account has no access keys | testnet |
| Agent key can only call `vault.pay` | function-call key in `provision` | explorer: agent access key permissions | testnet |
| Invoice amounts are exact integers (no float drift) | `lib/near/units.js` | `npm test` money | unit |
| Invoice marked paid only after on-chain verification of token, receiver and amount | `NearService.evaluateReceipt`, `SkyPay.confirmInvoicePayment` | `npm test` A06/A05; api-smoke 5-6 | unit + testnet |
| Invoice closes once; one transaction cannot settle two invoices | `confirmInvoicePayment` (status-guarded update + unique tx hash) | api-smoke 7-8 | testnet |
| Receipt email only after verified settlement; email/Notion failures never change payment status | `outbox.js` | api-smoke + outbox rows | fixture |
| Duplicate jobs do not send duplicate emails | `Outbox.enqueue` unique idempotency key | outbox table | implemented |
| Accountant CSV: UTC, fixed decimals, tx links, formula injection neutralised | `csvExport.js` | `npm test` A23/A24; api-smoke 20-21 | unit + testnet |
| Companies cannot read each other's records | all private queries filter by `req.user.id` | api-smoke 22 | testnet |
| Agent never takes payout addresses from chat/email; only owner-registered payees | `AgentPayAgent.buildSkyPayTools`, `SkyPay.findPayee` | `scripts/agent-smoke.mjs` (needs LLM key); `evidence/agent-smoke-testnet.txt` | testnet |
| x402 pay link: HTTP 402 with exact NEAR requirements; payer signs one gasless `ft_transfer` delegate; self-hosted facilitator verifies and settles | `lib/x402.js` | `npm test` x402; `scripts/x402-pay.mjs`; `evidence/x402-testnet.txt` | unit + testnet |
| Facilitator relays only an exact-shape `ft_transfer` to the invoice receiver; replay returns the existing receipt | `lib/x402.js` payment-delegate guard | `npm test` x402; replay step in `evidence/x402-testnet.txt` | unit + testnet |
| Unknown outcomes are reconciled from chain, not resent | `SkyPay.reconcile` | code review | implemented, not exercised live |
| Checkout shows a live NEAR Intents 1Click quote (EXACT_OUTPUT to USDC on NEAR) for a payer-chosen source asset, with fee, time and expiry; amount and destination come only from the invoice | `lib/intents.js`, `CrossChainQuote` in `app/invoice/[id]/page.tsx` | `npm test` intents; `scripts/intents-quote.mjs`; `evidence/intents-dry-quote.txt` | unit + **live mainnet dry quote** |
| Payer connects a NEAR wallet (Wallet Selector: MyNearWallet, Meteor), approves one `ft_transfer`; the page auto-submits the hash and the backend verifies it on-chain before closing | `agenpay-frontend/lib/nearWallet.ts`, `app/invoice/[id]/page.tsx`, `SkyPay.confirmInvoicePayment` | wallet picker opens (browser check); verification covered by `npm test` A06/A05 | implemented; wallet approval not yet exercised end-to-end |
| Notion dashboard (text-only layout: key figures, record pages, recent activity) is built once and then updated in place from the database after invoice and supplier-payment events | `lib/notionDashboard.js`, `lib/outbox.js syncDashboard`, `scripts/notion-rebuild.mjs` | `npm test` (key figures from ledger); live: numbers match the app | live Notion |
| Notion workspace setup runs as a retried outbox job (native fetch) and backfills existing invoices | `lib/outbox.js notionSetup`, `lib/NotionService.js` | live: dashboard + 3 databases created, INV-0001 upserted | live Notion |
| Pay from another chain via NEAR Intents (deposit address, execution, settlement tracking) | — | — | **not built** (no Intents testnet; quotes are `dry: true`) |
| Real USDC | — | — | **not built** (test token on testnet) |

## Acceptance checks from the build brief

| ID | Result |
|---|---|
| A01 invoice by prompt | agent tool `create_invoice`; HTTP path tested (api-smoke 3) |
| A02 email without wallet | invoice uses company account; no payout address is invented |
| A03 repeated email job | idempotency key per invoice/job |
| A04 cross-chain route shown | live 1Click dry quote: token, network, amount to send, fee, time, expiry (`evidence/intents-dry-quote.txt`); not executable |
| A05 insufficient deposit | unit test: below-total transfer rejected; invoice stays pending |
| A06 settles once | api-smoke 6-8 |
| A07 Notion/email failure | outbox retries; settlement already committed |
| A08 allowed supplier payment | sandbox, e2e, api-smoke 15 |
| A09 over limit / other destination | unit, sandbox, testnet |
| A10 racing near cap | unit `a10_second_request_cannot_exceed_daily_cap` (reservations) |
| A11 / A12 replay | unit, sandbox, testnet |
| A13 revoked / expired | unit, sandbox, testnet |
| A14 transfer/callback failure | unit, sandbox |
| A15 worker crash after submit | attempt persisted before dispatch, `unknown` + reconcile; not crash-tested |
| A16 batch | **not built** |
| A17 cross-company access | api-smoke 22 |
| A18 instructions inside email/invoice | agent prompt + tool design; payees owner-only |
| A19 substituted cross-chain quote | **not applicable** (no cross-chain payout) |
| A20 missing credentials | fixture mode for email/Notion; demo payer labeled; test token labeled |
| A21 user has no NEAR | provisioning + sponsored delegate actions |
| A22 arbitrary/expired/replayed relay | unit + testnet refusals |
| A23 / A24 CSV | unit + testnet |
| A25 fund / revoke / withdraw | unit, sandbox, testnet |
| A26 bypass backend | sandbox (attacker calls vault directly) |

## Limitations

* **Testnet only, test token.** `tUSDC` is a SkyPay-deployed NEP-141 with open minting. It has no value. Pointing
  `NEAR_USDC_CONTRACT` at a real USDC contract is a config change, but mainnet is not tested.
* **Cross-chain is quote-only.** The checkout fetches real 1Click quotes (`dry: true`), but no deposit address is
  issued and nothing is executed: NEAR Intents has no testnet, and a testnet invoice cannot receive mainnet USDC, so
  testnet quotes are priced to a placeholder mainnet recipient (`INTENTS_QUOTE_RECIPIENT`, default `intents.near`).
  Observed unauthenticated provider fee in the quote: 0.01% stable→stable, 0.2% for volatile assets.
* **Demo payer.** On testnet, the "Pay with testnet demo wallet" button sends a real testnet transaction from
  SkyPay's sponsor account. It is clearly labeled and goes through the same verification as any payment.
* **Owner key in browser storage.** Convenient for the demo; a downloadable backup is offered. A wallet-selector
  integration (hardware/extension wallets) is future work.
* **Sponsor trust.** The relayer pays gas and creates accounts. It cannot move company funds, but if it is offline,
  owner actions need gas from the owner account itself.
* **Agent key custody.** The agent's restricted key is stored encrypted (AES-256-GCM) in the backend database. A
  stolen key can only call `vault.pay` within the on-chain limits.
* **Refunds, partial payments, batches and receivables reminders** are not automated.
* **Underpayment** keeps the invoice pending; overpayment is accepted and recorded (settled amount > amount due).
* **Single-process rate limits** and relay replay cache are in memory.
