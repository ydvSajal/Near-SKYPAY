# Local setup and configuration

[Documentation index](../README.md) | [Demo](DEMO.md) | [Troubleshooting](OPERATIONS.md)

Use the directory containing `agenPay/`, `contracts/` and `render.yaml` as the repository root. Some downloaded workspaces have a same-named outer directory. Keep backend, frontend and database terminals separate so commands run in the intended directory.

## 1. Prerequisites and execution modes

Node.js 22.8+ or 24 and npm are the documented application prerequisites. The latest recheck ran on Node v26.3.1, not a separate Node 22/24 matrix. PostgreSQL is needed for the app, not the offline tests. Rust with the wasm target and a compatible Linux/WSL sandbox environment is needed to rebuild/test contracts; prebuilt testnet artifacts are committed.

| Mode | Needed | What it establishes |
|---|---|---|
| Offline tests | Node and npm dependencies | Deterministic logic with provider/DB/RPC doubles |
| Local app with fixtures | Postgres, API/frontend and testnet sponsor | Actual local records and native testnet payments; email/Notion can be fixtures |
| Connected integrations | Model, SMTP and Notion credentials as needed | Agent responses and external delivery/sync, subject to observed evidence |
| Intents preview | Provider network access; optional JWT | Dry mainnet pricing only, never a testnet payment |

Do not reuse a shared database for initial setup. Schema setup below targets a new disposable database. The testnet bootstrap signs transactions and uses testnet funds; no mainnet workflow is included.

## 2. Start a disposable PostgreSQL database

From the repository root, with Docker running:

```sh
docker run -d --name skypay-pg -e POSTGRES_PASSWORD=skypay -e POSTGRES_DB=skypay -p 5434:5432 postgres:16
```

The matching development URL is `postgresql://postgres:skypay@localhost:5434/skypay`. These credentials are local example values. If the named container already exists, inspect it before starting another; for that same container use `docker start skypay-pg`. Do not reset or remove a database to resolve a setup error without identifying its contents.

You may use another disposable PostgreSQL instance by setting DATABASE_URL accordingly. Docker startup and a clean-cache installation were not rerun in the latest restricted review environment.

## 3. Install and configure the backend

```sh
cd agenPay/agenpay-backend
npm ci
```

For a new local configuration, choose the command for your shell:

```powershell
# PowerShell: run only when .env does not already exist.
Copy-Item .env.example .env
```

```sh
# Bash: do not overwrite an existing configuration.
cp -n .env.example .env
```

Edit `.env`: set DATABASE_URL to the disposable database, replace JWT_SECRET with a long random secret, and retain the local URL defaults below. A local secret can be generated with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; store it privately in the configuration.

```dotenv
DATABASE_URL=postgresql://postgres:skypay@localhost:5434/skypay
JWT_SECRET=replace-with-your-own-random-secret
FRONTEND_URL=http://localhost:3000
BASE_URL=http://localhost:3001
PORT=3001
```

Then validate and initialize **that disposable database**:

```sh
npx prisma generate
npx prisma validate
npx prisma db push
node --test --test-isolation=none test/*.test.js
```

Expected: schema validation succeeds, database tables are created, and the current backend suite reports 59 passing tests. Tests do not prove a connection to the configured live services. The API refuses startup when JWT_SECRET is missing.

## 4. Prepare native NEAR testnet infrastructure

From the backend directory:

```sh
npm run near:bootstrap
```

The script uses the testnet helper, creates/funds a sponsor as needed, deploys a test token when one is not configured, and writes secrets to the gitignored `.env.near`. It is designed to preserve configured keys on subsequent runs, but it can create accounts and perform top-ups; review its output rather than assuming every rerun is read-only.

Use `.env.near.example` as the variable reference. Let bootstrap create `.env.near` for a new setup; do not overwrite an existing file containing keys. Successful setup needs a nonempty sponsor account/key and token contract. If funding is unavailable, the script can stop before token setup; fund the displayed **testnet** account and rerun. A zero exit code alone is not proof the complete setup exists.

The backend loads `.env.near` before `.env`; existing process environment variables take precedence. Keep NEAR settings in `.env.near` to avoid conflicting duplicates. Protect the encryption secret: changing it without migrating encrypted agent keys makes them unreadable.

