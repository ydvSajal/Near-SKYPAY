# Judge walkthrough and reproducible demonstration

[Documentation index](../README.md) | [Setup](SETUP.md) | [Validation](VALIDATION.md)

## Choose the evidence level

The core demonstration is native NEAR testnet with test tUSDC, which has no value. Intents is a separate mainnet dry-price preview; it does not settle this invoice. State these boundaries before showing a payment.

For a no-credentials check, run the README offline commands: 62 backend tests, 6 payroll tests, TypeScript and lint passed on November 15. These tests use doubles for external boundaries. For the product walkthrough below, first complete SETUP and use controlled test data, a funded testnet sponsor and an existing testnet supplier account. Model, SMTP and Notion credentials are optional extensions; describe absent integrations as fixtures.

## 1. Create the company workspace

Register in the app, fill the business profile, and skip or connect Notion. Select Create NEAR account. Expect receiving, vault and agent account references. Download the owner-key backup and keep it private.

Show that collection and operating money have separate accounts. Inspect actual vault access keys and agent function-call permissions if demonstrating custody; merely displaying an account string is not sufficient proof. Sponsor exhaustion can stop provisioning; use OPERATIONS rather than repeatedly creating company footprints.

## 2. Issue one clear invoice

With a model configured, start the agent and request:

```text
Request 10 USD from client@example.com for a design sprint.
```

Use a controlled inbox in a connected demonstration. Expect a pending invoice with a 10-token total, line items, due date, seller details and a checkout link. Without a model, create the invoice through Finance and identify that as form-based creation.

Show the email job. With no SMTP credentials, show its fixture mode and explain that no email was delivered. With an authorized controlled inbox, show provider acceptance and actual received email separately. Never present a job marked done in fixture mode as delivery proof.

## 3. Open the public checkout

Open the invoice link in a private window. Expect the same invoice number, amount, due date, receiving account and test-token label. The customer does not need the owner's key or a company login.

Optionally open Pay from another chain, select a catalog-supported source asset and enter a refund address on that source chain. Fetch a quote. Show exact output, required input, fees/estimate/expiry when returned, and the dry/non-executable label. Do not send funds to a preview recipient. A failed quote is a provider availability result, not a failed or paid invoice.

## 4. Pay and verify on native testnet

Use a testnet payer wallet supported by Wallet Selector, or select the clearly labeled testnet demo payer. The wallet path includes the invoice number as the transfer memo; the demo payer is a real sponsor-originated testnet transfer, not an independent customer payment.

Expect the invoice to change to paid only after receipt verification. Open its transaction reference and compare token contract, receiver, amount and invoice memo. Show settled amount and time in Finance. A claimed hash, quote or screenshot alone cannot close the invoice. An incorrect memo or below-total transfer is not accepted; automatic accumulation of partial payments is not implemented.

## 5. Check the financial records

Show the receipt job, invoice history, Notion projection if connected, and invoice/payment CSV exports. Check the same invoice and transaction in each. Explain that Notion or email failure does not undo settlement; retries operate on reporting jobs.

For CSV, compare amount_due with settled_amount and the transaction reference. Values are token units, not bank dollars. The merchant-fee column is fixed at zero, not measured gas accounting. Avoid displaying customer data or credentials in a public recording.

## 6. Allocate funds and enforce supplier policy

Obtain test tokens for the company, then fund the vault with 50. Expect vault available balance to rise through the owner-authorized ft_transfer_call funding hook. An ordinary token transfer is not equivalent.

Set the agent to 25 per payment and 40 per day. Register and owner-approve an existing testnet supplier. Run these actions in order:

| Action | Expected observation |
|---|---|
| Pay supplier 20 | Settled, transaction reference |
| Attempt 30 | Per-payment limit refusal |
| Attempt 21 | Daily limit refusal: 20 + 21 exceeds 40 |
| Reuse the same payment ID and payload | Existing outcome; no second transfer |
| Reuse ID with changed payload | Rejected |
| Revoke the agent, then attempt another payment | Contract refusal |

