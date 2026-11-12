# Security model

## Who can do what

| Actor | Authority | Enforced by |
|---|---|---|
| Company owner (browser key) | Fund vault, set/revoke agent, allow/remove payees, withdraw available funds | Vault contract (`assert_owner` = NEAR predecessor) |
| Agent account | Call `vault.pay` only, within limits, to allow-listed payees, before expiry | Function-call access key + vault contract |
| SkyPay backend | Create accounts, relay owner-signed actions, call `pay` with the agent key, record business data | Cannot sign as the owner; vault rules bind the agent key |
| Sponsor relayer | Pays gas | `relayGuard.checkDelegate` limits what it will submit; it never holds user authority |
| LLM | Proposes typed actions | No keys; tools re-check payee registration; vault enforces limits |
| Client / payer | Pays invoices | Settlement verified on-chain |

The vault has **no access keys** after deployment. Its code cannot be upgraded and its funds move only through
`pay` (agent, within limits) or `withdraw` (owner). Recovery is the owner withdrawing available funds.

## Trust boundaries

* **Model output is not authorization.** The agent can only call typed tools. `pay_supplier` resolves the payee from
  owner-registered records; free-text addresses from chat, emails or documents are never used.
* **Client claims are not settlement.** `confirmInvoicePayment` reads the transaction from a NEAR RPC node and accepts it only
  if NEP-141 `ft_transfer` events from the pinned token contract credit the invoice's receiving account with at least
  the invoice total, and the transaction has not settled another invoice. Trust assumption: the RPC endpoint
  (`NEAR_RPC_URL`) returns honest final data.
* **Notion and email are views.** They are updated from durable outbox jobs and never decide whether money moved.
* **Tenant isolation.** Every private query is scoped to the authenticated user id (JWT).

## Secrets

* `.env` and `.env.near` are gitignored. `.env.near` holds the sponsor key and the key-encryption secret.
* The agent's function-call key is stored AES-256-GCM encrypted with `NEAR_KEY_ENC_SECRET`.
* The owner's key never leaves the browser; only the public key is sent to provision the account.
* Git history was scanned for keys before publishing.

## Privacy

On-chain data is public: account names, token transfers, amounts and the invoice number used as the transfer memo.
Customer emails, names, line items and descriptions stay in the SkyPay database and are never written on-chain.
SkyPay does not claim confidential payments.

## Reporting

Please open a private security advisory on the GitHub repository.
