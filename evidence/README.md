# Evidence index

[Validation and acceptance matrix](../docs/VALIDATION.md) | [Claims](../CLAIMS.md)

Read each transcript's own timestamp, network, token and account identities. Different runs can use different sponsors/accounts. Existing logs are retained as supplied evidence; reading a transcript is not independent verification of its remote transactions. No mainnet settlement proof is supplied by this index.

## Pre-submission run, November 14, 2026 (fresh execution)

| File | Meaning |
|---|---|
| [backend-tests-20261114.txt](backend-tests-20261114.txt) | 54 passing backend tests (doubles), incl. supplier bills, resumable provisioning, batch recovery |
| [contract-rebuild-20261114.txt](contract-rebuild-20261114.txt) | Fresh cargo-near rebuild in WSL, 22 unit + 1 sandbox test, artifact hashes |
| [bills-smoke-testnet.txt](bills-smoke-testnet.txt) | Live testnet supplier-bill journey on a freshly provisioned company running the rebuilt vault; test token only |

## Earlier local recheck

| File | Meaning |
|---|---|
| [recheck-backend-tests.txt](recheck-backend-tests.txt) | 42 passing backend tests; superseded by backend-tests-20261114.txt |
| [recheck-payroll-tests.txt](recheck-payroll-tests.txt) | 6 passing spreadsheet/parser tests; no payments |
| [review-backend-tests.txt](review-backend-tests.txt) | Earlier local review output; superseded for current test count |
| [review-payroll-tests.txt](review-payroll-tests.txt) | Earlier parser output; superseded for current test count |

Other successful commands (TypeScript, lint, Prisma schema validation and artifact hashes) and unsuccessful/unavailable checks are recorded in VALIDATION.md. Test output is not deployment proof.

## Supplied integration and native logs

| File | Reported scope / limit |
|---|---|
| [review-fixes-20261114.txt](review-fixes-20261114.txt) | Disposable-Postgres smoke, memo-bound testnet collection, supplier/relay checks, x402 and SMTP/Notion acceptance. Timestamp header is approximate; specific x402 subsection has its own timestamp. Not independently rerun in the latest recheck |
| [near-testnet-e2e.txt](near-testnet-e2e.txt) | Native test-token vault lifecycle and refusals; public testnet references |
| [api-smoke-testnet.txt](api-smoke-testnet.txt) | Supplied HTTP walkthrough and database/testnet behavior |
| [agent-smoke-testnet.txt](agent-smoke-testnet.txt) | Supplied agent invocation/invoice/supplier behavior |
| [x402-testnet.txt](x402-testnet.txt) | Supplied sponsor-relayed payer transfer and replay; earlier sponsor/account context may differ |
| [contract-tests.txt](contract-tests.txt) | Historical Rust unit/sandbox output (19 unit tests); superseded by contract-rebuild-20261114.txt |
| [intents-dry-quote.txt](intents-dry-quote.txt) | Historical real provider quote requests. Dry routing/pricing only; no funds moved. Prices/fees are not current offers |

For new evidence, record command, commit/working-tree state, timestamp, network, asset contract, amount, relevant account roles, observed outcome and limitations. Do not publish private keys, access tokens, real customer records or fabricated transaction references. A screenshot is supplementary context, not a substitute for payment verification.
