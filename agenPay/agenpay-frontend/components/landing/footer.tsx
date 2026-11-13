import Link from "next/link"
import { Logo } from "@/components/brand/logo"

const product = [
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Docs", href: "/docs" },
]
const account = [
  { label: "Sign in", href: "/auth/login" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Finance", href: "/finance" },
]

export function Footer() {
  return (
    <footer className="border-t border-border px-5 py-14 md:px-8">
      <div className="mx-auto grid max-w-[1200px] gap-10 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
            AI payment agent for invoices and supplier payments in USDC on NEAR. Testnet build: tUSDC has no value.
          </p>
        </div>
        {[["Product", product], ["Account", account]].map(([title, items]) => (
          <nav key={title as string} aria-label={title as string}>
            <h2 className="text-sm font-medium">{title as string}</h2>
            <ul className="mt-4 space-y-2.5">
              {(items as typeof product).map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <p className="mx-auto mt-12 max-w-[1200px] text-xs text-muted-foreground">Copyright SKYPay {new Date().getFullYear()}. MIT licensed.</p>
    </footer>
  )
}
