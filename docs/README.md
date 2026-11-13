# SkyPay documentation

Start with the [project README](../README.md) for product scope and current evidence. All paths and commands assume the Git root containing `agenPay/`, `contracts/` and `render.yaml`.

| Your task | Read |
|---|---|
| Install and run your own copy | [SETUP.md](SETUP.md) |
| Demonstrate the complete native testnet journey | [DEMO.md](DEMO.md) |
| Call the HTTP API | [API.md](API.md) |
| Investigate unknown payments, worker errors or sponsor problems | [OPERATIONS.md](OPERATIONS.md) |
| Understand funds, keys and payment states | [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](../SECURITY.md) |
| Check what was actually tested | [VALIDATION.md](VALIDATION.md), [CLAIMS.md](../CLAIMS.md) |
| Review implementation gaps and priorities | [AUDIT.md](AUDIT.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) |
| Understand migration and competitive context | [MIGRATION.md](../MIGRATION.md), [COMPETITORS.md](COMPETITORS.md) |

## How to interpret evidence

- **Implemented:** code exists; this alone does not prove execution or deployment.
- **Locally tested:** a named command passed. Database/provider/RPC doubles are explicitly identified.
- **Recorded integration:** a supplied transcript reports a real database, provider or testnet interaction. It must not be described as a fresh run by a reviewer who only read it.
- **Observed live:** the relevant outcome was independently observed during that validation. See the date and network.
- **Fixture:** the external effect is simulated/logged; it is not delivered email or blockchain settlement.
- **Dry quote:** a real provider price/routing request that does not execute a payment.

The current application uses test tUSDC on NEAR testnet. Intents has no executable checkout in this release. Financial truth is the ledger plus verified chain outcomes; Notion and email are reporting surfaces.

## Maintaining these documents

Keep setup instructions in SETUP, the demonstration in DEMO, and actual command outcomes in VALIDATION. README summarizes and links to them. Update CLAIMS when evidence changes. Audit findings and legacy transcripts preserve history; mark superseded findings instead of silently turning past tests into current results. Source files and observed behavior take precedence over prose.
