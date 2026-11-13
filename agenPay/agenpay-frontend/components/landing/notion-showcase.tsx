import Link from "next/link"
import { ArrowRight, CheckCircle, Database } from "lucide-react"
import { Reveal } from "./reveal"

const checklist = [
  "Create invoices directly in Notion",
  "Agent monitors database changes in real-time",
  "Automatic status updates and payment tracking",
  "Custom workflows based on your database structure",
]

const invoiceRows = [
  {
    client: "SKY Corp",
    amount: "150 USDC",
    badge: "Pending",
    badgeClass: "text-amber-600 bg-amber-500/10",
    action: "Agent: Pay link added",
    actionClass: "text-primary",
  },
  {
    client: "TechStart",
    amount: "250 USDC",
    badge: "Paid",
    badgeClass: "text-emerald-600 bg-emerald-500/10",
    action: "Agent: Verified on NEAR",
    actionClass: "text-emerald-600",
  },
  {
    client: "DevCorp",
    amount: "80 USDC",
    badge: "New",
    badgeClass: "text-blue-600 bg-blue-500/10",
    action: "Agent: Creating invoice",
    actionClass: "text-primary",
  },
]

export function NotionShowcase() {
  return (
    <section className="bg-white px-4 py-14 md:px-6 md:py-20">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid items-center gap-6 lg:grid-cols-2 lg:gap-20">
          <Reveal>
            <h2 className="mb-5 font-sans text-[clamp(24px,8vw,32px)] font-bold leading-tight tracking-tight text-[#0f0f0f] md:text-[clamp(28px,3.5vw,44px)]">
              Works natively with your Notion workspace
            </h2>
            <p className="mb-8 text-[15px] leading-[1.7] text-gray-600 md:text-base">
              No need to learn new tools. SKYPay&apos;s agent integrates seamlessly
              with your existing Notion databases, turning them into powerful
              payment management systems.
            </p>
            <ul className="mb-9 flex flex-col gap-3.5">
              {checklist.map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                    <CheckCircle size={13} className="text-emerald-500" />
                  </span>
                  <span className="text-sm text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/auth/login"
              className="inline-flex items-center gap-2 rounded-full bg-[#0f0f0f] px-[18px] py-[11px] text-[13px] font-semibold text-white transition-opacity hover:opacity-85 md:px-6 md:py-3.5 md:text-sm"
            >
              Connect Your Notion
              <ArrowRight size={15} />
            </Link>
          </Reveal>

          <Reveal delay={120}>
            <div className="rounded-[20px] border border-black/5 bg-slate-50 p-1.5">
              <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-black/5 px-5 py-4">
                  <Database size={16} className="text-gray-600" />
                  <span className="text-sm font-semibold">Client Invoices Database</span>
                </div>
                <div className="p-3.5 md:p-5">
                  <div className="mb-3 hidden grid-cols-[1fr_80px_80px_110px] gap-3 border-b border-black/5 pb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400 sm:grid">
                    <div>Client</div>
                    <div>Amount</div>
                    <div>Status</div>
                    <div>Action</div>
                  </div>
                  {invoiceRows.map((row) => (
                    <div
                      key={row.client}
                      className="grid items-center gap-1.5 border-b border-black/[0.04] py-3 sm:grid-cols-[1fr_80px_80px_110px] sm:gap-3 sm:py-2.5"
                    >
                      <div className="text-[13px] font-medium">{row.client}</div>
                      <div className="text-[13px] text-gray-700">{row.amount}</div>
                      <div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.badgeClass}`}
                        >
                          {row.badge}
                        </span>
                      </div>
                      <div className={`text-[11px] font-medium ${row.actionClass}`}>
                        {row.action}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
