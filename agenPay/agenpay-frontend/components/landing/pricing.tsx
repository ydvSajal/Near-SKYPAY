import { Check } from "lucide-react"
import { Reveal } from "./reveal"

const included = [
  "Unlimited invoices and checkout pages",
  "NEAR gas sponsored by SKYPay",
  "Agent with on-chain spending limits",
  "x402 pay links and CSV exports",
]

// Honest pricing: the product runs on testnet today and mainnet pricing is not set.
export function Pricing() {
  return (
    <section id="pricing" className="border-t border-border px-5 py-24 md:px-8 md:py-32">
      <Reveal className="mx-auto grid max-w-[1200px] gap-10 rounded-xl border border-border bg-card p-8 md:grid-cols-[1fr_1.2fr] md:p-12">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.025em] md:text-4xl">Free while we&apos;re on testnet.</h2>
          <p className="mt-4 max-w-sm leading-relaxed text-muted-foreground">
            SKYPay currently runs on NEAR testnet with a test token that has no value. Mainnet pricing has not been set yet.
          </p>
        </div>
        <ul className="grid content-center gap-4 sm:grid-cols-2">
          {included.map((item) => (
            <li key={item} className="flex gap-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.25} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  )
}
