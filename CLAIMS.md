# Claims, evidence and limitations

Every public claim about SkyPay maps to code, a check you can run, and recorded evidence.
Status legend: **testnet** = executed on NEAR testnet (explorer links in `evidence/`), **sandbox** = executed against a
local NEAR sandbox node with real contracts, **unit** = deterministic test, **fixture** = runs without external
credentials and logs instead of sending, **not built** = not in this submission.

Evidence files:
* `evidence/contract-tests.txt` — `cargo test` output (19 unit + 1 sandbox scenario)
* `evidence/near-testnet-e2e.txt` — vault lifecycle on testnet, including refusals (12 Nov 2026 UTC)
* `evidence/api-smoke-testnet.txt` — full HTTP flow against the running backend on testnet
* `npm test` in `agenPay/agenpay-backend` — 6 node:test suites

> The testnet transcripts were produced by an earlier sponsor account (`skypay-relayer-88e39d.testnet`) whose key was
> later lost locally; the on-chain transactions remain verifiable through the explorer links. New runs use a new sponsor.

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
| Agent never takes payout addresses from chat/email; only owner-registered payees | `AgentPayAgent.buildSkyPayTools`, `SkyPay.findPayee` | `scripts/agent-smoke.mjs` (needs LLM key) | implemented |
| Unknown outcomes are reconciled from chain, not resent | `SkyPay.reconcile` | code review | implemented, not exercised live |
| Pay from another chain via NEAR Intents (1Click) | — | — | **not built** |
| Real USDC | — | — | **not built** (test token on testnet) |

## Acceptance checks from the build brief

| ID | Result |
|---|---|
| A01 invoice by prompt | agent tool `create_invoice`; HTTP path tested (api-smoke 3) |
| A02 email without wallet | invoice uses company account; no payout address is invented |
| A03 repeated email job | idempotency key per invoice/job |
| A04 cross-chain route shown | **not built** |
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
* **No cross-chain collection.** NEAR Intents has no testnet; the 1Click integration is not built.
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
