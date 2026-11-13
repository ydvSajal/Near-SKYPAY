import Link from "next/link"
import { Check } from "lucide-react"
import { Logo } from "@/components/brand/logo"

export type StepId = "account" | "notion" | "near"

const STEPS: { id: StepId; title: string; desc: string }[] = [
  { id: "account", title: "Your account", desc: "Email and password for the workspace." },
  { id: "notion", title: "Connect Notion", desc: "Optional. Invoices sync to a database you own." },
  { id: "near", title: "NEAR account", desc: "Sponsored company account, vault and agent key." },
]

/** Layout for every onboarding screen: progress on the left (top on phones), the task on the right. */
export function OnboardingShell({ step, children }: { step: StepId; children: React.ReactNode }) {
  const current = STEPS.findIndex((s) => s.id === step)

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="mx-auto flex h-16 max-w-[1100px] items-center justify-between px-5 md:px-8">
        <Link href="/" aria-label="SKYPay home" className="rounded-lg"><Logo /></Link>
        <Link href="/" className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">Back to site</Link>
      </header>

      <div className="mx-auto grid max-w-[1100px] gap-8 px-5 pb-16 pt-6 md:px-8 md:pt-12 lg:grid-cols-[280px_1fr] lg:gap-16">
        {/* Phone and tablet: compact progress */}
        <div className="lg:hidden">
          <p className="text-sm text-muted-foreground">
            Step {current + 1} of {STEPS.length}: <span className="font-medium text-foreground">{STEPS[current].title}</span>
          </p>
          <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s.id} className={`h-1 rounded-full ${i <= current ? "bg-primary" : "bg-border"}`} />
            ))}
          </div>
        </div>

        {/* Desktop: step rail */}
        <ol className="hidden lg:block" aria-label="Setup progress">
          {STEPS.map((s, i) => {
            const done = i < current
            const active = i === current
            return (
              <li key={s.id} aria-current={active ? "step" : undefined} className="relative flex gap-4 pb-8 last:pb-0">
                {i < STEPS.length - 1 && <span aria-hidden className={`absolute left-[13px] top-8 h-[calc(100%-36px)] w-px ${done ? "bg-primary" : "bg-border"}`} />}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                    done ? "border-primary bg-primary text-primary-foreground" : active ? "border-primary bg-card text-primary" : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
                  <span className="sr-only">{done ? " (done)" : active ? " (current)" : ""}</span>
                </span>
                <div className="pt-0.5">
                  <p className={`text-sm font-medium ${active || done ? "text-foreground" : "text-muted-foreground"}`}>{s.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
                </div>
              </li>
            )
          })}
        </ol>

        <main className="enter min-w-0">{children}</main>
      </div>
    </div>
  )
}

/** Panel used for each step's content. */
export function StepPanel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-border bg-card p-6 sm:p-8 lg:mx-0">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">{title}</h1>
      {description && <p className="mt-2 leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-8">{children}</div>
    </section>
  )
}
