# Evidence index

[Validation and acceptance matrix](../docs/VALIDATION.md) | [Claims and limits](../CLAIMS.md)

Read each transcript's own timestamp, network, token and account identities. Different runs can use different sponsors and accounts. Supplied logs are kept as received; reading one is not independent verification of its remote transactions. No mainnet settlement proof is included.

## Current run (November 14, 2026, fresh execution)

| File | What it shows |
|---|---|
| [backend-tests-20261114.txt](backend-tests-20261114.txt) | 58 passing backend tests (database, RPC and provider doubles): supplier bills, resumable provisioning, batch recovery, outbox and receipt verification |
| [contract-rebuild-20261114-review.txt](contract-rebuild-20261114-review.txt) | Fresh cargo-near rebuild in WSL: 24 vault unit tests (including the storage-reserve boundary) and the sandbox scenario, with artifact hashes |
| [bills-smoke-testnet.txt](bills-smoke-testnet.txt) | Live NEAR testnet supplier-bill journey on a freshly provisioned company, using test tUSDC (no monetary value) |

## Supplied integration and native logs

| File | Reported scope and limits |
|---|---|
| [review-fixes-20261114.txt](review-fixes-20261114.txt) | Disposable-Postgres smoke, memo-bound testnet collection, relay checks, x402, and SMTP/Notion acceptance. Supplied, not rerun |
| [near-testnet-e2e.txt](near-testnet-e2e.txt) | Native test-token vault lifecycle and policy refusals on testnet |
| [api-smoke-testnet.txt](api-smoke-testnet.txt) | HTTP walkthrough of invoices, payments and tenant isolation on testnet |
| [agent-smoke-testnet.txt](agent-smoke-testnet.txt) | Agent invocation, invoice and supplier behavior, with model credentials |
| [x402-testnet.txt](x402-testnet.txt) | Sponsor-relayed payer transfer and replay check; earlier sponsor and account context may differ |
| [contract-tests.txt](contract-tests.txt) | Historical Rust unit and sandbox output from an earlier vault build; superseded by the current run above |
| [intents-dry-quote.txt](intents-dry-quote.txt) | Historical provider quote requests. Dry pricing only; no funds moved; prices are not current offers |

## Superseded runs

Earlier test and rebuild outputs are kept for history under [`docsarchive/evidence/`](../docsarchive/evidence/): the 42-test backend recheck, the payroll parser runs, the first contract rebuild, and earlier review outputs.

For new evidence, record the command, commit or working-tree state, timestamp, network, asset contract, amount, relevant account roles, observed outcome and limitations. Do not publish private keys, access tokens, real customer records or invented transaction references. A screenshot is context only, not proof of payment.
