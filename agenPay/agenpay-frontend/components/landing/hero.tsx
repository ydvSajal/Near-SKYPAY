import Link from "next/link"
import { ArrowRight, ArrowUpRight, Check, Database, Send } from "lucide-react"

const workflow = [
  { title: "Read your Notion workspace", detail: "Invoices, recipients, and payment instructions", icon: Database },
  { title: "Prepare the payment", detail: "Scheduling and follow-ups in one workflow", icon: Send },
  { title: "Keep your records in sync", detail: "Payment status updates back in Notion", icon: Check },
]

export function Hero() {
  return (
    <section id="hero" className="border-b border-slate-200 bg-white px-5 pb-16 pt-32 md:px-8 md:pb-24 md:pt-44">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div>
          <p className="mb-6 text-sm font-medium text-primary">Payment operations, connected.</p>
          <h1 className="max-w-xl text-[clamp(40px,5.1vw,66px)] font-semibold leading-[1.06] tracking-[-0.045em] text-slate-900">Payments on<br />your terms.</h1>
          <p className="mt-7 max-w-md text-base leading-8 text-slate-600 md:text-lg">Schedule crypto payments, manage invoices, and keep Notion up to date with your AI payment agent.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/auth/login" className="inline-flex min-h-12 items-center gap-3 rounded-lg bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-[#294b6c]">Get started <ArrowRight size={16} /></Link>
            <Link href="/docs#how-it-works" className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">Explore the workflow <ArrowUpRight size={15} /></Link>
          </div>
          <p className="mt-6 text-xs leading-6 text-slate-500">Notion integration · X402Pay processing · One workspace</p>
        </div>
        <div data-ui className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <span className="text-sm font-semibold text-slate-900">SKYPay / Payment workflow</span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500">Preview</span>
          </div>
          <div className="p-5 md:p-7">
            <div className="mb-7 border-l-2 border-primary bg-slate-50 p-4">
              <p className="mb-2 text-xs font-medium text-slate-500">Your instruction</p>
              <p className="text-sm leading-6 text-slate-800">“Invoice SKY Corp for 0.15 ETH and update the payment status in Notion.”</p>
            </div>
            <ol className="space-y-0">
              {workflow.map(({title, detail, icon: Icon}, i) => (
                <li key={title} className="flex gap-4 border-b border-slate-100 py-5 first:pt-0 last:border-0 last:pb-0">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-primary"><Icon size={19} strokeWidth={1.5} /></span>
                  <div className="flex-1"><p className="text-sm font-medium text-slate-900">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div>
                  <span className="pt-1 text-xs tabular-nums text-slate-400">0{i + 1}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">From instruction to reconciliation.</div>
        </div>
      </div>
    </section>
  )
}
