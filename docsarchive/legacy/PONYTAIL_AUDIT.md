# Ponytail Audit

Over-engineering + dead weight only (bugs/security out of scope).

## Findings — biggest cut first

- **delete:** `docs/page.tsx` + `docs/docs-page-client.tsx` — orphans. App Router serves `app/docs/page.tsx`; `docs/` folder not a route, nothing imports it. Replacement: nothing. **-2588 lines**. `[agenpay-frontend/docs/]`

- **delete:** `tests/` dir — 15 gemini/minimax probe scripts (`test-gemini-*`, `test-minimax-*`, `test-openai-*`, etc.). Throwaway API-exploration, not wired to any runner (`npm test` runs `test.js`, not `tests/`). Replacement: nothing. **~1800 lines**. `[agenpay-backend/tests/]`

- **delete:** `FULL_FILE_STRUCTURE.txt` — 13MB tree dump committed at repo root. Replacement: `git ls-files`. **-13 MB**. `[repo root]`

- **delete:** root diagnostics: `check-db.js` `check-openai-status.js` `debug-network.js` `verify-gemini.js` `show-config.js` — one-off probes, none in package.json scripts. Replacement: nothing. **-311 lines**. `[agenpay-backend/]`

- **shrink:** `app/docs/page.tsx` 1318 lines — one component, hardcoded content wall. Move copy to a data array, map it. Big win, needs read pass. `[agenpay-frontend/app/docs/page.tsx]`

- **delete:** dead NotionService methods, zero callers repo-wide: `addPaymentRecord` (995), `addTransactionRecord` (1082), `addInvoiceRecord` (1166), `updateRecordStatus`, `getUserRootPageId`, `updateDashboardAnalytics` (837-972). Replacement: nothing. **~300 lines**. `[agenpay-backend/lib/NotionService.js]`

- **delete:** dead X402PayService methods: `createMultiTokenPaymentRequest`, `extractPaymentIdFromUrl`, `getPaymentRequest`, `cancelPaymentRequest`, `getPaymentStats` (567-606), `startServer`/`stopServer` (1458-1480) — app mounted directly in `server.js:61`, `startServer` never called, `stopServer`'s `this.server` guard always undefined. Replacement: nothing. **~105 lines**. `[agenpay-backend/lib/X402PayService.js]`

- **delete:** `this.schedulingService = new SchedulingService()` (AgentPayAgent.js:238) constructed per-agent, no method on it ever invoked. Drop field + import. `[agenpay-backend/lib/AgentPayAgent.js]`

- **yagni:** `createMultiTokenPaymentLink`/`getPaymentOptions`/`calculatePaymentOptions` (AgentPayAgent.js:557-667, X402PayService.js:611-641) — OKX DEX swapping permanently disabled, so multi-token path always collapses to the same result as plain `createPaymentRequest`. Flatten to one tool. **~175 lines**. `[agenpay-backend/lib/]`

- **delete:** `examples/okx-dex-demo.js` (171 lines) — demo script wired only to `demo:okx`. Keep if intentionally shipped; else cut. `[agenpay-backend/examples/]`

- **shrink:** `escapeHtml` reimplemented twice, different code same behavior — AgentPayAgent.js:86 vs X402PayService.js:12. One shared util. **~10 lines**.

- **shrink:** `getNotionProperty` (AgentPayAgent.js:903) vs `getPropertyText` (NotionService.js:1563) — same title/rich_text extractor, copy-pasted. Reuse one. **~14 lines**.

- **shrink:** `isMinimaxQuotaError`/`isGeminiQuotaError` and `isMinimaxModelUnavailableError`/`isGeminiModelUnavailableError` (AgentPayAgent.js:322-364) — two duplicate pairs, collapse to `isQuotaError(error)`/`isModelUnavailableError(error)`. **~20 lines**.

- **yagni:** `ChatMiniMax` reads `options.topK`/`options.maxTokens` (AgentPayAgent.js:36-44) but no caller ever passes non-default values. Hardcode 5/2048, drop the options param.

- **delete dep:** `uuid` (backend package.json) — zero imports anywhere in source; `crypto.randomUUID` already used instead (OKXDexService.js). Remove from package.json. **-1 dep**.

- **delete dep:** `@google/generative-ai` (backend package.json) — only referenced by `tests/` (already flagged for deletion); production code uses `@langchain/google-genai`. Remove once `tests/` is cut. **-1 dep**.

- **delete dep:** `ai` and `@ai-sdk/openai` (frontend package.json) — zero imports anywhere in `app/`, `components/`, `lib/`. Remove. **-2 deps**.

## Notes (not code — flag only)

- Nested dir `seiagenpay-main/seiagenpay-main/`.
- Root `package-lock.json` (94 bytes, empty).

## Net

**-~5100 lines, -13 MB, -4 deps.**
