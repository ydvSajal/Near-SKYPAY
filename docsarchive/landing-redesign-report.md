# SKYPay landing redesign

Direction: The sentence is the layout. Seed: 1156872451.
Adapted to the user's classic serif reference, a working-product illustration, and existing testnet product facts. No new dependencies.
Idea: SKYPay's Notion-to-NEAR payment journey becomes a ledger and receipt that carry the page from instruction to verified settlement.
Interactive element: keyboard-accessible Connect / Create / Settle tabs, updating the invoice preview.
Palette: warm ivory, dark ink, ink blue; Georgia classic serif paired with existing Geist.
Motion: existing Lenis/GSAP integration, scoped GSAP entrance and scroll reveals, receipt parallax, reduced-motion fallback.
All workspace clients, invoices and policy amounts are explicitly illustrative examples. No customer claims or mainnet pricing invented. No external image assets used.

Validation:
- TypeScript --noEmit passed.
- Next production build blocked by Windows spawn EPERM.
- Next dev server blocked by Windows spawn EPERM; direct start-server blocked by listen EACCES.
- Browser inspector blocked by Windows spawn EPERM. No screenshot critique or visual scores claimed.
- Taste lint identifies reference-driven overline labels and surface dividers. These are retained for the requested visual direction and finance interface grouping; this is not a clean taste lint result.

Before launch: run production build and browser QA at 1440, 768, and 390px; check mobile menu, workflow tabs, anchor navigation, and reduced motion. Visual verification remains outstanding because the environment cannot start the server/browser.
