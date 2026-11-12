import Link from "next/link"
import {
  ArrowRight,
  Bell,
  Bot,
  Calendar,
  Database,
  PlayCircle,
  Send,
} from "lucide-react"

const notionMetrics = [
  { label: "Open", value: "12" },
  { label: "Paid", value: "84" },
  { label: "Recovered", value: "91%" },
]

const notionRows = [
  {
    name: "SKY Corp Invoice",
    sub: "Due: Tomorrow • 0.15 ETH",
    badge: "Pending",
    badgeClass: "text-amber-600 bg-amber-500/15",
  },
  {
    name: "Monthly Subscription",
    sub: "Auto-renew: Jan 15 • 120 USDC",
    badge: "Scheduled",
    badgeClass: "text-blue-600 bg-blue-500/10",
  },
  {
    name: "Design Retainer",
    sub: "Reminder in 4h • 0.42 ETH",
    badge: "Follow-up",
    badgeClass: "text-purple-600 bg-purple-600/10",
  },
]

const agentEvents = [
  {
    Icon: Send,
    iconClass: "text-indigo-500 bg-indigo-500/10",
    title: "Invoice delivered with dynamic pay-link",
    sub: "X402Pay + email personalization • 2 min ago",
  },
  {
    Icon: Calendar,
    iconClass: "text-violet-500 bg-violet-500/10",
    title: "Refund and follow-up workflow armed",
    sub: "Auto refund on day 30 • 4 min ago",
  },
  {
    Icon: Bell,
    iconClass: "text-orange-500 bg-orange-500/10",
    title: "Risk monitor flagged a late payer",
    sub: "Reminder queued with adaptive retry • 8 min ago",
  },
]

