# Migration: Sei/EVM baseline → native NEAR

From tag `baseline-pre-near` (AgenPay on Sei testnet) to `main`. What was found is in [AUDIT.md](AUDIT.md); what is
proven is in [CLAIMS.md](CLAIMS.md). This file records the decisions and how old pieces map to new ones.

## Decisions

| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| D1 | Native NEAR L1, Rust vault compiled to WASM (`contracts/vault`) | Spending limits must hold even if SkyPay's server is compromised | Solidity on Aurora (not a NEAR-native port); limits kept in the database (baseline behaviour, no real enforcement) |
| D2 | One vault contract per company, created by `NearService.provision` | Tenant isolation is structural; no shared-ledger accounting to get wrong | Shared multi-tenant vault (needs dedicated isolation proofs) |
| D3 | Vault has **no access keys** after deploy | Nobody, including SkyPay, can upgrade code or move funds outside `pay` / `withdraw` | Upgradeable vault (adds an admin key that becomes the real authority) |
| D4 | Receiving account ≠ operating vault | Client revenue must not silently raise an agent's budget; the owner explicitly funds the vault | Invoices paid straight into the vault (NEP-141 `ft_transfer` would not run the funding hook) |
| D5 | Owner key generated in the browser; only the public key reaches the server | Company, not SkyPay, owns the account | Privy server wallet (baseline: server could sign anything) |
| D6 | Agent = separate account with a function-call key limited to `vault.pay` | The key cannot transfer tokens, add keys or change limits; the vault checks the caller | Agent ID passed in JSON; full-access agent key |
| D7 | Gas sponsorship via NEP-366 delegate actions + allow-list (`relayGuard.js`) | Company never buys NEAR; relayer cannot be used for arbitrary transfers | App holding owner keys to "save gas" |
| D8 | Settlement = NEP-141 `ft_transfer` event from the pinned token in a successful receipt | A client-supplied hash or a screenshot cannot mark an invoice paid | Trusting the transaction's top-level status or the client's claim |
| D9 | Money as integer base-unit strings (`lib/near/units.js`) | No float drift in invoices, limits or CSV | Baseline `Float` columns |
| D10 | Durable outbox for email and Notion (`lib/outbox.js`) | Side effects retry without changing payment truth; receipt only after settlement | Inline sends from agent tools (baseline) |
| D11 | Testnet with a SkyPay test token (`contracts/test-ft`) | Real USDC does not exist on testnet; token is a config value (`NEAR_USDC_CONTRACT`) | Claiming mainnet behaviour without running it |
| D12 | NEAR Intents 1Click as **dry quotes only** (`lib/intents.js`) | Intents has no testnet; a real quote is honest, a fake settlement is not | Fixture "cross-chain paid" state |
| D13 | Self-hosted x402 facilitator on NEAR (`lib/x402.js`) | Same verification and accounting as invoices; exact-shape `ft_transfer` only | Keeping the Sei x402 path (baseline marked paid on timeout) |

## Old → new mapping

| Baseline (Sei/EVM) | NEAR replacement | Status |
|---|---|---|
| `WalletService.js` (Privy server wallet, ethers) | `lib/near/NearService.js` (near-api-js), browser owner key in `agenpay-frontend/lib/near.ts` | replaced, old removed |
| `SchedulingService.executeOutgoingPayment` (DB-driven sends) | `SkyPay.paySupplier` → agent key → `vault.pay` (limits on-chain) | replaced, old removed |
| `X402PayService.js` + Sei facilitator | `lib/x402.js` (`/x402pay/:id`, `/x402/supported|verify|settle`) | replaced, old removed |
| `OKXDexService.js` (mocked) | `lib/intents.js` (live 1Click dry quotes) | replaced, old removed |
| `AgentPayAgent.sendPaymentEmail` (inline) | `Outbox.enqueue` jobs, idempotency key per invoice/job | replaced |
| `NotionService.updateOrCreateIncomingPaymentRecord` | same function, now called from the outbox | reused |
| Agent tools (EVM transfers) | typed tools `create_invoice`, `list_payees`, `pay_supplier`, … (registered payees only) | rewritten |
| wagmi / RainbowKit / viem frontend | NEAR-only Finance workspace + `/invoice/[id]` checkout | replaced, old removed |
| Prisma `Float` amounts, EVM addresses | `Invoice`, `PaymentAttempt`, `Payee`, `SponsorLedger`; string base units, network-qualified (`near:testnet`) | migrated |
| `npm test` → missing file | `node --test` suites + `cargo test` (unit + sandbox) | fixed |

## Ownership and authority after migration

| Can… | Owner | Agent key | SkyPay backend | Sponsor relayer |
|---|---|---|---|---|
| Fund vault / withdraw available funds | yes | no | no | no |
| Set limits, add payees, revoke agent | yes | no | no | relays only what the owner signed |
| Pay an allow-listed payee within limits | — | yes | via the agent key, so same limits | no |
| Upgrade vault code | no one (no keys) | no | no | no |
| Pay gas | — | — | — | yes |

Recovery: the owner withdraws available funds from the vault and revokes the agent. The owner key's only copy is the
browser plus the downloadable backup; losing both loses control of the company account (see SECURITY.md).

## Not migrated

* Cross-chain execution (needs mainnet + an authorized amount); real USDC; batches; automated refunds and reminders.
* Sei-era scheduled payments: removed rather than ported, because they bypassed spending limits.
