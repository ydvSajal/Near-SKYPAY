"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Logo } from "@/components/brand/logo"

const tabs = [
  { href: "/dashboard", label: "Overview" },
  { href: "/finance", label: "Finance" },
]

/** Shared header for the signed-in workspace. `children` renders route-specific controls on the right. */
export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, logout } = useAuth()
  const pathname = usePathname()
  const initials = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase()

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 md:px-6">
        <Link href="/" aria-label="SKYPay home" className="shrink-0 rounded-lg"><Logo /></Link>
        <nav aria-label="Workspace" className="ml-2 hidden items-center gap-1 sm:flex">
          {tabs.map((t) => {
            const active = pathname === t.href
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-card font-medium text-foreground ring-1 ring-border" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {children}
          <span aria-hidden className="hidden h-6 w-px bg-border md:block" />
          <div className="hidden items-center gap-2 md:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials}</span>
            <span className="max-w-[160px] truncate text-sm text-muted-foreground">{user?.email}</span>
          </div>
          <button type="button" onClick={logout} aria-label="Sign out" className="press flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
      {/* Phone: tabs get their own row so they are always one tap away. */}
      <nav aria-label="Workspace" className="flex gap-1 border-t border-border px-4 py-2 sm:hidden">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={pathname === t.href ? "page" : undefined}
            className={`flex-1 rounded-lg py-2 text-center text-sm ${pathname === t.href ? "bg-card font-medium ring-1 ring-border" : "text-muted-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
