# Operations, troubleshooting and recovery

[Documentation index](../README.md) | [Setup](SETUP.md) | [Security](../SECURITY.md)

## Diagnose before retrying

| Symptom | What to inspect | Next action |
|---|---|---|
| API refuses startup | JWT_SECRET and working directory | Start from the backend directory with a valid local configuration |
| Health says connected but registration fails | Actual Prisma error and DATABASE_URL | Treat health as liveness only; check database reachability and current schema |
| CORS error or wrong checkout email URL | FRONTEND_URL, first configured origin, frontend API URL | Correct matching origins, restart API and rebuild/restart frontend |
| Company provisioning fails | Sponsor balance, registrar/storage receipts and whether any accounts were already created | Inspect partial setup before repeating; do not assume a single atomic deployment |
| Faucet/bootstrap stops early | Helper response, sponsor balance, missing token configuration | Fund the named testnet account and rerun deliberately. Do not create a mainnet substitute |
| Owner key missing | Browser profile and downloaded backup | Import the existing backup. Generating a different key does not recover an existing company |
| Vault balance differs from company balance | Receiving account versus vault allocation | Use owner funding through ft_transfer_call with `msg: fund`; ordinary transfer does not credit the vault hook |
| Registered payee is refused | On-chain allowlist, not just address-book presence | Owner must approve the account on the vault. Removing a DB row does not revoke the on-chain entry |
| Payment is unknown/processing | Existing payment ID, tx reference and final vault state | Reconcile the existing attempt; never change the ID merely to retry |
| Same payroll name returns 409 | Existing run, including failed/uncertain status | Inspect and reconcile it. A distinct name intentionally creates fresh payments |
| Email/Notion remains pending | API process uptime, outbox status, credentials, provider response | Restore worker/service availability; distinguish fixture, provider acceptance and delivery |
| Outbox job is unknown | Expired running claim or ambiguous provider outcome | Review provider records and durable mapping before any operator retry |
| Quote refused/unavailable | Source asset catalog, refund address, amount, deadline and provider response | Request a new dry preview when appropriate; never infer that an invoice was paid |
| Build reports spawn EPERM | Execution environment's subprocess support | Use a suitable development shell; keep source checks enabled |
| cargo command missing | Rust toolchain/environment | Use Linux/WSL with the documented prerequisites; do not label native tests passed |

## Payment recovery

An outgoing attempt is stored before dispatch. The contract reserves balance and daily budget before its asynchronous token transfer. The startup worker scans unresolved attempts and reads final vault state; it does not send another payment. A missing record at one block is not by itself proof of failure.

Keep the company, vault, agent, payment ID, recipient, amount, transaction reference and observed timestamps together. Use the authenticated `POST /api/vault/payments/:id/reconcile` endpoint to re-read an existing attempt. Matching settled/failed contract evidence can resolve uncertainty. If RPC is unavailable, retain uncertainty and retry the read later.

A token-transfer failure and a callback failure are different. A successful callback returning Failed releases its reservation once. A failed/missing callback may leave Reserved funds locked; no audited manual release/override exists in the current immutable vault. Do not compensate by sending another payment without determining whether the recipient was already credited.

Payroll uses a deterministic primary key derived from company and run name to prevent racing creation. A failed or unresolved name cannot be reused. This is not a complete durable batch scheduler: unfinished lines and aggregate recovery still need operator review. Agent-generated supplier keys also have a time-bucket deduplication convention; that is not a permanent guarantee against a repeated natural-language instruction.

## Outbox recovery

Invoice issuance and settlement commit their receipt/Notion jobs in the same database transaction. Pending jobs are claimed, processed and retried with backoff, up to six handler attempts. Running claims older than 15 minutes become unknown for investigation. Workers run inside the API process and stop advancing while the host sleeps or is offline.

A provider may accept an email or create a Notion page before the worker records success. Therefore job uniqueness does not establish exactly-once external delivery. For unknown jobs, inspect the provider, recipient, invoice/payment mapping and timestamps. An operator can decide whether the job was already completed or needs retry through a reviewed database procedure; there is no public automatic repair endpoint. Do not reset every unknown job to pending.

Never change an invoice from paid to pending to repair email or Notion. Never edit Notion to authorize a payout. SMTP acceptance is not proof of inbox arrival/read; a successful Notion update is not proof a person reviewed it.

## Sponsor and key operations

Sponsor gas, account creation/storage funding and attached deposits are separate expenses. Provisioning supplies initial testnet balances and token registration; relaying alone does not fund attached deposits. The agent uses a provisioned account and function-call key. Keep the sponsor funded, but inspect the actual testnet bootstrap output rather than promising a fixed cost or faucet availability.

Persist a protected copy of `.env.near`, the encryption secret and database backups. The browser owner key has its own backup/import flow. Do not rotate NEAR_KEY_ENC_SECRET without a migration for encrypted agent keys. Vault key deletion means an existing vault has no normal upgrade key; deploy a newly reviewed vault rather than assuming an upgrade is possible.

Production sponsor readiness needs durable cost limits, nonce coordination and durable replay/rate handling. The current process-local caches and cost ledger are not that system. A compromised backend can exercise the agent's remaining on-chain permissions; limits should reflect the maximum acceptable loss.

## Hosting your own testnet copy

1. Provision a dedicated Postgres database. Review the schema and run Prisma generation/schema setup deliberately against that database.
2. Use [render.yaml](../render.yaml) for the API. Its build installs dependencies and generates Prisma; it does not apply the schema on every deploy.
3. Supply server-side database, JWT, NEAR sponsor/encryption, optional model, SMTP and Notion settings. Keep the same encryption secret for existing agent keys.
4. Deploy the frontend from `agenPay/agenpay-frontend`, setting NEXT_PUBLIC_API_URL to the API and the testnet RPC override if needed.
5. Set FRONTEND_URL on the API, BASE_URL to the API origin and the Notion callback to that API origin. Restart/rebuild as needed.
6. Validate authentication, provisioning, actual access keys, invoice details, final receipts, outbox modes and exports. Record new evidence with a date and network.

These are preparation instructions, not a statement that this review deployed anything. Free hosting sleeps, and an always-on worker may be needed for timely reconciliation. Keep secrets out of screenshots and logs; do not expose admin, signing or database access to make a public demo easier.
