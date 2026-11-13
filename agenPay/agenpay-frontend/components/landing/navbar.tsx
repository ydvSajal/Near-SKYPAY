"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Logo } from "@/components/brand/logo"

const links = [
  { label: "Features", hash: "#features" },
  { label: "Pricing", hash: "#pricing" },
]

export function Navbar() {
  const { isAuthenticated, user, isLoading } = useAuth()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const onHome = pathname === "/"
  const href = (hash: string) => (onHome ? hash : `/${hash}`)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const navLink = "rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-5 md:px-8" aria-label="Main">
        <div className="flex items-center gap-8">
          <Link href={onHome ? "#hero" : "/"} className="rounded-lg" aria-label="SKYPay home">
            <Logo />
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <a key={l.label} href={href(l.hash)} className={navLink}>{l.label}</a>
            ))}
            <Link href="/docs" className={navLink}>Docs</Link>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isLoading &&
            (isAuthenticated && user ? (
              <Link href="/dashboard" className="press inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/auth/login" className={`${navLink} hidden sm:inline-flex`}>Sign in</Link>
                <Link href="/auth/login" className="press inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                  Get started
                </Link>
              </>
            ))}
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground hover:bg-muted md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-nav" className="border-t border-border bg-background px-5 pb-5 pt-2 md:hidden">
          <ul className="flex flex-col">
            {links.map((l) => (
              <li key={l.label}>
                <a href={href(l.hash)} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-base text-foreground hover:bg-muted">{l.label}</a>
              </li>
            ))}
            <li><Link href="/docs" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-base text-foreground hover:bg-muted">Docs</Link></li>
            {!isAuthenticated && (
              <li><Link href="/auth/login" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-base text-foreground hover:bg-muted">Sign in</Link></li>
            )}
          </ul>
        </div>
      )}
    </header>
  )
}
