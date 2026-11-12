import Link from "next/link"
import { CheckCircle } from "lucide-react"
import { Reveal } from "./reveal"

const plans = [
  {
    tier: "STARTER",
    tierClass: "text-gray-400",
    price: "Free",
    sub: "Perfect for getting started",
    features: [
      "Up to $1,000/month automated",
      "Basic AI agent capabilities",
      "Notion integration",
      "X402Pay processing",
    ],
    checkClass: "text-emerald-500",
    cta: "Start Free Agent",
    ctaHref: "/auth/login",
    ctaClass: "bg-gray-100 text-gray-800 hover:bg-gray-200",
    highlighted: false,
  },
  {
    tier: "PRO AGENT",
    tierClass: "text-indigo-500",
    price: "2.9%",
    sub: "Per automated transaction",
    features: [
      "Unlimited automated volume",
      "Advanced agent workflows",
      "Smart scheduling & follow-ups",
      "Custom Notion templates",
      "Priority agent support",
    ],
    checkClass: "text-indigo-500",
    cta: "Activate Pro Agent",
    ctaHref: "/auth/login",
    ctaClass: "bg-[#0f0f0f] text-white hover:opacity-85",
    highlighted: true,
  },
  {
    tier: "ENTERPRISE",
    tierClass: "text-gray-400",
    price: "Custom",
    sub: "For large-scale automation",
    features: [
      "Volume-based pricing",
      "Multi-workspace agents",
      "Custom agent training",
      "Dedicated agent manager",
      "White-label deployment",
    ],
    checkClass: "text-emerald-500",
    cta: "Contact Sales",
    ctaHref: "mailto:sales@skypay.ai",
    ctaClass: "bg-gray-100 text-gray-800 hover:bg-gray-200",
    highlighted: false,
  },
]

export function Pricing() {
  return (
    <section
      id="pricing"
      className="relative overflow-hidden bg-[linear-gradient(to_bottom,hsl(220,30%,98%),#fff)] px-4 py-14 md:px-6 md:py-20"
    >
      <div className="pointer-events-none absolute -top-[100px] left-1/2 h-[350px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(196,181,253,0.2)_0%,transparent_70%)] blur-[60px]" />

      <div className="relative z-10 mx-auto max-w-[1200px]">
        <div className="mb-5 flex justify-center">
          <span className="text-base tracking-[6px] text-gray-300">✦ ✦ ✦</span>
        </div>

        <Reveal className="mb-10 text-center md:mb-14">
          <h2 className="mb-4 font-serif text-[clamp(24px,8vw,32px)] font-bold leading-tight tracking-tight text-[#0f0f0f] md:text-[clamp(28px,4vw,48px)]">
            Simple pricing for your payment agent
          </h2>
          <p className="text-base text-gray-600">
            Start free, scale as your automated payments grow
          </p>
        </Reveal>

        <div className="grid items-start gap-3.5 md:grid-cols-3 md:gap-5">
          {plans.map((plan, i) => (
            <Reveal key={plan.tier} delay={i * 90}>
              <div
                className={`relative rounded-[20px] bg-white p-5 md:p-7 ${
                  plan.highlighted
                    ? "border-2 border-indigo-500 shadow-[0_8px_40px_rgba(99,102,241,0.15)]"
                    : "border border-black/10 shadow-[0_2px_20px_rgba(0,0,0,0.04)]"
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-indigo-500 px-4 py-1 text-[11px] font-bold uppercase tracking-[0.05em] text-white">
                    Most Popular
                  </div>
                )}
                <p
                  className={`mb-3 text-[11px] font-bold uppercase tracking-[0.1em] ${plan.tierClass}`}
                >
                  {plan.tier}
                </p>
                <h3 className="mb-2 text-4xl font-bold tracking-tight text-[#0f0f0f]">
                  {plan.price}
                </h3>
                <p className="mb-7 text-sm text-gray-400">{plan.sub}</p>
                <div className="mb-6 h-px bg-black/5" />
                <ul className="mb-7 flex flex-col gap-3">
                  {plan.features.map((item) => (
                    <li key={item} className="flex items-center gap-2.5 text-sm text-gray-700">
                      <CheckCircle size={15} className={`shrink-0 ${plan.checkClass}`} />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.ctaHref}
                  className={`block w-full rounded-full py-3 text-center text-sm font-semibold transition-all ${plan.ctaClass}`}
                >
                  {plan.cta}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
