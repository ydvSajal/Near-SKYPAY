import Link from "next/link"
import { ArrowRight, Database } from "lucide-react"
import { Reveal } from "./reveal"

// Example rows illustrating the Notion database SKYPay maintains.
const rows = [
  { client: "Harbor & Pine", amount: "150.00", status: "Paid", tone: "bg-success/10 text-success", note: "Verified on NEAR" },
  { client: "Northfield Labs", amount: "250.00", status: "Pending", tone: "bg-warning/10 text-warning", note: "Pay link added" },
  { client: "Okafor Studio", amount: "80.00", status: "New", tone: "bg-muted text-muted-foreground", note: "Creating invoice" },
]

export function NotionShowcase() {
  return (
    <section className="px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
        <Reveal className="order-2 min-w-0 lg:order-1">
          <figure className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-medium">
              <Database className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} /> Client invoices
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Client</th>
                    <th className="px-3 py-3 text-right font-medium">USDC</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.client} className="border-t border-border">
                      <td className="px-5 py-3.5 font-medium">{r.client}</td>
                      <td className="tabular px-3 py-3.5 text-right">{r.amount}</td>
                      <td className="px-3 py-3.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.tone}`}>{r.status}</span></td>
                      <td className="px-5 py-3.5 text-muted-foreground">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <figcaption className="border-t border-border px-5 py-3 text-xs text-muted-foreground">Example rows. Your database lives in your own Notion workspace.</figcaption>
          </figure>
        </Reveal>

        <Reveal className="order-1 min-w-0 lg:order-2" delay={100}>
          <h2 className="text-3xl font-semibold tracking-[-0.025em] md:text-5xl">Keep working in Notion.</h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
            Add a row and the agent turns it into an invoice, then writes the pay links and the verified status back to that row.
          </p>
          <Link href="/auth/login" className="press mt-8 inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-medium hover:bg-muted">
            Connect Notion <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </div>
    </section>
  )
}
