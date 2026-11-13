"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Building2, Check, ChevronDown, Database, KeyRound, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { BusinessForm } from "@/components/app/business-form"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const R = 9
const CIRC = 2 * Math.PI * R

/** Header menu: shows which setup steps are done and lets the owner finish or change them at any time. */
export function SetupMenu() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [notionBusy, setNotionBusy] = useState(false)
  const [err, setErr] = useState("")
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open])

  if (!user) return null

  const steps = [
    { id: "business", Icon: Building2, title: "Business details", done: !!user.companyName, doneText: "Complete",
      desc: "Seller name, address and tax number printed on invoices." },
    { id: "notion", Icon: Database, title: "Notion", done: !!user.hasNotionIntegration, doneText: "Connected",
      desc: "Invoices and payments sync to a workspace you own." },
    { id: "near", Icon: KeyRound, title: "NEAR account", done: !!user.hasNearAccount, doneText: "Connected",
      desc: "Company account, vault and agent key. Needed to get paid." },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const all = doneCount === steps.length

  const connectNotion = async () => {
    setNotionBusy(true)
    setErr("")
    try {
      const r = await authService.getNotionAuthUrl()
      if (r.success && r.authUrl) { window.location.href = r.authUrl; return }
      setErr(r.error || "Could not start the Notion connection.")
    } catch {
      setErr("Could not start the Notion connection.")
    }
    setNotionBusy(false)
  }

  const action = "press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
  const ghost = "press inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="press inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm font-medium hover:bg-muted"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="-rotate-90">
          <circle cx="11" cy="11" r={R} fill="none" strokeWidth="2.5" className="stroke-border" />
          <circle
            cx="11" cy="11" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - doneCount / steps.length)}
            className={`transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none ${all ? "stroke-success" : "stroke-warning"}`}
          />
        </svg>
        <span className="hidden sm:inline">Setup</span>
        <span className="tabular text-xs text-muted-foreground">{doneCount}/{steps.length}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="region"
          aria-label="Setup status"
          className="absolute right-0 top-full z-40 mt-2 w-[380px] max-w-[calc(100vw-2rem)] origin-top-right rounded-xl border border-border bg-card p-2 shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200 motion-reduce:animate-none"
        >
          <p className="px-3 pb-1 pt-2 text-sm font-semibold">{all ? "Everything is set up" : "Finish setting up"}</p>
          <ul>
            {steps.map(({ id, Icon, title, desc, done, doneText }, i) => (
              <li
                key={id}
                style={{ animationDelay: `${60 + i * 70}ms` }}
                className="flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-muted/60 animate-in fade-in-0 slide-in-from-top-1 fill-mode-both duration-300 motion-reduce:animate-none"
              >
                <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {done ? (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-success text-white animate-in zoom-in-50 duration-300 motion-reduce:animate-none">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                  ) : (
                    <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning/60 motion-reduce:animate-none" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning" />
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {title}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${done ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                      {done ? doneText : "Not set up"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
                </div>
                {id === "business" && (
                  <button type="button" className={done ? ghost : action} onClick={() => { setOpen(false); setEditing(true) }}>
                    {done ? "Edit" : "Add"}
                  </button>
                )}
                {id === "notion" && !done && (
                  <button type="button" className={action} disabled={notionBusy} onClick={connectNotion}>
                    {notionBusy && <Loader2 className="h-3 w-3 animate-spin" />} Connect
                  </button>
                )}
                {id === "near" && !done && (
                  <Link href="/auth/login?step=near" className={action} onClick={() => setOpen(false)}>Set up</Link>
                )}
              </li>
            ))}
          </ul>
          {err && <p role="alert" className="px-3 pb-2 pt-1 text-xs text-destructive">{err}</p>}
        </div>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Business details</DialogTitle>
            <DialogDescription>Printed as the seller on new invoices and invoice emails. Invoices already sent keep the details they were issued with.</DialogDescription>
          </DialogHeader>
          <BusinessForm onSaved={() => setTimeout(() => setEditing(false), 700)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
