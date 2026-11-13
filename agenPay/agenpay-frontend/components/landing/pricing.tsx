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
    checkClass: "text-slate-500",
    cta: "Start Free Agent",
    ctaHref: "/auth/login",
    ctaClass: "bg-gray-100 text-gray-800 hover:bg-gray-200",
    highlighted: false,
  },
  {
    tier: "PRO AGENT",
    tierClass: "text-primary",
    price: "2.9%",
    sub: "Per automated transaction",
    features: [
      "Unlimited automated volume",
      "Advanced agent workflows",
      "x402 pay links for AI agents",
      "Custom Notion templates",
      "Priority agent support",
    ],
    checkClass: "text-primary",
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
      className="relative overflow-hidden bg-slate-50 px-4 py-14 md:px-6 md:py-20"
    >
      

      <div className="relative z-10 mx-auto max-w-[1200px]">
        <Reveal className="mb-10 text-center md:mb-14">
          <h2 className="mb-4 font-sans text-[clamp(24px,8vw,32px)] font-bold leading-tight tracking-tight text-[#0f0f0f] md:text-[clamp(28px,4vw,48px)]">
            Pricing that scales with you
          </h2>
          <p className="text-base text-gray-600">
            Start free, scale as your automated payments grow
          </p>
        </Reveal>

        <div className="grid items-start gap-3.5 md:grid-cols-3 md:gap-5">
          {plans.map((plan, i) => (
            <Reveal key={plan.tier} delay={i * 90}>
              <div
                className={`relative rounded-xl bg-white p-5 md:p-7 ${
                  plan.highlighted
                    ? "border-2 border-slate-200 shadow-sm"
                    : "border border-black/10 shadow-sm"
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-4 py-1 text-[11px] font-bold uppercase tracking-[0.05em] text-white">
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
