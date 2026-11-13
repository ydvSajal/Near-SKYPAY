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
    title: "Invoices with due dates",
    desc: "Each invoice has line items, a due date and a public checkout page. Customers pay in USDC on NEAR; status is paid, pending or refunded with a transaction link.",
  },
  {
    Icon: Send,
    iconClass: "text-slate-600",
    title: "Smart Payment Sending",
    desc: "Add a row in Notion and the agent turns it into a NEAR invoice, then writes the checkout link and an x402 pay link back to the row.",
  },
  {
    Icon: Bell,
    iconClass: "text-slate-600",
    title: "Agents can pay too (x402)",
    desc: "Every invoice answers HTTP 402 with payment requirements. Another AI agent can pay it with one signed USDC transfer; SkyPay sponsors the gas.",
  },
  {
    Icon: RefreshCw,
    iconClass: "text-slate-600",
    title: "Automatic Reconciliation",
    desc: "An invoice is marked paid only after SkyPay reads the transfer on chain: right token, right receiver, full amount, used once. Export everything to CSV for your accountant.",
  },
  {
    Icon: MessageSquare,
    iconClass: "text-slate-600",
    title: "Natural Language Control",
    desc: 'Chat with your agent in plain English: "Invoice SKY Corp 150 USDC" or "Pay our hosting supplier 40 USDC."',
  },
  {
    Icon: Sparkles,
    iconClass: "text-slate-600",
    title: "Spending limits on chain",
    desc: "The agent pays suppliers from a vault contract with per-payment and daily limits and an approved-payee list. You can revoke it at any time; the contract enforces it, not our server.",
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
