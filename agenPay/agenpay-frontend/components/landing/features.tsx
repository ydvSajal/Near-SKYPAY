import {
  Bell,
  Calendar,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react"
import { Reveal } from "./reveal"

const features = [
  {
    Icon: Calendar,
    iconClass: "text-slate-600",
    title: "Automated Scheduling",
    desc: "Agent automatically schedules recurring payments, subscription renewals, and invoice due dates based on your Notion data.",
  },
  {
    Icon: Send,
    iconClass: "text-slate-600",
    title: "Smart Payment Sending",
    desc: "Create payment requests in Notion, agent instantly generates X402Pay links and sends them to clients with personalized messages.",
  },
  {
    Icon: Bell,
    iconClass: "text-slate-600",
    title: "Intelligent Follow-ups",
    desc: "Agent tracks payment status and automatically sends reminders, escalations, and thank you messages at the right time.",
  },
  {
    Icon: RefreshCw,
    iconClass: "text-slate-600",
    title: "Automatic Reconciliation",
    desc: "When payments are received, agent automatically updates your Notion database, marks invoices as paid, and triggers next actions.",
  },
  {
    Icon: MessageSquare,
    iconClass: "text-slate-600",
    title: "Natural Language Control",
    desc: 'Chat with your agent using plain English: "Send invoice to SKY Corp for 0.15 ETH" or "Refund John\'s deposit."',
  },
  {
    Icon: Sparkles,
    iconClass: "text-slate-600",
    title: "Workflow Automation",
    desc: "Agent learns your patterns and automates complex workflows like subscription management, refund processing, and client onboarding.",
  },
]

export function Features() {
  return (
    <section id="features" className="relative overflow-hidden px-4 py-14 md:px-6 md:py-20">
      

      <div className="relative z-10 mx-auto max-w-[1200px]">
        <Reveal className="mb-10 text-center md:mb-14">
          <h2 className="mb-4 font-sans text-[clamp(24px,8vw,32px)] font-bold leading-tight tracking-tight text-[#0f0f0f] md:text-[clamp(28px,4vw,48px)]">
            One connected workflow
          </h2>
          <p className="mx-auto max-w-[520px] text-[15px] leading-[1.7] text-gray-600 md:text-base">
            SKYPay&apos;s agent doesn&apos;t just process payments—it manages your
            entire payment workflow intelligently.
          </p>
        </Reveal>

        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 md:gap-5">
          {features.map(({ Icon, iconClass, title, desc }, i) => (
            <Reveal key={title} delay={(i % 3) * 80}>
              <div className="h-full rounded-lg border border-black/5 bg-white p-5 shadow-sm transition-all duration-200  hover:shadow-sm md:p-7">
                <div
                  className={`mb-5 flex h-12 w-12 items-center justify-center rounded-xl ${iconClass}`}
                >
                  <Icon size={22} />
                </div>
                <h3 className="mb-2.5 text-base font-bold text-[#0f0f0f]">{title}</h3>
                <p className="text-sm leading-[1.7] text-gray-600">{desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
