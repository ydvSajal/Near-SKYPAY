"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle, PlayCircle } from "lucide-react"

export function CTA() {
  const [email, setEmail] = useState("")
  const [subscribed, setSubscribed] = useState(false)

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setSubscribed(true)
  }

  return (
    <section className="relative overflow-hidden bg-white px-4 py-14 md:px-6 md:py-20">
      

      <div className="relative z-10 mx-auto max-w-[700px] text-center">
        <h2 className="mb-5 font-sans text-[clamp(24px,8vw,34px)] font-bold leading-[1.15] tracking-tight text-[#0f0f0f] md:text-[clamp(28px,4vw,52px)]">
          Ready to automate your crypto payments?
        </h2>
        <p className="mb-7 text-[15px] leading-[1.7] text-gray-600 md:mb-10 md:text-[17px]">
          Connect your Notion workspace and let SKYPay&apos;s AI agent handle all
          your payment operations automatically.
        </p>

        <div className="mb-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-2 rounded-full bg-[#0f0f0f] px-[18px] py-[11px] text-[13px] font-semibold text-white shadow-sm transition-transform  md:px-7 md:py-3.5 md:text-[15px]"
          >
            Start Your Agent Free
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/docs#how-it-works"
            className="inline-flex items-center gap-2 rounded-full border border-black/10 px-[18px] py-[11px] text-[13px] font-medium text-gray-800 transition-colors hover:bg-black/5 md:px-7 md:py-3.5 md:text-[15px]"
          >
            <PlayCircle size={16} />
            Watch Agent Demo
          </Link>
        </div>

        {subscribed ? (
          <p className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-700">
            <CheckCircle size={16} />
            You&apos;re on the list — we&apos;ll keep you posted.
          </p>
        ) : (
          <form
            onSubmit={handleSubscribe}
            className="flex flex-wrap items-center justify-center gap-2.5"
          >
            <label htmlFor="cta-email" className="sr-only">
              Email address
            </label>
            <input
              id="cta-email"
              type="email"
              required
              placeholder="Enter your email for agent updates"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-full border border-black/10 bg-white px-5 py-3 text-sm outline-none transition-colors focus:border-slate-200 sm:w-[260px]"
            />
            <button
              type="submit"
              className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary"
            >
              Get Agent Updates
            </button>
          </form>
        )}
      </div>
    </section>
  )
}
