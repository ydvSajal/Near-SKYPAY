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
    <header className="fixed inset-x-0 top-0 z-[100] flex justify-center border-b border-slate-200 bg-white px-5 md:px-8">
      <nav className="flex h-[72px] w-full max-w-[1200px] items-center justify-between">
        <div className="flex min-w-0 items-center gap-2 md:gap-8">
          <Link
            href="/#hero"
            className="font-sans text-lg font-semibold leading-none tracking-[0.01em] text-[#0f0f0f] md:text-[22px]"
          >
            SKYPay
          </Link>
          <div className="hidden items-center gap-0.5 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium uppercase tracking-[0.03em] text-gray-600 transition-colors hover:bg-black/5 hover:text-[#0f0f0f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
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
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-85 md:px-4 md:text-[12.5px]"
                >
                  <LayoutDashboard size={13} />
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="whitespace-nowrap rounded-lg px-2.5 py-2 text-[11px] font-medium text-gray-600 transition-colors hover:bg-black/5 hover:text-[#0f0f0f] md:px-3.5 md:text-[12.5px]"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/login"
                  className="whitespace-nowrap rounded-lg bg-[#0f0f0f] px-3 py-2 text-[11px] font-semibold text-white shadow-sm transition-all  hover:shadow-sm md:px-[18px] md:text-[12.5px]"
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
