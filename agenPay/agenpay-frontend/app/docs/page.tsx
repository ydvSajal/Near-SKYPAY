import Link from "next/link"
import { Navbar } from "@/components/landing/navbar"

// ponytail: plain static page; the repo README/CLAIMS.md are the full reference.
const sections: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "getting-started",
    title: "Getting started",
    body: (
      <ol className="list-decimal space-y-2 pl-5">
        <li>Create an account, then connect Notion (optional). SkyPay creates a payments database in your workspace.</li>
        <li>
          Open <Link className="text-primary underline" href="/finance">Finance</Link> and click <em>Create company NEAR account</em>. Your
          owner key is generated in this browser and never sent to SkyPay. SkyPay sponsors the account, an operating vault and a
          limited agent key on NEAR testnet.
        </li>
        <li>Create an invoice, or ask the agent on the <Link className="text-primary underline" href="/dashboard">Dashboard</Link>: &quot;Invoice Acme Corp 25 USDC, due Friday&quot;.</li>
        <li>Open the invoice link and pay it. The invoice turns <strong>paid</strong> only after SkyPay verifies the transfer on NEAR.</li>
      </ol>
    ),
  },
  {
    id: "what-is-skypay",
    title: "What SkyPay is",
    body: (
      <p>
        A finance workspace for a small business: you bill clients in USDC on NEAR, pay approved suppliers from a vault, and export the
        books to CSV. An AI agent can create invoices and pay suppliers, but only inside spending rules that a NEAR smart contract
        enforces. This build runs on <strong>NEAR testnet with a test token (tUSDC) that has no value</strong>.
      </p>
    ),
  },
  {
    id: "how-it-works",
    title: "How it works",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li><strong>Company account</strong> receives invoice payments. Its key lives in the owner&apos;s browser.</li>
        <li><strong>Operating vault</strong> (Rust contract, all keys deleted after deploy) holds the money the agent may spend, with per-payment and daily limits, an approved-payee list, and revocation.</li>
        <li><strong>Agent account</strong> has a key that can only call <code>vault.pay</code>.</li>
        <li><strong>Sponsor relayer</strong> pays NEAR gas for the owner&apos;s signed actions, so the company never buys NEAR.</li>
        <li><strong>Settlement check</strong>: an invoice is paid only when the pinned token contract&apos;s transfer event shows the full amount reaching the company account. One transaction cannot pay two invoices.</li>
      </ul>
    ),
  },
  {
    id: "key-features",
    title: "Key features",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>Invoices with line items, due date, a public checkout page, and status paid / pending / refunded with explorer links.</li>
        <li>Notion: a new row becomes a NEAR invoice; the agent writes the pay links back to the row.</li>
        <li>Agent chat with typed tools only: create invoice, invoice status, list payees, pay supplier, summary.</li>
        <li>Accountant exports: <code>invoices.csv</code> and <code>payments.csv</code> (UTC, 6-decimal amounts, transaction link per row).</li>
      </ul>
    ),
  },
  {
    id: "services",
    title: "x402 pay links (for AI agents)",
    body: (
      <>
        <p>
          Every invoice also has <code>/x402pay/&lt;invoiceId&gt;</code>. Called without payment it answers <code>HTTP 402</code> with the
          payment requirements (amount, token, receiver). The paying agent signs one <code>ft_transfer</code> as a NEAR delegate action
          and retries with an <code>X-PAYMENT</code> header; SkyPay&apos;s own facilitator relays it (sponsoring gas), verifies it on chain, and
          returns <code>200</code> with the receipt. The facilitator API is at <code>/x402/supported</code>, <code>/x402/verify</code>, <code>/x402/settle</code>.
        </p>
        <p className="mt-2 text-slate-500">The network name <code>near-testnet</code> is SkyPay&apos;s own mapping of x402 to NEAR, not an official x402 network.</p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security and limits",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>SkyPay never holds the owner key. The agent key is stored encrypted and can only call the vault.</li>
        <li>The relayer only sponsors vault policy calls, funding your own vault, and exact-shape invoice payments.</li>
        <li>Testnet only. Real USDC and cross-chain payment (NEAR Intents) are not live in this build.</li>
      </ul>
    ),
  },
]

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-28 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">SkyPay docs</h1>
        <nav className="mt-4 flex flex-wrap gap-2 text-sm">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:text-slate-900">
              {s.title}
            </a>
          ))}
        </nav>
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="mt-10 scroll-mt-24">
            <h2 className="mb-3 text-xl font-semibold">{s.title}</h2>
            <div className="text-[15px] leading-7 text-slate-700">{s.body}</div>
          </section>
        ))}
      </main>
    </div>
  )
}
