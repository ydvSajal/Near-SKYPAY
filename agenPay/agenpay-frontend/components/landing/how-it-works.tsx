"use client"

import { useRef } from "react"
import { Database, FileText, ShieldCheck } from "lucide-react"
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap"

const steps = [
  { Icon: Database, title: "Connect", desc: "Link Notion. SKYPay adds a payments database and watches it for new rows." },
  { Icon: FileText, title: "Invoice", desc: "Each row or chat request becomes a NEAR invoice with a checkout page and an x402 pay link." },
  { Icon: ShieldCheck, title: "Settle", desc: "Paid only after the transfer is verified on chain. Notion and your CSV exports update." },
]

export function HowItWorks() {
  const root = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      // The rail fills as the reader moves through the steps: the flow is the story.
      gsap.fromTo("[data-rail]", { scaleX: 0 }, {
        scaleX: 1, ease: "none",
        scrollTrigger: { trigger: "[data-steps]", start: "top 75%", end: "bottom 55%", scrub: 0.6 },
      })
      gsap.from("[data-step]", {
        opacity: 0, y: 20, duration: 0.7, ease: "power3.out", stagger: 0.12,
        scrollTrigger: { trigger: "[data-steps]", start: "top 80%", once: true },
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} id="how-it-works" className="border-t border-border px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-[-0.025em] md:text-5xl">From one sentence to a settled invoice.</h2>
          <blockquote className="mt-8 border-l-2 border-primary pl-5 text-lg leading-relaxed text-foreground">
            &ldquo;Invoice Harbor &amp; Pine 150 USDC for the brand refresh, due Friday.&rdquo;
          </blockquote>
        </div>

        <div data-steps className="relative mt-16">
          <div aria-hidden className="absolute left-0 right-0 top-5 hidden h-px bg-border md:block">
            <div data-rail className="h-full origin-left bg-primary" />
          </div>
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
            {steps.map(({ Icon, title, desc }) => (
              <li key={title} data-step className="relative">
                <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-primary">
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.01em]">{title}</h3>
                <p className="mt-2 max-w-[34ch] leading-relaxed text-muted-foreground">{desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
