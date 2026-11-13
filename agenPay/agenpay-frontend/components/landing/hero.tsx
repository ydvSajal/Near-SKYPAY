import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { HeroMedia } from "./hero-media"

const i = (n: number) => ({ "--i": n }) as React.CSSProperties

export function Hero() {
  return (
    <section id="hero" className="overflow-x-clip px-5 pb-20 pt-28 md:px-8 md:pb-28 md:pt-32">
      <div className="mx-auto grid max-w-[1200px] items-center gap-14 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
        <div className="max-w-xl">
          <p className="enter mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground" style={i(0)}>
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            Live on NEAR testnet
          </p>
          <h1 className="enter text-[clamp(40px,6vw,68px)] font-semibold leading-[1.02] tracking-[-0.035em]" style={i(1)}>
            Payments on your terms.
          </h1>
          <p className="enter mt-6 max-w-md text-lg leading-relaxed text-muted-foreground" style={i(2)}>
            Invoice clients in USDC on NEAR. Your AI agent pays approved suppliers within limits a contract enforces.
          </p>
          <div className="enter mt-9 flex flex-wrap items-center gap-3" style={i(3)}>
            <Link href="/auth/login" className="press inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="#how-it-works" className="press inline-flex h-12 items-center rounded-lg border border-border bg-card px-5 text-sm font-medium text-foreground hover:bg-muted">
              See how it works
            </Link>
          </div>
        </div>
        <div className="enter" style={i(2)}>
          <HeroMedia />
        </div>
      </div>
    </section>
  )
}