## 5. Start the API

```sh
node server.js
```

Expected startup includes `SkyPay API on :3001` and a NEAR testnet configuration summary. Open `http://localhost:3001/health`. It runs `SELECT 1` against the database with a 3 s timeout: 200 with `database: connected`, or 503 `degraded`. `node scripts/agent-smoke.mjs` is the fuller readiness check.

## 6. Install and start the frontend

In a new terminal, from the repository root:

```sh
cd agenPay/agenpay-frontend
npm ci
```

Copy `.env.local.example` to `.env.local` using `Copy-Item` in PowerShell or `cp -n` in Bash when the destination does not exist. Set:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_NEAR_RPC_URL=https://test.rpc.fastnear.com
```

No EVM WalletConnect project ID is required by the current NEAR Wallet Selector integration. All NEXT_PUBLIC variables are browser-visible; never put private keys, JWT secrets or provider secrets there. Restart the dev server or rebuild after changes.

For local development:

```sh
npm run dev
```

Open `http://localhost:3000`. For a production-mode check, run `npm run lint`, `npm run build`, then `npm start`. The production build passed on November 15, 2026.

## Environment reference

| File / variables | Purpose and requirement |
|---|---|
| Backend `.env`: DATABASE_URL, JWT_SECRET | Required for persistent app/authentication |
| FRONTEND_URL, BASE_URL, PORT | Browser origin/email checkout links, API/x402 origin and listener port. First FRONTEND_URL entry is used for invoice links |
| `.env.near`: NEAR_NETWORK, NEAR_RPC_URL | Native network configuration; current backend supports testnet only |
| NEAR_RELAYER_ACCOUNT, NEAR_RELAYER_KEY | Sponsor identity and signing key; server-side only |
| NEAR_USDC_CONTRACT, NEAR_USDC_IS_TEST_TOKEN | Pinned NEP-141 test token and explicit test-token behavior; use `true` for this demonstration |
| NEAR_KEY_ENC_SECRET | Encrypts the restricted agent keys; maintain a protected recovery copy |
| AI_PROVIDER plus GEMINI_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY | Optional chat agent; configure one supported provider. Model overrides are in the backend example |
| EMAIL_SERVICE, EMAIL_USER, EMAIL_PASS, EMAIL_FROM | Optional SMTP. Without usable credentials the email adapter logs fixture output |
| NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, NOTION_REDIRECT_URI | Optional OAuth workspace connection. Register the callback matching the backend origin |
| ONECLICK_API_URL, ONECLICK_JWT, INTENTS_QUOTE_RECIPIENT | Optional dry quotes; JWT depends on provider access. Testnet quote recipient is a mainnet pricing placeholder, not the company account |
| ADMIN_EMAIL, ADMIN_PASSWORD | Optional admin seed configuration; not needed for normal company registration |
| Frontend `.env.local`: NEXT_PUBLIC_API_URL, NEXT_PUBLIC_NEAR_RPC_URL | Public API/RPC origins; use the same testnet RPC/network assumptions as the backend |

The complete backend examples are [here](../agenPay/agenpay-backend/.env.example) and [here](../agenPay/agenpay-backend/.env.near.example). The root [.env.example](../agenPay/agenpay-backend/.env.example) is a reference, not a file the API loads from the root directory.

## Rebuild and test contracts

In Linux/WSL with Rust and the target installed, from the repository root:

```sh
rustup target add wasm32-unknown-unknown
cargo install cargo-near   # 0.23 was used
bash contracts/build-and-test.sh
```

The script builds both contracts with cargo-near (optimized WASM; a plain `cargo build` produces a ~370 KB vault that costs more storage), copies them to `contracts/target/wasm32-unknown-unknown/release/` for the sandbox test, runs the 22 unit tests and the sandbox scenario, and prints sha256 hashes. The backend deploys artifacts from `agenPay/agenpay-backend/near-artifacts/`; copying a rebuilt vault there (and updating SHA256SUMS) affects only companies provisioned afterwards, because deployed vaults are immutable. On November 14 this passed in WSL Ubuntu 24.04 and the rebuilt vault was installed (see VALIDATION).

Continue with the [demo](DEMO.md) or [operations guide](OPERATIONS.md).
