# Deploy — Render + Vercel + Neon

Final stack: **frontend → Vercel**, **backend + facilitator → Render** (free tier), **DB → Neon Postgres**.
Source of truth for the two Render services is [`render.yaml`](./render.yaml). This doc is the click-by-click.

> **Free-tier caveat:** Render free web services sleep after 15 min idle and cold-start (~30–50s).
> Cold start wipes in-memory agent state and pauses the monitoring/cron loops until the next request.
> Fine for a demo. For reliable scheduled/timed payments, upgrade the backend to Starter ($7/mo).

---

## 0. Before you start — rotate the Neon password

The old Neon password was pasted into a chat once. **Rotate it first:**
Neon console → your project → **Roles** → reset password → copy the new **pooled** connection string.
Use that string for `DATABASE_URL` below. Never paste it into git or chat.

Pooled string looks like:
`postgresql://<user>:<newpass>@ep-...-pooler.<region>.aws.neon.tech/<db>?sslmode=require`

---

## 1. Deploy the two backend services (Render Blueprint)

1. Render Dashboard → **New** → **Blueprint**.
2. Connect repo `ydvSajal/SKYPAY_FINAL`, branch `main`. Render reads `render.yaml` and shows
   two services: `agenpay-backend` and `agenpay-facilitator`.
3. Render prompts for every `sync: false` env var. Fill them (table below).
   - `X402_FACILITATOR_URL` and `FRONTEND_URL` reference URLs that don't exist yet — put a
     placeholder now, fix in step 3 after the URLs are assigned.
4. Apply. First backend build auto-runs `prisma db push` (creates all tables incl. `Admin`) and
   `admin:seed` (create-only, reads `ADMIN_EMAIL`/`ADMIN_PASSWORD`). No manual DB commands.
5. Note the two assigned URLs:
   - backend  → `https://agenpay-backend.onrender.com` (or whatever Render assigns)
   - facilitator → `https://agenpay-facilitator.onrender.com`

### Backend env vars

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** string (rotated, step 0) |
| `JWT_SECRET` | strong random string (`openssl rand -hex 32`) — fail-fast at startup if missing |
| `ADMIN_EMAIL` | `sajalkumar1765@gmail.com` |
| `ADMIN_PASSWORD` | your admin password |
| `FRONTEND_URL` | Vercel domain (step 2), e.g. `https://agenpay.vercel.app` |
| `X402_FACILITATOR_URL` | facilitator Render URL |
| `FACILITATOR_API_KEY` | shared secret — **must match** facilitator's value |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | from Privy dashboard |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | from Notion integration |
| `NOTION_REDIRECT_URI` | `https://<backend>.onrender.com/api/notion/callback` |
| `OPENROUTER_API_KEY` | OpenRouter key (`AI_PROVIDER` is preset to `openrouter`) |
| `MINIMAX_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` | fallback providers (optional) |
| `EMAIL_SERVICE` / `EMAIL_USER` / `EMAIL_PASS` / `EMAIL_FROM` | mail config (optional) |

### Facilitator env vars

| Var | Value |
|---|---|
| `PRIVATE_KEY` | funded Sei wallet key that signs settlements |
| `FACILITATOR_API_KEY` | **same value** as backend — locks `/settle` |

---

## 2. Deploy the frontend (Vercel)

1. Vercel → **Add New Project** → import `ydvSajal/SKYPAY_FINAL`.
2. **Root Directory:** `agenPay/agenpay-frontend`. Framework auto-detects Next.js 15.
3. Env vars:
   | Var | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | backend Render URL |
   | `NEXT_PUBLIC_WC_PROJECT_ID` | WalletConnect project id |
4. Deploy. Note the assigned domain, e.g. `https://agenpay.vercel.app`.

---

## 3. Cross-wire the URLs (the step everyone forgets)

Now that all three URLs exist, go back and set the placeholders:

- **Render backend:** `FRONTEND_URL` = Vercel domain · `X402_FACILITATOR_URL` = facilitator URL ·
  `NOTION_REDIRECT_URI` = `https://<backend>.onrender.com/api/notion/callback`
- **Vercel frontend:** `NEXT_PUBLIC_API_URL` = backend URL (redeploy after changing)
- **Notion integration settings:** add the same `NOTION_REDIRECT_URI` as an allowed redirect URI.

Redeploy any service whose env vars changed.

---

## 4. Smoke test

- `GET https://<backend>.onrender.com/health` → 200
- Frontend loads, register + login works
- Admin login at `https://agenpay.vercel.app/admin` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- Trigger one x402 payment → backend reaches facilitator (`/settle` succeeds with matching key)

---

## Known non-blocker

`agenPay/agenpay-backend/agent.js` has a duplicate-export syntax error but nothing imports it
(dead standalone file). Doesn't affect the build or runtime.
