# AgenPay — Migration & Onboarding Plan

Date: 2026-07-09

## Locked decisions
- **Custody: Hybrid** — keep embedded (managed) wallet for agent automation; also let users connect their own wallet.
- **Providers: Multi-provider** — MetaMask + WalletConnect + Coinbase Wallet + others.
- **Network: OPEN** — Base (recommended) vs Solana. Blocks facilitator removal (Phase 3) only. Confirm before Phase 3.

---

## What "private wallet" is (reference)
The wallet step mints a **Privy embedded / server-managed wallet**. Privy holds the private key in its enclave; the backend signs via `privy.walletApi.ethereum.sendTransaction`. No seed phrase shown. This is what lets the AI agent send/refund **autonomously** (no human approval per tx).

**External connect (MetaMask) is self-custody:** key in user's extension, user approves every tx. Great for receiving/withdrawing; an autonomous agent **cannot** auto-sign with it. Hence hybrid: embedded for automation, external for receive/withdraw/view.

---

## Solana feasibility (confirm later)
Possible — x402 has SVM support. But repo is 100% EVM; Solana = rewrite of wallet/token/tx layers, different providers (Phantom/Solflare, not MetaMask), and a Solana-capable facilitator must be confirmed. **Base is the natural fit** for the stated goals. Deciding Base vs Solana only affects Phase 3.

---

## Phase 0 — Production blockers (do first, independent)
From `PRODUCTION_READINESS.md`, still open:
1. Rotate ALL secrets (OpenAI, Gemini, Minimax, Notion, Privy, Gmail, facilitator private key) + real random `JWT_SECRET`.
2. `NODE_ENV=production` in backend deploy env.
3. **SQLite → Postgres**: `schema.prisma` datasource `provider = "postgresql"`, set `DATABASE_URL`, run migration.
4. `FACILITATOR_API_KEY` set both sides (only if facilitator stays — see Phase 3).
5. Confirm Privy app has server/embedded wallets enabled.

Gate: don't deploy before 1–3.

---

## Phase 1 — Onboarding restructure (network-agnostic, safe to start now)
Current flow: `auth → notion → wallet(create embedded)` (`login/page.tsx` step wizard).

New wallet step = both, under hybrid:
- Auto-provision managed (embedded) wallet for the agent (keep existing `createWallet`).
- Add **"Connect your wallet"** panel (MetaMask/etc) for receive/withdraw/view.
- Explainer copy: managed = agent automation; connected = you control keys.
- Progress stepper stays 3 steps; wallet step gets two cards.

Schema (`User`) additions:
- `externalWalletAddress String?`
- `walletProvider String?`   // metamask | walletconnect | coinbase
- keep `walletAddress`/`walletId` = managed/embedded.
- (Optional) separate `ConnectedWallet` model if supporting multiple external wallets.

Backend:
- `POST /api/wallet/connect/nonce` → returns nonce.
- `POST /api/wallet/connect/verify` → verify **SIWE** signature (Sign-In With Ethereum) to prove ownership, persist address. Never trust a pasted address.

---

## Phase 2 — Wallet-connect implementation (EVM)
Frontend (new deps): `wagmi`, `viem`, `@rainbow-me/rainbowkit` (or ConnectKit + WalletConnect projectId).
- `WalletProvider` wrapper in `app/layout.tsx`.
- Connect button + chain guard (warn on wrong network).
- SIWE: fetch nonce → `signMessage` → POST verify → persist.
- Dashboard: show BOTH wallets (managed + connected), balances (connected read via RPC).
- Withdraw flow: managed → connected address (uses existing `sendCrypto`).

Ladder note: MetaMask-only could be zero-dep `window.ethereum`, but multi-provider requires wagmi + a kit. Chosen per your multi-provider pick.

---

## Phase 3 — Network migration + facilitator removal (BLOCKED on network decision)

**If Base (recommended):**
- viem chain → `base` / `baseSepolia`; update RPC + USDC token addresses (already partly in `WalletService.getSupportedTokens`).
- Point x402 to **hosted facilitator** (Coinbase / x402.org) in `X402PayService.facilitatorConfig`.
- **Delete `agenpay-facilitator/` service**, remove its `PRIVATE_KEY`, drop `X402_FACILITATOR_URL` local default.
- Remove Sei hard-lock: `X402PayService.resolveX402Network` + `X402_NETWORK_OVERRIDE`.
- Drop `FACILITATOR_API_KEY` (no longer self-hosting).

**If Solana:** larger rewrite (Solana wallet adapter, SPL USDC, lamports, Solana facilitator). Re-scope before starting.

**If stay Sei testnet:** facilitator **cannot** be removed (no public Sei facilitator). "Remove facilitator" not possible on Sei.

---

## Phase 4 — Repo cleanup (from PONYTAIL_AUDIT.md)
Delete orphan `docs/page.tsx` + `docs/docs-page-client.tsx`, `tests/` probe scripts, `FULL_FILE_STRUCTURE.txt`, root diagnostic scripts. ~-4700 lines, -13MB.

---

## Other needs spotted
- **SIWE ownership proof** for connected wallets (security — mandatory, in Phase 1/2).
- **Agent wallet policy**: agent sends from managed wallet; receives to either. Document explicitly.
- **Faucet**: hide on mainnet (`getSupportedNetworks` isTestnet flag).
- **Wrong-network / connect-failure UX** states.
- `middleware.ts` only checks token presence, not signature (known, cosmetic — from prod review).
- **Legal/regulatory**: an embedded custodial wallet may carry money-transmission/ToS implications — get sign-off before mainnet.

---

## Suggested order
Phase 0 (prod) ∥ Phase 1+2 (onboarding + connect, network-agnostic) → confirm network → Phase 3 → Phase 4 cleanup.
