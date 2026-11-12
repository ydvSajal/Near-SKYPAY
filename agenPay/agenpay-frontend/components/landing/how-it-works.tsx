import { Bot, Database, Zap } from "lucide-react"
import { Reveal } from "./reveal"

const steps = [
  {
    num: "01",
    Icon: Database,
    iconClass: "text-slate-600",
    title: "Connect Notion",
    desc: "Link your existing Notion database or use our template. Your payment data stays in Notion where you already work.",
  },
  {
    num: "02",
    Icon: Bot,
    iconClass: "text-slate-600",
    title: "Agent Activates",
    desc: "SKYPay AI monitors your Notion database 24/7, automatically creating invoices, scheduling payments, and handling follow-ups.",
  },
  {
    num: "03",
    Icon: Zap,
    iconClass: "text-slate-600",
    title: "Payments Flow",
    desc: "X402Pay processes all crypto transactions while your agent handles scheduling, reminders, refunds, and updates your Notion automatically.",
  },
]

export function HowItWorks() {
  return (
    <>
      {/* Divider label */}
      <div className="border-t border-black/5 px-4 pb-10 pt-7 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-gray-400">
          Built on sovereign infrastructure • Powered by X402Pay
        </span>
      </div>

      <section className="bg-white px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-[1200px]">
          <Reveal className="mb-10 text-center md:mb-14">
            <h2 className="mb-4 font-sans text-[clamp(24px,8vw,32px)] font-bold leading-tight tracking-tight text-[#0f0f0f] md:text-[clamp(28px,4vw,48px)]">
              Connect your workspace.
              <br />
              Put payments in motion.
            </h2>
            <p className="mx-auto max-w-[520px] text-[15px] leading-[1.7] text-gray-600 md:text-base">
              Connect your Notion workspace and let SKYPay&apos;s AI agent automate
              your entire crypto payment workflow.
            </p>
          </Reveal>

          <div className="grid gap-3.5 md:grid-cols-3 md:gap-6">
            {steps.map(({ num, Icon, iconClass, title, desc }, i) => (
              <Reveal key={num} delay={i * 90}>
                <div className="h-full rounded-lg border border-black/5 bg-slate-50 p-6 text-center transition-all duration-200  hover:shadow-sm md:px-7 md:py-9">
                  <div
                    className={`mx-auto mb-5 flex h-[60px] w-[60px] items-center justify-center rounded-2xl ${iconClass}`}
                  >
                    <Icon size={28} />
                  </div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-400">
                    {num}
                  </p>
                  <h3 className="mb-3 text-lg font-bold text-[#0f0f0f]">{title}</h3>
                  <p className="text-sm leading-[1.7] text-gray-600">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
