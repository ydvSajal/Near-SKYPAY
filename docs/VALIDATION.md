# Validation and acceptance evidence

Review date: November 14, 2026 IST; runtime clock November 13, 2026 20:04 UTC. Branch main, base HEAD 0f34799. Changes are uncommitted; the tree also contains concurrent user work. No claim that this review deployed or executed real payments.

## Pre-submission run (November 14, 2026, ~08:00 UTC, fresh execution)

Changes in this run: supplier bill inbox, readiness checklist, verified key import, explicit backup step, resumable provisioning, DB-backed health check, batch aggregate recovery, and vault hardening (64-byte `payment_id`/`invoice_ref` caps, explicit storage-reserve refusal).

| Command | Actual result |
|---|---|
| Backend `node --test --test-isolation=none test/*.test.js` | **58 pass, 0 fail**; [output](../evidence/backend-tests-20261114.txt). New: `bills.test.js` (11), `provision.test.js` (5), recovery worker batch refresh |
| Frontend `node --test --test-isolation=none lib/payroll-core.test.ts` | **6 pass, 0 fail** |
| Frontend `npx tsc --noEmit`, `npx eslint .` | Exit 0, no diagnostics |
| Frontend `npm run build` | **Succeeded** (dev server stopped first; the earlier EPERM was a locked `.next`) |
| `bash contracts/build-and-test.sh` (WSL Ubuntu 24.04, Rust 1.99.1, cargo-near 0.23.0) | **24 unit + 1 sandbox pass** after the review follow-up; vault wasm sha256 `ba41312d407f3ecfbb97c79eee05bc4a4f1321dde0b212ae57ffddd59a4b69a1`, now in `near-artifacts/` and SHA256SUMS; [output](../evidence/contract-rebuild-20261114-review.txt). The earlier `ee38669f…` build is what the live smoke company runs |
| `node scripts/bills-smoke.mjs` (local API + Postgres, NEAR testnet) | Fresh company provisioned on the rebuilt wasm (on-chain code hash `H2uuyHMydphkNWQJynPrbvDcB5A67wuo9sHhQat2dbtA` = the build's bs58 hash); bill paid once to the registered supplier; repeat click not resent; changed payout account flagged and ignored; unknown sender refused; duplicate refused; other company sees nothing; [transcript](../evidence/bills-smoke-testnet.txt) |
| `GET /health` (local) | 200 with `database: connected` from a real `SELECT 1` |
| Browser check (Chrome, local) | Finance readiness rendered from live status; random wrong owner key refused with nothing stored; bill status and submit pages rendered |

### Review follow-up (same day)

An external review reproduced three defects with fixtures; all are fixed and covered by tests:

| Finding | Fix | Test |
|---|---|---|
| Bill crash repair could reopen a bill while its first Pay request was still running; a second Pay used a new payment id, so two dispatches were possible | A new payment identity is issued only after a definitive vault refusal; a reopened bill reuses its in-flight identity, so the unique `paymentId` lets one request dispatch (`paySupplier` returns the winner's row on a create race). Repair writes are conditional on the state read; repair threshold raised to 15 min | `bills.test.js`: stalled first request + repair + second Pay = one dispatch, one payment id |
| `accessKeys()` turned every RPC error into "no keys", so a resumed setup could treat a vault that still had its key as keyless | Fails closed: only "account does not exist" reads as empty; vault and agent steps re-read keys on chain and refuse to complete unless the vault has zero keys and the agent exactly one pay-only key | `provision.test.js`: RPC failure mid-resume stops setup; a silently failed key deletion is caught; `accessKeys` error classification |
| Vault storage check ran before `store::LookupMap` flushed the new record, so it did not include it | `pay` flushes `agents` and `payments` before the check | Boundary tests: 1 yocto short is refused, exact amount accepted; both fail with the flush removed |

Not done in this run: Postgres failure injection for `/health`, a real mid-provisioning crash on testnet, Notion/SMTP delivery for bill payouts, and a reproducible (Docker) cargo-near build.

## Latest recheck (commit 4bf6e21 plus working tree)

This follow-up inspected the new invoice-memo binding and supplied integration transcript. It preserved the two pre-existing edits to frontend payroll-core files. The prior review below and supplied testnet/SMTP/Notion logs are historical evidence; this follow-up did not send communications, use a live database or sign transactions.

New fixes: deterministic company/payroll-name primary keys reject racing run creation and any same-name retry, including failed runs. Unknown line outcomes leave the batch processing. Sponsor cost-ledger failures no longer downgrade settled payment status or erase its transaction hash. These require no schema migration. Automatic recovery of batch aggregates/unfinished lines remains open. Changed frontend lint to the ESLint CLI and excluded generated Next build/type artifacts; source rules remain enabled.

| Recheck command | Actual result |
|---|---|
| Backend `node --test --test-isolation=none test/*.test.js` | **42 pass, 0 fail**. Three added regressions cover payroll races, unknown payroll retries and cost-ledger failure. The expected cost-ledger failure logs to stderr |
| Frontend `node --test --test-isolation=none lib/payroll-core.test.ts` | **6 pass, 0 fail**. Node emits a module-type warning |
| Frontend `node node_modules/typescript/bin/tsc --noEmit` | Exit 0, no diagnostics |
| Frontend `npm run lint` (ESLint CLI) | Exit 0, no warnings/errors. Initial direct-CLI run included generated files; config now excludes .next, next-env.d.ts and output folders |
| Backend `node node_modules/prisma/build/index.js validate` | Schema valid; DATABASE_URL overridden with a disposable localhost placeholder, no DB connection/write performed |
| Backend `node --check lib/skypay.js`, `node --check server.js` | Exit 0 |
| Frontend `npm run build` | Still blocked by runner spawn EPERM; no successful production build claimed |
| `git diff --check` and artifact SHA-256 | Clean diff; both wasm files match SHA256SUMS |

Runtime Node is v26.3.1; listed Node 22.8+/24 setup was not separately tested. Cargo is unavailable; no fresh native unit/sandbox run. No live deployment or payment claim was newly verified. README/CLAIMS/setup counts and current limitations have been reconciled with this evidence.

## Documentation revision after the recheck

The README was reorganized around product scope, evidence levels, offline checks and navigation. New SETUP, API, OPERATIONS and documentation/evidence indexes separate installation, integration, failure recovery and provenance. DEMO and CLAIMS were reconciled with current source. The old application-directory Sei README and root demo page now point to current guides; historical details remain in Git history. The frontend environment example now lists the actual NEAR API/RPC settings instead of obsolete EVM WalletConnect guidance.

Documentation validation: 15 current Markdown entry/guidance files checked for local links, with no missing targets; fenced blocks in the six main rewritten guides are balanced; referenced command/source paths exist; git diff --check passes. Commands and route descriptions were compared with current server/routes/scripts. No application behavior, payment execution, deployment or fresh live evidence was added in this documentation-only revision. Test counts above remain results of the preceding engineering recheck; no unnecessary payment scripts or test reruns were performed.

## Initial review commands (retained history)



| Command / working directory | Observed outcome |
|---|---|
| git status --short, git branch --show-current, git log / nested Git root | main, HEAD 0f34799; dirty before editing; migration tag baseline-pre-near = 9037671 |
| npm test / backend, before edits | Failed before test execution: Node test subprocess spawn EPERM, six file-runner failures |
| node --test --test-isolation=none test/*.test.js / backend, before edits | 26 pass, no failures; includes concurrent user test changes |
| same command / backend, after changes | **38 pass, 0 fail, 0 skipped** |
| npm run build / frontend, before edits | Failed during optimized build: spawn EPERM. No successful production build claimed |
| node node_modules/typescript/bin/tsc --noEmit / frontend | Exit 0, no diagnostics; rerun after concurrent edits |
| node --test --test-isolation=none lib/payroll-core.test.ts / frontend | **5 pass, 0 fail**. Harmless Node module-type warning on stderr |
| cargo test -p skypay-vault --lib / contracts | Not executed: cargo command unavailable. Sandbox and wasm rebuild not run |
| node --check / backend server.js, skypay.js, reconciliation.js, outbox.js, relayGuard.js, NearService.js | Exit 0 |
| git diff --check / root | Exit 0; CRLF conversion notices only |
| Get-FileHash near-artifacts/*.wasm -Algorithm SHA256 / backend | Both match committed SHA256SUMS. This proves file integrity against that manifest, not source reproducibility or deployed hash |

Network limitations: shell HTTPS failed with connection refused; browser host unavailable; web tool could read official docs and GitHub, but live app/API/1Click tokens fetches returned inaccessible. GitHub connector succeeded for watchlist reads. No live service was treated as passing. Existing env values were not printed. No use of production DB, migrations, live email/Notion, testnet signing, mainnet signing or spending in this review.

## Acceptance matrix

Local tests use in-memory DB and provider/RPC stubs. A passing local test is not proof of SQL concurrency, actual delivery, RPC correctness or on-chain deployment. Existing evidence files (contract-tests, near-testnet-e2e, api-smoke-testnet, agent-smoke-testnet, intents-dry-quote, x402-testnet) predate this review and remain **historical supplied evidence**, not newly reproduced transactions.

| Required scenario | Evidence this run / status |
|---|---|
| Authenticated invoice instruction | Agent tool/source and authenticated route inspected; exact service invoice tested. Fresh LLM + HTTP run not performed |
| Checkout email details/link | email.test.js passes HTML escaping, amount, line items and link. **Gmail SMTP accepted invoice and receipt emails from the local backend** (outbox mode `live`, see evidence); inbox delivery not observed. The hosted Render service still needs EMAIL_* variables and may be blocked by free-tier SMTP |
| Supported source asset/exact destination | intents.test.js validates server-owned EXACT_OUTPUT USDC amount and source catalog; API availability/metadata unverified |
| Expired quotes | New expired/invalid provider deadline tests pass; quote refused. No invoice state mutated |
| Insufficient deposits/refunds | Underpayment verification test passes; executable Intents deposit/refund lifecycle missing |
| Settlement bound to invoice | Token, receiver, minimum amount, success, network binding and duplicate financial record tests pass. **Fixed 2026-11-13:** `evaluateReceipt` now counts only transfers whose NEP-141 memo is this invoice's number or id; other memos or none are refused and never add up (new test); the x402/sponsored-delegate guard requires the same memo. Live: api-smoke and x402 runs pay with the memo ([evidence](../evidence/review-fixes-20261114.txt)). By design, anyone who sends the right memo may pay the invoice |
| Receipt/Notion retries | Atomic transaction jobs and repeated settlement test pass. In-memory rollback tested; **real Postgres run done** on a disposable Neon branch (schema push + full api-smoke, constraints held, outbox jobs reached done). Postgres failure injection still not performed. Provider duplicates remain possible after ambiguous acceptance |
| CSV matches records / safe encoding | Fixed integer decimals, UTC/explorer fields, quotes, formula and control-character cases pass; actual Postgres export comparison unverified |
| Permitted supplier payment | Existing payout tests simulate success; native direct contract tests inspected but not executed here |
| Unauthorized recipient/excess/expired/revoked | Existing Rust unit/sandbox source covers them; not rerun without Rust. Backend foreign-payee tests and sponsor guards pass locally |
| Duplicate/changed payload | Same incoming confirmation creates one attempt/receipt job; payout changed memo rejected; existing contract ID/hash tests inspected |
| Concurrent budget reservation | Contract reserves before dispatch and uses checked daily accumulation. Direct tests inspected; fresh concurrent sandbox execution unavailable |
| Transfer/callback failure | Native callback tests inspected; generic execution/callback failure maps to unknown, not false failed, in local regression test. Failed callback can lock native reservation |
| Restart after submission | New worker scans persisted unresolved attempts and calls read-only reconcile; absence stays unknown; test asserts no dispatch. Actual killed-process/DB restart not performed |
| Tenant isolation | Foreign payee and reconciliation cases pass; outbox invoice owner check added. Full HTTP authorization test remains open |
| Restricted sponsor / operational funding | **Fresh testnet runs 2026-11-13:** provision, sponsored relay (payee approval, limits, funding) and a refused non-vault transfer in api-smoke; `near-e2e` shows every abuse case refused (transfer NEAR, unlisted contract, fund someone else, add full-access key). sponsor_ledger counts and observed cost (~2.1 NEAR per company; the sponsor needed a refill) are in the evidence file. Existing guards and new strict argument/u128/account/gas tests pass. Browser code uses actual delegate-signing API; complete provision/storage/deposit/gas flow requires fresh testnet run. Persistent sponsor budgets/nonce coordination absent |
| Direct contract enforcement | Rust unit/sandbox tests not re-run (no cargo). **Live on testnet 2026-11-13 (near-e2e):** per-payment and daily limits refused, replay did not double-spend, revoked agent refused, sponsor refuses abuse ([transcript](../evidence/near-testnet-e2e.txt)) |

## Official sources checked

- [Live event rules](https://nearhackathon.com/HACKATHON.md) and [event directory](https://nearhackathon.com/): deadline November 14 23:59 UTC; eligibility starts October 19; prompts are examples, not an official rubric. Current rules supersede the older example checklist on resubmission/change handling.
- [Prompt repository](https://github.com/nearai/near-hackathon-prompt-examples), [setup](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/00-setup.md), [Real-World Money](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/08-realworld.md), [submission checklist](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/SUBMITTING.md). Research material was not treated as permission to install scripts, publish or spend.
- [Relayer guide](https://docs.near.org/web3-apps/tutorials/meta-transactions): signed delegate authorizes an action; relayer pays gas, client attached deposits remain separate. Local browser owner key path matches that signing API. No external-wallet delegate support is claimed.
- [Intents introduction](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction), [request flow](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request), [swap types](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types): no testnet; catalog-derived asset IDs; exact-output is suitable for fixed invoices. Event guidance and provider docs differ on unauthenticated fee; quote costs must prevail over hardcoded promises.
- [NEP-141](https://github.com/near/NEPs/blob/master/neps/nep-0141.md), [NEP-145](https://github.com/near/NEPs/blob/master/neps/nep-0145.md), [NEP-148](https://github.com/near/NEPs/blob/master/neps/nep-0148.md): receiver hook versus ordinary transfer; storage registration; decimals metadata. Current code pins six decimals but fresh ft_metadata verification remains necessary.
- [NEAR index](https://docs.near.org/llms.txt), [Intents index](https://docs.near-intents.org/llms.txt), [RPC finality](https://docs.near.org/api/rpc/transactions): FINAL waits for finalized receipts including refunds. New agent payments request FINAL; recovery views use final rather than optimistic state.

## Operational handoff

Before a live demonstration: use disposable DB to verify transaction rollback/unique constraints, run build and native unit/sandbox suite in a suitable shell, verify actual deployed wasm/access keys/token metadata, then run the native testnet walkthrough. Configure controlled mail/Notion destinations and obtain explicit authorization before external communications. Do not apply the concurrent user schema changes to a shared DB without review.

For unknown payments, retain payment ID and query final contract state; never blindly create another payment. For unknown outbox jobs, inspect the actual provider and Notion mapping before an operator marks done or returns the job to pending. Current SMTP transport lacks a provider idempotency guarantee. Do not automatically resend a crashed setup/rebuild job.

**Decision (2026-11-13): executable NEAR Intents collection is out of scope for this submission.** 1Click has no testnet; a deposit/refund lifecycle needs mainnet USDC and real money and cannot be built and verified safely by the deadline. The product ships the verified NEAR-native flow plus a live Intents *quote preview* and makes no claim of cross-chain settlement. Checkout-specific settlement binding is now implemented (memo). The production build passes on the combined tree; the Rust suite still needs a machine with cargo. No live claim was newly supported by this review; only official sources and public competitor code were read remotely.
