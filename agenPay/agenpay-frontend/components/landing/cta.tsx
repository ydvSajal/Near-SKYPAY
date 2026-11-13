import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Reveal } from "./reveal"

export function CTA() {
  return (
    <section className="px-5 pb-24 md:px-8 md:pb-32">
      <Reveal className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-8 rounded-xl bg-primary px-8 py-12 text-primary-foreground md:flex-row md:items-center md:px-12 md:py-14">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.025em] md:text-4xl">Send your first invoice today.</h2>
          <p className="mt-3 max-w-md leading-relaxed text-primary-foreground/80">Account, Notion and a sponsored NEAR account take about two minutes.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/auth/login" className="press inline-flex h-12 items-center gap-2 rounded-lg bg-primary-foreground px-5 text-sm font-semibold text-primary hover:bg-primary-foreground/90">
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/docs" className="press inline-flex h-12 items-center rounded-lg border border-primary-foreground/30 px-5 text-sm font-medium text-primary-foreground hover:bg-primary-foreground/10">
            Read the docs
          </Link>
        </div>
      </Reveal>
    </section>
  )
}
