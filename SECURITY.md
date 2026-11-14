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
| Contractor (bill inbox link) | Submits a bill; reads its own bill's status | Cannot choose the payout account (taken from the owner's supplier registry); status page shows no flags or registry data; 20 submissions/hour/IP |

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
* **Bills are data, not payment instructions.** A bill's typed payout account is only compared with the registry and
  flagged (`payout_changed`) when it differs; payment always goes to the registered account. Bills are immutable after
  submission, so a changed amount or account is a new bill that needs its own review. Owner review is enforced by the
  API; the vault does not record per-bill approval (the agent key can still pay an allow-listed supplier within limits).
* **Owner key import is verified.** A backup is accepted only if its public key equals the company's registered owner key.

## Secrets

* `.env` and `.env.near` are gitignored. `.env.near` holds the sponsor key and the key-encryption secret.
* The agent's function-call key is stored AES-256-GCM encrypted with `NEAR_KEY_ENC_SECRET`. During an interrupted setup,
  the not-yet-deleted vault and agent setup keys are kept the same way in `User.provisionState` and cleared when setup completes.
* The owner's key never leaves the browser; only the public key is sent to provision the account.
* Prior documentation claims a history scan; this review did not independently scan all history. Do not publish without verifying history and rotating any exposed credentials.

## Privacy

On-chain data is public: account names, token transfers, amounts and the invoice number used as the transfer memo.
Customer emails, names, line items and descriptions stay in the SkyPay database and are never written on-chain.
SkyPay does not claim confidential payments.

## Reporting

Please open a private security advisory on the GitHub repository.


## Recovery and current limits (November 14 review)

Invoice issuance and settlement write their outbox jobs in the same Prisma transaction. Outgoing attempts are persisted before dispatch; a startup worker only reads unresolved contract payments. Missing records do not prove failure. Generic transaction/callback failures remain unknown pending reconciliation; a successful callback result `Failed` is a definitive token-transfer failure. Reconcile verifies amount, recipient and agent and uses final-state views. Never create a new payment ID merely to clear unknown status.

External delivery is not exactly-once. SMTP may accept before a timeout; Notion can create before the local mapping is stored. Expired running outbox jobs are quarantined as unknown after 15 minutes. An operator must inspect provider records and durable mappings before deciding to mark done or retry. Never alter the invoice's paid state to repair email/Notion. No automatic recovery override exists for a failed vault callback; reserved funds may remain locked.

Sponsor guards validate owner method argument fields, account syntax, u128 amounts, gas, receiver, deposits and expiry. Process-local rate/replay limits are not durable cost budgets. Registration deposits and funding costs need separate accounting; sponsor operational balances must be funded. A fresh complete sponsorship run was not verified here. The external payer wallet's ordinary transaction signing is separate from the company's browser-held delegate signing.

Public invoice links act as bearer access and disclose client invoice data to anyone holding the URL. Plaintext owner keys in browser storage are vulnerable to XSS/extensions; losing all backups loses control. Historical supplier memos may expose descriptions; new supplier calls use an opaque payment ID. This review is not a production security audit. See docs/AUDIT.md for unresolved cross-chain checkout, sponsor and batch recovery limitations.


Payroll retry protection: company/run-name pairs are reserved by a deterministic database primary key before payment dispatch. Same-name reuse is refused regardless of prior outcome. Unknown payments leave the run processing; operators must reconcile before intentionally creating a differently named run. The agent payroll `confirm` flag is model-supplied, not an independently signed server approval. Contract limits and payee authorization remain the enforceable spending boundary.
