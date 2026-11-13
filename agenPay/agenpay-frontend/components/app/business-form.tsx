"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"

const input = "h-11 w-full rounded-lg border border-input bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"

const FIELDS = [
  { k: "companyName", label: "Business name", hint: "The seller name printed on every invoice and email.", required: true, autoComplete: "organization" },
  { k: "companyAddress", label: "Business address", hint: "Street, city, postcode. Printed under the business name.", autoComplete: "street-address" },
  { k: "country", label: "Country", autoComplete: "country-name" },
  { k: "taxId", label: "Tax or registration number", hint: "VAT, GST, EIN or company number, if your clients need it on invoices." },
  { k: "invoiceNotes", label: "Payment terms or invoice note", hint: "Shown at the bottom of every invoice, e.g. \"Payment due within 14 days.\"" },
] as const

type Key = (typeof FIELDS)[number]["k"]

/** Business details printed on invoices. Used in onboarding and in Finance > Company. */
export function BusinessForm({ submitLabel = "Save", onSaved }: { submitLabel?: string; onSaved?: () => void }) {
  const { user, refreshUser } = useAuth()
  const [v, setV] = useState<Record<Key, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.k, user?.[f.k] ?? ""])) as Record<Key, string>)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!v.companyName.trim()) return setMsg({ ok: false, text: "Enter your business name." })
    setBusy(true)
    setMsg(null)
    try {
      await authService.api("/api/profile", { method: "PATCH", body: JSON.stringify(v) })
      await refreshUser()
      setMsg({ ok: true, text: "Saved. New invoices will use these details." })
      onSaved?.()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} noValidate className="grid gap-4">
      {FIELDS.map((f) => (
        <div key={f.k} className="grid gap-1">
          <label htmlFor={`biz-${f.k}`} className="text-sm font-medium">
            {f.label} {!("required" in f) && <span className="font-normal text-muted-foreground">(optional)</span>}
          </label>
          <input
            id={`biz-${f.k}`} value={v[f.k]} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} className={input}
            autoComplete={"autoComplete" in f ? f.autoComplete : "off"} aria-describedby={"hint" in f ? `biz-${f.k}-hint` : undefined}
          />
          {"hint" in f && <p id={`biz-${f.k}-hint`} className="text-sm text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>}
      <button type="submit" disabled={busy} className="press inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {submitLabel}
      </button>
    </form>
  )
}
