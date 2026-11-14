import Link from "next/link"
import { Navbar } from "@/components/landing/navbar"
import { ArchitectureDiagram, GuardrailDiagram, InvoiceDiagram, SetupDiagram, X402Diagram } from "./diagrams"

// Source of truth for behaviour: ../../CLAIMS.md and docs/API.md in the repo. This page explains; it does not add claims.
const A = "text-primary underline underline-offset-4"
const P = "mt-4 text-lg leading-8 text-slate-700"
const UL = "mt-4 list-disc space-y-3 pl-6 text-lg leading-8 text-slate-700 marker:text-slate-400"
const C = "rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-900"

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-white">{n}</span>
      <div>
        <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-lg leading-8 text-slate-700">{children}</p>
      </div>
    </li>
  )
}

function Stat({ big, small, sm }: { big: string; small: string; sm?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className={`${sm ? "text-xl" : "text-3xl"} font-semibold tracking-tight text-primary`}>{big}</div>
      <div className="mt-1 text-base text-slate-600">{small}</div>
    </div>
  )
}

function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  const cls = tone === "warn" ? "border-amber-300 bg-amber-50" : "border-primary/30 bg-primary/5"
  return <div className={`mt-6 rounded-xl border-l-4 p-5 text-lg leading-8 text-slate-800 ${cls}`}>{children}</div>
}

