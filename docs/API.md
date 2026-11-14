# HTTP API reference

[Documentation index](../README.md) | [Architecture](../README.md#architecture) | [Operations](OPERATIONS.md)

This is a reference for the current Express routes, not a versioned external SDK contract. Local origin: `http://localhost:3001`. Send JSON bodies with Content-Type application/json. Private routes require `Authorization: Bearer <JWT>`; the authenticated user's id supplies the company scope. Do not accept a model-supplied userId as authority.

## Authentication and readiness

| Method / route | Input | Result |
|---|---|---|
| GET /health | None | Runs `SELECT 1` (3 s timeout): 200 `healthy` when Postgres answers, 503 `degraded` otherwise. Not a chain-readiness probe |
| POST /api/auth/register | email, password (at least 8 characters), optional name | success, token, public user; creates a DB user, not a company chain footprint |
| POST /api/auth/login | email, password | JWT and public user |
| GET /api/me | Bearer JWT | Authenticated public user |
| PATCH /api/profile | Bearer JWT, business profile fields | Updates profile; issued invoices retain snapshotted seller data |

An invoice URL is public bearer access, not a login. Treat possession as permission to view that invoice's exposed details. User registration is not proof of account ownership on-chain; provisioning associates a browser-generated owner public key with the company account.

## Company and payees (authenticated)

| Method / route | Purpose |
|---|---|
| GET /api/near/status | Active network/token, company/vault/agent identities, balances and policy when provisioned; readiness data: `agentKey` (gas allowance left on the pay-only key), `vaultStorage` (free NEAR, approximate payment records left), `sponsor` (balance, low flag), `setupInProgress` (interrupted setup and its owner key) |
| POST /api/near/provision | Body publicKey: browser-generated ed25519 owner public key; creates testnet company footprint using sponsor resources. Resumable: after an interruption, the same call continues the same accounts (must use the same owner key; 409 otherwise). One setup per company at a time |
| POST /api/near/relay | Body signedDelegate (base64), optional label; validates and relays a signed owner action |
| POST /api/near/test-faucet | Mints 100 test tUSDC to the provisioned company; test-token mode only |
| GET /api/payees | Registered payees with an on-chain allowlist check |
| POST /api/payees | name, nearAccount, optional email/notes/kind/role/salary; registers address-book entry and token storage |
| PATCH /api/payees/:id | Edit contact/staff fields; payout account remains fixed |
| DELETE /api/payees/:id | Removes the company's address-book record, not the contract allowlist entry |

Allowlisting and revocation require owner-signed contract actions. An address-book write alone is not on-chain approval. `kind` is employee or supplier; `salary` is a decimal amount converted to six-decimal integer token units.

## Invoices

Authenticated `GET /api/invoices` lists company invoices. `POST /api/invoices` creates an invoice and durable email/Notion jobs. Example body:

```json
{
  "customerEmail": "client@example.com",
  "customerName": "Client Co",
  "description": "Design sprint",
  "lineItems": [
    { "description": "Design", "quantity": 1, "unitPrice": "10.00" }
  ]
}
```

Customer email is contact data, never a supplier payout address. Quantity must be a positive integer; price is a decimal string. Due date defaults to 14 days when omitted. There must be 1-50 line items and a positive total. The server derives destination token, network, receiving account and total; invoice creation does not accept client authority over settlement destination. Repeating invoice creation is not a universally idempotent operation: do not resend an instruction merely because the first reply was slow.

| Public route | Purpose / financial boundary |
|---|---|
| GET /api/public/invoices/:id | Checkout details, line items, receiving account, status and transaction reference |
| POST /api/public/invoices/:id/confirm | txHash, optional senderAccountId; reads FINAL receipts before settlement. The sender hint locates RPC data; it is not proof of payment |
| GET /api/public/intents/assets | Provider-supported cross-chain source assets for previews |
| POST /api/public/invoices/:id/intents-quote | originAsset and refundTo; server-owned exact-output dry quote, executable=false |
| POST /api/public/invoices/:id/demo-pay | Test-token convenience: sponsor submits an actual testnet transfer, then the normal verifier runs |

The verifier counts successful pinned-token transfers to the invoice receiver only when the memo matches that invoice's number or id. Minimum amount, active token/network and transaction uniqueness are checked. Anyone may pay a correctly tagged invoice. Quotes and detected deposits are never proof of settlement. Executable Intents sessions/refund-state endpoints do not exist in this release.

## Supplier payments and payroll (authenticated)

| Method / route | Purpose |
|---|---|
| GET /api/vault/payments | Latest 50 outgoing attempts |
| POST /api/vault/payments | payeeId, amount, optional memo/idempotencyKey; attempts a policy-controlled supplier payment |
| POST /api/vault/payments/:id/reconcile | Reads the existing contract payment; never sends a new one |
| POST /api/vault/payout-batches | items of payeeId/amount/memo; optional label/source/kind; 1-25 items |
| GET /api/vault/payout-batches | Latest 20 company batches and recorded attempts |

Example supplier request:

```json
{
  "payeeId": "replace-with-owner-registered-payee-id",
  "amount": "2.00",
  "memo": "Supplier invoice",
  "idempotencyKey": "supplier-invoice-001"
}
```

Use the same idempotency key for the same payment. Changed recipient, amount or memo is rejected. Without a key the service generates a new identity; a repeated POST can represent another payment. An HTTP 200 can contain an unresolved payment: inspect payment.status, not the status code alone. Definitive failed supplier responses use 422. Status values include submitted, processing, unknown, settled and failed.

For payroll set kind to payroll and supply a deliberate label. A company/name pair is reserved once before dispatch, including failed runs. Same-name reuse returns 409; a new name is an intentional new run. Batch processing is synchronous; durable unfinished-line recovery is incomplete. Reconcile uncertain attempts instead of submitting a new batch.

## Supplier bill inbox

| Route | Auth | Purpose |
|---|---|---|
| GET /api/bills/inbox-link | Bearer | Company's inbox token and `/bills/submit/:token` path (created on first use) |
| POST /api/bills/inbox-link/rotate | Bearer | New token; the old link stops accepting bills |
| GET /api/bills | Bearer | Latest 100 bills with matched supplier, flags, payment and transaction link |
| POST /api/bills/:id/pay | Bearer | Body `acknowledgeFlags` (required when flagged). Pays the REGISTERED supplier account through the vault; repeat calls return the existing payment (`alreadyDispatched`); retry allowed only after a definite vault refusal. 409 for unregistered suppliers or unreviewed flags; 422 when the vault refuses |
| POST /api/bills/:id/reject | Bearer | Body `note` (shown to the contractor) |
| GET /api/public/bill-inbox/:token | None | Company display name and network for the form |
| POST /api/public/bill-inbox/:token | None (20/hour/IP) | name, email, invoiceNumber, amount, optional description/dueDate/payoutAccount. 409 if the same email already sent that invoice number. Returns a private `statusPath` |
| GET /api/public/bills/:statusToken | None | Status (`in_review`, `paying`, `unknown`, `paid`, `failed`, `rejected`), amount, dates, transaction link once paid. No flags or registry data |

Flags: `unknown_supplier` (no registered supplier with that email or account), `payout_changed` (typed account differs from the registry), `possible_duplicate` (same supplier, same number or amount, within 30 days).

## Exports, agent and x402

Authenticated `GET /api/export/invoices.csv` and `/api/export/payments.csv` return downloadable records scoped to the company. Amounts are six-decimal token units, timestamps are UTC, and customer text is quoted/formula-neutralized. The merchant-fee field is fixed at zero; gas is not measured by that field.

The chat interface uses authenticated agent start/stop/process/status routes in server.js and typed tools in lib/AgentPayAgent.js. Tools propose actions through SkyPay services; contract policy remains authoritative. A model-supplied payroll confirm flag is not a separately authenticated approval signature.

Existing x402 routes: `GET /x402pay/:id`, `GET /x402/supported`, `POST /x402/verify`, `POST /x402/settle`. They use SkyPay's own exact mapping for near-testnet and support either an already-sent transaction or a payer-signed transfer delegate. The same invoice memo/receipt verification applies. See lib/x402.js for payload details; this optional path is not executable cross-chain collection.

## Errors and source references

Expect 400 for malformed input, 401 for authentication, 404 for absent/scoped resources, 409 for state/replay conflicts, 422 for verification or contract refusal, 429 for rate limits, and provider-related 502 responses for unavailable quotes. Do not treat every 500 or timeout as proof that no funds moved.

Sources: [server](../agenPay/agenpay-backend/server.js), [routes](../agenPay/agenpay-backend/lib/nearRouter.js), [business rules](../agenPay/agenpay-backend/lib/skypay.js), [quote adapter](../agenPay/agenpay-backend/lib/intents.js), [x402](../agenPay/agenpay-backend/lib/x402.js). This reference does not imply every error path or route was independently HTTP-tested.
