# Architecture and authority

[Documentation index](README.md) | [API](API.md) | [Security](../SECURITY.md)

## Application and records

Express authenticates JWT users; user id is the current company boundary (no multi-member organization model). Typed agent tools use the authenticated server-side id. Postgres holds Invoice, PaymentAttempt, Payee, OutboxJob, PayoutBatch and SponsorLedger; Notion is a projection. Legacy Agent float totals are not the financial ledger.

## Keys and authority

The browser owns the company full-access key in localStorage. Backend sees its public key and signed delegates. External wallet selection is used for payer transactions; company owner delegation uses near-api-js createSignedMetaTransaction directly, not an assumed wallet-selector delegate method. Key backup/import is the recovery path. The server can execute the encrypted agent key within on-chain policy; therefore a compromised server can spend all currently authorized budgets. The model has no unrestricted treasury key.

## Provisioning and sponsorship

Provisioning creates company, vault and agent accounts. Code deletes vault access keys and agent full-access key; verify actual deployed access keys before asserting immutability. Owner controls policy, payees and withdrawal of available funds; vault owner cannot override reserved callbacks. With no vault keys, there is no upgrade/redeploy recovery. Function-call allowance pays gas and does not bound token spending: vault.pay enforces limits, expiry, allowlist and request ID/hash itself.

## Collection versus vault allocation

Collection reaches the company receiving account. Allocation uses owner-signed ft_transfer_call to the pinned token, own vault, message `fund`. Vault ft_on_transfer checks token predecessor, owner sender and message; ordinary ft_transfer does not credit available balance. Sponsor must register recipient/vault storage separately and provision small attached deposits; a delegate relayer covers gas only. Initial setup funds company NEAR, so the user need not personally buy it. Operational sponsor funding still needs fresh verification and durable caps.

## Incoming payment states

Invoice: pending -> paid only after FINAL successful pinned-token events reach its snapshotted receiver for at least its amount. Invoice, incoming attempt and receipt/Notion jobs commit atomically. Unique settledTxHash prevents a transaction closing two invoices. Overpayment is recorded; refund workflow is not automated. Direct transfers require the invoice number or ID as their NEP-141 memo. Only matching memo amounts count; the payer can be anyone. Executable Intents checkout sessions remain missing.

## Outgoing payment states

Outgoing: submitted -> processing/unknown -> settled/failed. The attempt exists before dispatch. Contract independently reserves balance and daily spend before asynchronous token transfer. Callback releases once on definite failure or marks settled. Startup recovery scans unresolved attempts and queries FINAL vault state, validating recipient, amount and agent; it never submits. Missing record preserves prior uncertainty. Callback failure leaves Reserved and requires investigation, not a second payment.

## Reporting and delivery

Outbox: pending -> running -> done or retry pending/failed. At most six handler attempts. Running claims older than 15 minutes become unknown for provider reconciliation. SMTP retries following an ambiguous provider error can still duplicate messages; exactly-once external side effects are not guaranteed. A unique local job prevents duplicate financial records, not every possible provider duplicate. Notion creates/upserts by business id but create/mapping crash remains a boundary.

## Intents boundary

Intents: dry quote only, separate from invoice states. Asset selection comes from provider catalog; fixed USDC uses EXACT_OUTPUT integer units. No executable checkout sessions, deposit polling, insufficient-deposit/refund lifecycle or mainnet settlement exists. A future CheckoutSession must bind invoice, amount, token, destination, source/refund address, provider correlation/deposit, quote deadline and final destination evidence. Provider SUCCESS alone must not become invoice paid.

## Untrusted content and privacy

External invoice/email/Notion content is untrusted. Supplier email never becomes a payout address. The authenticated owner registers destinations and separately allowlists them on-chain. New supplier on-chain references are opaque IDs; public invoice wallet transfers can include invoice numbers. Public bearer checkout links reveal invoice details; this is access by possession, not transaction confidentiality.


## Payroll identity and recovery

Payroll names now derive a deterministic PayoutBatch primary key from company and run name. The database primary-key constraint rejects concurrent creation before dispatch; a used name stays blocked even for failed runs. Legacy random-ID runs are also checked by company/name. A distinct name intentionally starts a new run and must never be used merely to retry uncertainty. Unknown line outcomes keep the batch processing; automatic batch aggregate recovery is still incomplete. Cost-ledger reporting failures are logged separately and cannot downgrade a verified supplier payment.