const sections: { id: string; title: string }[] = [
  { id: "overview", title: "Overview" },
  { id: "architecture", title: "Architecture" },
  { id: "getting-started", title: "Getting started" },
  { id: "setup", title: "What setup creates" },
  { id: "guardrails", title: "Spending guardrails" },
  { id: "invoices", title: "Invoices and settlement" },
  { id: "suppliers", title: "Suppliers and payroll" },
  { id: "agent", title: "The agent" },
  { id: "x402", title: "x402 pay links" },
  { id: "exports", title: "Exports and Notion" },
  { id: "security", title: "Security and limits" },
  { id: "api", title: "API quick reference" },
]

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-28 border-t border-slate-200 pt-12 text-3xl font-semibold tracking-tight text-slate-900 first:border-0 first:pt-0">
      {children}
    </h2>
  )
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Navbar />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-24 pt-28 sm:px-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="Docs sections" className="sticky top-28 text-base">
            <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">On this page</div>
            <ul className="space-y-1 border-l border-slate-200">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-slate-600 hover:border-primary hover:text-slate-900">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0">
          <h1 className="text-5xl font-semibold tracking-tight">SkyPay docs</h1>
          <p className="mt-4 max-w-2xl text-xl leading-9 text-slate-600">
            An AI agent runs your payments, and it cannot overspend. Everything below runs on <strong>NEAR testnet with a test token (tUSDC) that has no value</strong>.
          </p>
          <nav className="mt-6 flex flex-wrap gap-2 lg:hidden" aria-label="Docs sections">
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-base text-slate-600">
                {s.title}
              </a>
            ))}
          </nav>

          <div className="mt-12 space-y-12">
            <section>
              <H2 id="overview">Overview</H2>
              <p className={P}>
                SkyPay is a finance workspace for a small business. You bill clients in USDC on NEAR, pay approved suppliers and staff from a vault, and export the books to CSV. An AI
                agent can create invoices and pay suppliers, but only inside spending rules that a NEAR smart contract enforces, not our server.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Stat big="~1 s" small="for a payment to land on NEAR" />
                <Stat big="No gas" small="for the company: a sponsor pays it" />
                <Stat big="On chain" small="limits the agent cannot bypass" />
              </div>
            </section>

            <section>
              <H2 id="architecture">Architecture</H2>
              <p className={P}>
                Three NEAR accounts keep authority separate. You hold the owner key in your browser. The vault holds the money the agent may spend. The agent holds a key that can do one
                thing: ask the vault to pay.
              </p>
              <ArchitectureDiagram />
              <ul className={UL}>
                <li><strong>Company account</strong> receives invoice payments. Its key lives in your browser and is never sent to SkyPay.</li>
                <li><strong>Operating vault</strong> is a Rust contract. After deploy its own keys are deleted, so only its rules can move funds.</li>
                <li><strong>Agent account</strong> has a key that can only call <code className={C}>vault.pay</code>.</li>
                <li><strong>Sponsor relayer</strong> pays NEAR gas for your signed actions, so the company never buys NEAR.</li>
              </ul>
            </section>

            <section>
              <H2 id="getting-started">Getting started</H2>
              <ol className="mt-6 space-y-4">
                <Step n={1} title="Create an account">
                  Sign up, then connect Notion if you want it (optional). SkyPay creates a payments database in your workspace.
                </Step>
                <Step n={2} title="Create the company NEAR account">
                  Open <Link className={A} href="/finance">Finance</Link> and click <em>Create company NEAR account</em>. Your owner key is generated in this browser. Keep the backup it
                  offers.
                </Step>
                <Step n={3} title="Make an invoice, or ask the agent">
                  Create one on Finance, or tell the agent on the <Link className={A} href="/dashboard">Dashboard</Link>: &quot;Invoice Acme Corp 25 USDC, due Friday&quot;.
                </Step>
                <Step n={4} title="Open the link and pay">
                  The invoice turns <strong>paid</strong> only after SkyPay verifies the transfer on NEAR.
                </Step>
              </ol>
              <Note>
                The Finance sidebar has a <strong>Readiness</strong> tab. It shows what is left to set up and turns into a green check when everything is done.
              </Note>
            </section>

            <section>
              <H2 id="setup">What setup creates</H2>
              <SetupDiagram />
              <p className={P}>
                SkyPay sponsors the account, the vault and a limited agent key on testnet. Setup is resumable: if it is interrupted, clicking again continues the same accounts with the same owner
                key rather than creating duplicates. The browser also refuses a wrong key backup before storing it.
              </p>
            </section>

            <section>
              <H2 id="guardrails">Spending guardrails</H2>
              <p className={P}>
                Every payment the agent makes goes through the vault contract. The contract checks the payee and both limits. If any check fails, nothing moves and the vault refuses.
              </p>
              <GuardrailDiagram />
              <ul className={UL}>
                <li><strong>Approved payees only.</strong> A supplier must be allowlisted by the owner. An address-book entry alone is not approval.</li>
                <li><strong>Per-payment and daily limits</strong> are set by the owner and checked on chain.</li>
                <li><strong>Revocation.</strong> The owner can stop the agent at any time.</li>
                <li><strong>No blind resends.</strong> A request key makes a repeated payment the same payment, and uncertain payments are reconciled, not resent.</li>
              </ul>
              <Note>The point: the refusal comes from the chain, not from SkyPay. A bug or a bad prompt on our side cannot raise the limit.</Note>
            </section>

            <section>
              <H2 id="invoices">Invoices and settlement</H2>
              <InvoiceDiagram />
              <p className={P}>
                An invoice has line items, a due date, a public checkout page and a status (pending or paid) with explorer links. Refunds are not built. It becomes <strong>paid</strong> only when SkyPay
                finds a successful transfer that meets all of these:
              </p>
              <ul className={UL}>
                <li>the pinned token contract, on the active network;</li>
                <li>the full amount, to the company account, and not refunded in the same transaction;</li>
                <li>a memo that matches this invoice;</li>
                <li>a transaction that has not already paid another invoice.</li>
              </ul>
              <p className={P}>Anyone can pay a correctly tagged invoice. A quote or a detected deposit is never treated as proof of payment.</p>
            </section>

            <section>
              <H2 id="suppliers">Suppliers and payroll</H2>
              <p className={P}>
                Suppliers send bills through a private inbox link. SkyPay matches each bill to a registered supplier and raises flags for anything unusual. You review, then the vault pays the
                <strong> registered</strong> account, never an account typed on the bill.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Stat sm big="unknown supplier" small="no registered supplier with that email or account" />
                <Stat sm big="payout changed" small="typed account differs from the registry" />
                <Stat sm big="possible duplicate" small="same supplier, number or amount within 30 days" />
              </div>
              <p className={P}>
                Payroll runs as a batch of 1 to 25 lines under a deliberate name. A name can be used once, so a repeated click cannot pay everyone twice. If any line is uncertain, the run stays
                open and is reconciled instead of being called failed.
              </p>
            </section>

            <section>
              <H2 id="agent">The agent</H2>
              <p className={P}>The agent works through a small set of typed tools. It cannot run arbitrary actions.</p>
              <ul className={UL}>
                <li>Create an invoice and read its status.</li>
                <li>List payees and pay a supplier.</li>
                <li>Summarise the books.</li>
              </ul>
              <p className={P}>
                Try: <code className={C}>Invoice Acme Corp 25 USDC, due Friday</code> or <code className={C}>Pay Bo &amp; Co 12 USDC for the March bill</code>. Tools propose actions through SkyPay
                services, and the vault stays the final authority.
              </p>
            </section>

            <section>
              <H2 id="x402">x402 pay links</H2>
              <p className={P}>
                Every invoice also has <code className={C}>/x402pay/&lt;invoiceId&gt;</code>, so other AI agents can pay it without a browser. Called without payment it answers HTTP 402 with the
                requirements. The agent signs one transfer and retries with an <code className={C}>X-PAYMENT</code> header. SkyPay relays it, verifies it on chain and returns the receipt.
              </p>
              <X402Diagram />
              <p className={P}>
                The facilitator endpoints are <code className={C}>/x402/supported</code>, <code className={C}>/x402/verify</code> and <code className={C}>/x402/settle</code>. The network name{" "}
                <code className={C}>near-testnet</code> is SkyPay&apos;s own mapping of x402 to NEAR, not an official x402 network.
              </p>
            </section>

            <section>
              <H2 id="exports">Exports and Notion</H2>
              <ul className={UL}>
                <li><strong>CSV for your accountant:</strong> <code className={C}>invoices.csv</code> and <code className={C}>payments.csv</code>. UTC times, exact 6-decimal amounts, and a transaction link on every row.</li>
                <li><strong>Notion:</strong> a new row becomes a NEAR invoice, and the agent writes the pay link back to the row.</li>
              </ul>
            </section>

            <section>
              <H2 id="security">Security and limits</H2>
              <ul className={UL}>
                <li>SkyPay never holds the owner key. The agent key is stored encrypted and can only call the vault.</li>
                <li>The relayer only sponsors vault policy calls, funding your own vault, and exact-shape invoice payments.</li>
                <li>Invoice links are public bearer links. Anyone who has one can view that invoice.</li>
              </ul>
              <Note tone="warn">
                <strong>Testnet only.</strong> The token has no value. Real USDC, mainnet payments and cross-chain collection with NEAR Intents are not live in this build, and no production security audit
                is claimed. See <a className={A} href="https://github.com/ydvSajal/Near-SKYPAY/blob/main/CLAIMS.md">CLAIMS.md</a> for what is and is not established.
              </Note>
            </section>

            <section>
              <H2 id="api">API quick reference</H2>
              <p className={P}>
                Private routes need <code className={C}>Authorization: Bearer &lt;JWT&gt;</code>. The full reference is{" "}
                <a className={A} href="https://github.com/ydvSajal/Near-SKYPAY/blob/main/docs/API.md">docs/API.md</a>.
              </p>
              <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-base">
                  <thead className="bg-slate-100 text-sm uppercase tracking-wide text-slate-600">
                    <tr><th className="px-4 py-3">Route</th><th className="px-4 py-3">What it does</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 align-top">
                    {[
                      ["GET /api/near/status", "Accounts, balances, policy and readiness"],
                      ["POST /api/near/provision", "Create the company footprint from your owner public key (resumable)"],
                      ["POST /api/invoices", "Create an invoice (1 to 50 line items)"],
                      ["GET /api/public/invoices/:id", "Public checkout details and status"],
                      ["POST /api/public/invoices/:id/confirm", "Submit a transaction hash for verification"],
                      ["POST /api/vault/payments", "Pay a registered payee through the vault"],
                      ["POST /api/vault/payout-batches", "Run payroll or a batch (1 to 25 lines)"],
                      ["GET /api/export/invoices.csv", "Invoices for your accountant"],
                      ["GET /x402pay/:id", "x402 pay link for an invoice"],
                    ].map(([r, d]) => (
                      <tr key={r}>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-[0.95em] text-slate-900">{r}</td>
                        <td className="px-4 py-3 text-slate-700">{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
