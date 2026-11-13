import { FileText, Gauge, MessageSquare, ShieldCheck, Table2, Zap } from "lucide-react"
import { Reveal } from "./reveal"

const prompts = ["Invoice Harbor & Pine 150 USDC", "Is INV-0042 paid?", "Pay our hosting supplier 40 USDC", "Summarize this month"]

function Cell({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div data-reveal-item className={`flex flex-col rounded-xl border border-border p-6 md:p-7 ${className}`}>
      {children}
    </div>
  )
}

function Title({ Icon, children, light = false }: { Icon: typeof Zap; children: React.ReactNode; light?: boolean }) {
  return (
    <h3 className={`flex items-center gap-2 text-lg font-semibold tracking-[-0.01em] ${light ? "text-primary-foreground" : ""}`}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {children}
    </h3>
  )
}

export function Features() {
  return (
    <section id="features" className="bg-surface px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-[1200px]">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.025em] md:text-5xl">Everything a small finance team needs, and every claim checkable.</h2>

        <Reveal stagger className="mt-14 grid gap-4 md:grid-cols-3">
          <Cell className="bg-primary text-primary-foreground md:col-span-2">
            <Title Icon={FileText} light>Invoices with due dates</Title>
            <p className="mt-2 max-w-md leading-relaxed text-primary-foreground/80">
              Line items, a due date and a public checkout page. Status reads paid, pending or refunded, each with a transaction link.
            </p>
            <div className="mt-auto pt-8">
              <div className="grid max-w-md grid-cols-[1fr_auto] gap-y-2 border-t border-primary-foreground/20 pt-4 text-sm">
                <span className="text-primary-foreground/80">Brand refresh, phase 2</span><span className="tabular">120.00</span>
                <span className="text-primary-foreground/80">Asset delivery</span><span className="tabular">30.00</span>
                <span className="font-medium">Total due</span><span className="tabular font-semibold">150.00 USDC</span>
              </div>
            </div>
          </Cell>

          <Cell className="bg-card">
            <Title Icon={Zap}>Agents can pay too</Title>
            <p className="mt-2 leading-relaxed text-muted-foreground">Every invoice answers HTTP 402. Another agent pays with one signed USDC transfer; SKYPay sponsors the gas.</p>
            <pre className="mt-6 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs leading-relaxed text-foreground md:mt-auto"><code>{"GET /x402pay/inv_42\n402 Payment Required\nX-PAYMENT: <signed transfer>\n200 OK  status: paid"}</code></pre>
          </Cell>

          <Cell className="bg-card">
            <Title Icon={Gauge}>Limits on chain</Title>
            <p className="mt-2 leading-relaxed text-muted-foreground">Per-payment and daily caps, an approved-payee list and one-click revoke. The vault contract enforces them, not our server.</p>
          </Cell>

          <Cell className="bg-card">
            <Title Icon={ShieldCheck}>Verified settlement</Title>
            <p className="mt-2 leading-relaxed text-muted-foreground">Right token, right receiver, full amount, used once. A screenshot or a claimed hash is never enough.</p>
          </Cell>

          <Cell className="bg-card">
            <Title Icon={Table2}>Books that close</Title>
            <p className="mt-2 leading-relaxed text-muted-foreground">Export invoices.csv and payments.csv with UTC times, exact amounts and a transaction link per row.</p>
          </Cell>

          <Cell className="bg-background md:col-span-3 md:flex-row md:items-center md:justify-between md:gap-10">
            <div className="max-w-md">
              <Title Icon={MessageSquare}>Ask in plain English</Title>
              <p className="mt-2 leading-relaxed text-muted-foreground">The agent only has typed tools: invoice, check status, pay an approved supplier, summarize.</p>
            </div>
            <ul className="mt-6 flex flex-wrap gap-2 md:mt-0 md:justify-end">
              {prompts.map((p) => (
                <li key={p} className="rounded-full border border-border bg-card px-3.5 py-2 text-sm">{p}</li>
              ))}
            </ul>
          </Cell>
        </Reveal>
      </div>
    </section>
  )
}