export function Hero() {
  return (
    <section
      id="hero"
      className="relative flex items-center overflow-hidden pb-7 pt-24 md:min-h-[90vh] md:pb-10 md:pt-[120px]"
    >
      {/* Warm-to-cool halo backdrop */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[52vh] bg-[linear-gradient(180deg,rgba(255,237,214,0.95)_0%,rgba(255,248,240,0.74)_24%,rgba(231,240,255,0.58)_56%,rgba(243,246,252,0)_100%)] md:h-[68vh]" />
      <div className="pointer-events-none absolute -top-[150px] left-1/2 h-[380px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(255,115,0,0.72)_0%,rgba(255,132,20,0.55)_32%,rgba(255,174,88,0.2)_58%,transparent_82%)] blur-[38px] md:-top-[230px] md:h-[560px] md:w-[1240px] md:blur-[62px]" />
      <div className="pointer-events-none absolute left-[3%] top-[9%] h-60 w-80 rounded-full bg-[radial-gradient(ellipse,rgba(89,130,255,0.38)_0%,rgba(122,163,255,0.2)_36%,transparent_74%)] blur-[56px] md:top-[12%] md:h-[420px] md:w-[620px] md:blur-[94px]" />
      <div className="pointer-events-none absolute right-[3%] top-[16%] h-[210px] w-[300px] rounded-full bg-[radial-gradient(ellipse,rgba(117,154,255,0.34)_0%,rgba(158,189,255,0.18)_48%,transparent_78%)] blur-[54px] md:top-[22%] md:h-[360px] md:w-[560px] md:blur-[92px]" />

      <div className="relative z-10 mx-auto w-full max-w-[1200px] px-4 md:px-6">
        <div className="mx-auto max-w-[800px] text-center">
          <div className="mb-5 flex justify-center md:mb-7">
            <span className="text-base tracking-[5px] text-gray-400 md:text-xl md:tracking-[8px]">
              ✦ ✦ ✦
            </span>
          </div>

          <div className="mb-5 inline-flex flex-wrap items-center justify-center gap-1.5 md:mb-6">
            <span className="rounded-full border border-blue-500/25 bg-blue-50/90 px-3 py-1 text-[11px] tracking-[0.02em] text-blue-700 md:px-4 md:py-1.5 md:text-xs">
              Agentic Payment Infrastructure
            </span>
          </div>

          <h1 className="mb-4 font-serif text-[clamp(34px,10vw,52px)] font-medium leading-[1.05] tracking-tight text-[#0f0f0f] md:mb-6 md:text-[clamp(46px,7vw,88px)]">
            Your AI agent handles
            <br />
            <span className="text-gray-900">all crypto payments</span>
          </h1>

          <p className="mx-auto mb-7 max-w-[560px] text-[15px] leading-relaxed text-gray-600 md:mb-10 md:text-lg md:leading-[1.7]">
            SKYPay is the first agentic payment infrastructure. An AI agent that
            automatically schedules, sends, receives, and manages all your crypto
            payments. Powered by X402Pay &amp; Notion.
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/auth/login"
              className="inline-flex items-center gap-2 rounded-full bg-[#0f0f0f] px-[18px] py-[11px] text-[13px] font-semibold text-white shadow-[0_8px_24px_rgba(15,23,42,0.28)] transition-all hover:-translate-y-px hover:shadow-[0_8px_30px_rgba(0,0,0,0.2)] md:px-7 md:py-3.5 md:text-[15px]"
            >
              Start Your Agent Free
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/docs#how-it-works"
              className="inline-flex items-center gap-2 rounded-full border border-slate-400/40 bg-white/90 px-[18px] py-[11px] text-[13px] font-medium text-gray-900 transition-colors hover:bg-white md:px-7 md:py-3.5 md:text-[15px]"
            >
              <PlayCircle size={16} />
              Watch Demo
            </Link>
          </div>
          <p className="mt-5 text-xs leading-normal text-gray-500 md:text-[13px]">
            Connect your Notion • Agent handles the rest • Powered by X402Pay
          </p>
        </div>

        {/* Hero demo card */}
        <div className="mt-9 md:mt-14">
          <div className="overflow-hidden rounded-3xl border border-gray-900/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.94)_0%,rgba(250,252,255,0.92)_52%,rgba(255,248,238,0.92)_100%)] shadow-[0_24px_90px_rgba(15,23,42,0.08),0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-md">
            {/* Window bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900/5 bg-[rgba(247,249,255,0.9)] px-3 py-2.5 md:px-5 md:py-3">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28ca41]" />
                <span className="ml-2 text-[11px] text-slate-500 md:text-xs">
                  SKYPay Agent • Live Workspace
                </span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Sync Healthy
              </div>
            </div>

            <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
              {/* Notion side */}
              <div className="border-b border-slate-900/5 bg-white/55 p-4 md:p-7 lg:border-b-0 lg:border-r">
                <div className="mb-5 flex items-center gap-2">
                  <Database size={20} className="text-gray-700" />
                  <span className="text-sm font-semibold">Your Notion Database</span>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {notionMetrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-xl border border-slate-900/5 bg-[rgba(248,250,255,0.9)] px-3 py-2.5"
                    >
                      <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-slate-400">
                        {metric.label}
                      </p>
                      <p className="text-base font-bold text-slate-900">{metric.value}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2.5">
                  {notionRows.map((item) => (
                    <div
                      key={item.name}
                      className="flex flex-col items-start justify-between gap-2 rounded-2xl border border-slate-900/5 bg-[rgba(248,249,255,0.86)] p-3 sm:flex-row sm:items-center sm:px-4"
                    >
                      <div>
                        <p className="mb-0.5 text-[13px] font-medium">{item.name}</p>
                        <p className="text-[11px] text-gray-500">{item.sub}</p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${item.badgeClass}`}
                      >
                        {item.badge}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent side */}
              <div className="bg-[linear-gradient(165deg,rgba(255,255,255,0.42)_0%,rgba(240,247,255,0.62)_100%)] p-4 md:p-7">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot size={20} className="text-indigo-500" />
                    <span className="text-sm font-semibold">SKYPay Agent</span>
                    <span className="flex items-center gap-1 text-[11px] text-emerald-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500">
                    Autonomous Mode
                  </span>
                </div>

                <div className="mb-3.5 rounded-2xl border border-indigo-500/15 bg-[linear-gradient(135deg,rgba(99,102,241,0.09)_0%,rgba(14,165,233,0.07)_100%)] px-3.5 py-3">
                  <p className="mb-1 text-[11px] uppercase tracking-[0.04em] text-slate-500">
                    Current instruction
                  </p>
                  <p className="text-xs font-medium text-slate-800 md:text-[13px]">
                    &quot;Collect 0.15 ETH from SKY Corp, auto-refund after 30 days,
                    then mark paid in Notion.&quot;
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  {agentEvents.map(({ Icon, iconClass, title, sub }) => (
                    <div
                      key={title}
                      className="flex items-start gap-3 rounded-xl border border-slate-900/5 bg-white/65 p-2.5"
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`}
                      >
                        <Icon size={14} />
                      </div>
                      <div>
                        <p className="mb-0.5 text-[13px] font-medium">{title}</p>
                        <p className="text-[11px] text-gray-500">{sub}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3.5 flex flex-col items-start justify-between gap-2.5 sm:flex-row sm:items-center">
                  <span className="text-[11px] text-slate-500">Last sync: 12 seconds ago</span>
                  <Link
                    href="/dashboard"
                    className="rounded-full border border-slate-900/10 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-white"
                  >
                    View Agent Log
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
