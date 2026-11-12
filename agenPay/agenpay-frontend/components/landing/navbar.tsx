"use client"

import Link from "next/link"
import { LayoutDashboard } from "lucide-react"
import { useAuth } from "@/lib/auth-context"

const navLinks = [
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Docs", href: "/docs" },
]

export function Navbar() {
  const { isAuthenticated, user, isLoading } = useAuth()

  return (
    <header className="fixed inset-x-0 top-2.5 z-[100] flex justify-center px-2.5 md:top-[18px] md:px-6">
      <nav className="flex h-[50px] w-full max-w-[900px] items-center justify-between rounded-full border border-white/95 bg-[rgba(252,245,235,0.88)] pl-3 pr-1.5 shadow-[0_10px_34px_rgba(30,41,59,0.14),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-2xl md:h-14 md:pl-5">
        <div className="flex min-w-0 items-center gap-2 md:gap-8">
          <Link
            href="/#hero"
            className="font-serif text-lg font-semibold leading-none tracking-[0.01em] text-[#0f0f0f] md:text-[22px]"
          >
            SKYPay
          </Link>
          <div className="hidden items-center gap-0.5 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="rounded-full px-3 py-1.5 text-[12.5px] font-medium uppercase tracking-[0.03em] text-gray-600 transition-colors hover:bg-black/5 hover:text-[#0f0f0f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 md:gap-1.5">
          {!isLoading &&
            (isAuthenticated && user ? (
              <>
                <span className="hidden max-w-[180px] truncate pr-2 text-xs text-gray-500 lg:inline">
                  Welcome, {user.name || user.email}
                </span>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#0f0f0f] px-3 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-85 md:px-4 md:text-[12.5px]"
                >
                  <LayoutDashboard size={13} />
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="whitespace-nowrap rounded-full px-2.5 py-2 text-[11px] font-medium text-gray-600 transition-colors hover:bg-black/5 hover:text-[#0f0f0f] md:px-3.5 md:text-[12.5px]"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/login"
                  className="whitespace-nowrap rounded-full bg-[#0f0f0f] px-3 py-2 text-[11px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition-all hover:scale-[1.03] hover:shadow-[0_4px_16px_rgba(0,0,0,0.2)] md:px-[18px] md:text-[12.5px]"
                >
                  Get Started
                </Link>
              </>
            ))}
        </div>
      </nav>
    </header>
  )
}
