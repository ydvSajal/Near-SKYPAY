"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Globe, LinkIcon, Users } from "lucide-react"

const columns = [
  {
    title: "AGENT FEATURES",
    links: [
      { label: "Automated Scheduling", href: "/docs#services" },
      { label: "Smart Follow-ups", href: "/docs#key-features" },
      { label: "Notion Integration", href: "/docs#services" },
      { label: "X402Pay Processing", href: "/docs#how-it-works" },
    ],
  },
  {
    title: "DEVELOPERS",
    links: [
      { label: "Agent API", href: "/docs#services" },
      { label: "Notion Templates", href: "/docs#getting-started" },
      { label: "Webhooks", href: "/docs#services" },
      { label: "Agent Status", href: "/dashboard" },
    ],
  },
  {
    title: "COMPANY",
    links: [
      { label: "About SKYPay", href: "/#hero" },
      { label: "Agent Blog", href: "/docs" },
      { label: "Careers", href: "mailto:careers@skypay.ai" },
      { label: "Contact", href: "mailto:hello@skypay.ai" },
    ],
  },
]

const socials = [
  { Icon: Globe, label: "Website", href: "/#hero" },
  { Icon: Users, label: "Community", href: "/docs" },
  { Icon: LinkIcon, label: "Integrations", href: "/docs#services" },
]

export function Footer() {
  const footerRef = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true)
      },
      { threshold: 0.05 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <footer
      ref={footerRef}
      className="relative overflow-hidden bg-[hsl(220,30%,98%)] pt-11 md:pt-16"
    >
      {/* Animated glow that blooms in on scroll */}
      <div
        className={`pointer-events-none absolute -bottom-[120px] left-1/2 h-80 w-[680px] origin-bottom rounded-full bg-[radial-gradient(ellipse_at_50%_80%,rgba(251,146,60,0.55)_0%,rgba(196,181,253,0.35)_35%,rgba(147,197,253,0.15)_60%,transparent_75%)] transition-all duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)] md:h-[500px] md:w-[1100px] ${
          visible
            ? "-translate-x-1/2 scale-y-100 opacity-100 blur-[55px]"
            : "-translate-x-1/2 scale-y-[0.3] opacity-0 blur-[20px]"
        }`}
      />
      <div
        className={`pointer-events-none absolute -bottom-[60px] left-1/2 h-56 w-[460px] origin-bottom rounded-full bg-[radial-gradient(ellipse_at_50%_90%,rgba(251,146,60,0.3)_0%,rgba(196,181,253,0.2)_50%,transparent_75%)] blur-[80px] transition-all delay-200 duration-[1800ms] ease-[cubic-bezier(0.16,1,0.3,1)] md:h-[300px] md:w-[700px] ${
          visible ? "-translate-x-1/2 scale-x-100 opacity-80" : "-translate-x-1/2 scale-x-[0.4] opacity-0"
        }`}
      />

      <div className="relative z-10 mx-auto max-w-[1200px] px-4 pb-10 md:px-6 md:pb-14">
        <div className="mb-8 grid gap-7 sm:grid-cols-2 md:mb-12 md:gap-12 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <h3 className="mb-2.5 text-[22px] font-bold tracking-tight text-[#0f0f0f]">
              SKYPay
            </h3>
            <p className="mb-5 max-w-60 text-sm leading-[1.7] text-gray-400">
              Agentic payment infrastructure. Your AI handles all crypto payments
              automatically.
            </p>
            <div className="flex gap-2">
              {socials.map(({ Icon, label, href }) => (
                <Link
                  key={label}
                  href={href}
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/5 bg-black/[0.04] transition-colors hover:bg-black/10"
                >
                  <Icon size={15} className="text-gray-600" />
                </Link>
              ))}
            </div>
          </div>

          {columns.map(({ title, links }) => (
            <div key={title}>
              <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-400">
                {title}
              </h4>
              <ul className="flex flex-col gap-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-600 transition-colors hover:text-[#0f0f0f]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-black/5 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-gray-400">
            Copyright SKYPay {new Date().getFullYear()}
          </p>
          <p className="text-[13px] text-gray-400">
            All rights reserved. Powered by X402Pay &amp; Notion.
          </p>
        </div>
      </div>
    </footer>
  )
}
