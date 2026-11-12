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
  return (
    <footer
      className="relative overflow-hidden bg-[hsl(220,30%,98%)] pt-11 md:pt-16"
    >
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