The replay/payload checks can be shown with the existing headless script or direct contract tests; do not pretend a new UI click necessarily reuses a payment ID. Backend checks are useful, but direct contract tests establish that bypassing the backend does not bypass policy.

## 7. Supplier bill inbox

In Finance, add a supplier with a billing email (Suppliers tab) and approve it on the vault. Open Supplier bills, copy the inbox link and open it in a private window. Submit a bill as the contractor with that email; you land on a private status page ("in review").

| Action | Expected observation |
|---|---|
| Owner clicks Pay from vault | Bill paid; one vault payment to the registered account; status page shows paid with a NEAR transaction link |
| Click Pay again | "already sent; not sent again" |
| Contractor resubmits the same invoice number | Refused as already submitted |
| Submit with a different NEAR account | Flagged "payout changed"; paying requires ticking the review box and still goes to the registered account |
| Submit from an unknown email | Flagged "unknown supplier"; Pay refused until the supplier is registered |

The same journey runs headless with `node scripts/bills-smoke.mjs` (provisions a fresh company; uses about 2.4 NEAR of sponsor funds). Say clearly that owner review is enforced by SkyPay's API, while the vault enforces allow-list, limits and no-double-pay.

The Readiness panel at the top of Finance lists the owner key (verified against the company), backup, both balances, agent policy, agent gas allowance, vault storage reserve and sponsor balance. To show recovery, sign in from another browser and import the backup file: a wrong key is refused before anything is stored.

## 8. Optional payroll and recovery

Show Employees, role/pay defaults and spreadsheet preview. Payroll import accepts at most 25 rows; the manual supplier batch UI allows 10 rows while the backend cap is 25. A sample sheet follows below; replace accounts with verified controlled testnet recipients before payment:

```csv
Name,Role,NEAR account,Email,Amount,Memo
Example Designer,Designer,replace-me.testnet,staff@example.com,2.50,Demo payroll
```

A company/run-name pair is one-shot. Concurrent calls reserve one database identity; failed or unknown runs do not free that name. A different name intentionally makes a new run. The agent's preview/confirm convention is not a signed approval gate; vault rules still enforce funds authority.

For unknown payments, retain the attempt ID and use reconciliation or restart the API. The recovery worker reads existing contract payments and never resends. Explain that incomplete batch aggregates and failed native callbacks may still need investigation. Unknown external delivery jobs require provider review, not blind retries.

## Headless and native checks

Run from `agenPay/agenpay-backend` after reviewing the scripts and configuration:

| Command | Effects and prerequisites |
|---|---|
| node scripts/api-smoke.mjs | Running API, real DB and funded testnet setup; creates users/invoices/accounts, submits testnet payments and can trigger configured email/Notion |
| node scripts/agent-smoke.mjs | Agent integration with model/network credentials; inspect its setup and side effects |
| node scripts/near-e2e.mjs | Testnet vault lifecycle; signs transactions and uses sponsor resources |
| node scripts/intents-quote.mjs | Provider network requests only; dry quotes, no signing/funds movement |

For direct unit and sandbox commands, run `bash contracts/build-and-test.sh` in Linux/WSL (see SETUP). These scripts are not the offline test suite, and this documentation update did not execute them.

The [supplied integration transcript](../evidence/review-fixes-20261114.txt) reports a disposable-Postgres run, memo-bound testnet settlement, sponsor checks and SMTP/Notion acceptance. It was inspected rather than freshly reproduced in the latest recheck. Use [VALIDATION.md](VALIDATION.md) to distinguish those records from current local tests.

## Finish the demonstration accurately

Show one connected business outcome and one refusal. End with the current boundaries: test token only; Intents quote-only; external delivery and batch/callback recovery limitations; no production audit claim. Any future real-mainnet demonstration needs executable checkout implementation, verified deployment and explicit authorization to spend.
