"use client"

// Supplier bill inbox (owner side): share the submission link, review flagged bills, pay through the vault.
import { useCallback, useEffect, useState } from "react"
import { authService } from "@/lib/auth"
import { StatusPill } from "@/components/app/status"
import { AlertCircle, CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw, Send, X } from "lucide-react"

interface Bill {
  id: string; invoiceNumber: string; submitterName: string; submitterEmail: string; claimedAccount: string | null
  description: string | null; amountFormatted: string; dueDate: string | null; status: string; flags: string[]
  createdAt: string; reviewNote: string | null; txUrl: string | null
  payee: { name: string; nearAccount: string } | null
  payment: { status: string; error: string | null } | null
}

const FLAG_TEXT: Record<string, string> = {
  unknown_supplier: "Sender is not a registered supplier. Add them under Suppliers (with this email) before paying.",
  payout_changed: "The payout account on the bill differs from the registered one. SKYPay will pay the REGISTERED account only; confirm the change with the supplier out of band.",
  possible_duplicate: "A similar bill (same number or amount) from this supplier arrived in the last 30 days.",
}

const btn = "press inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"

export function BillsPanel({ tokenShort, onChange }: { tokenShort: string; onChange: () => void }) {
  const [bills, setBills] = useState<Bill[]>([])
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string | null } | null>(null)
  const [ack, setAck] = useState<Record<string, boolean>>({})
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [note, setNote] = useState("")

  const load = useCallback(async () => {
    const r = await authService.api<{ bills: Bill[] }>("/api/bills")
    setBills(r.bills)
  }, [])

  useEffect(() => {
    authService.api<{ path: string }>("/api/bills/inbox-link").then((r) => setLink(`${window.location.origin}${r.path}`)).catch(() => {})
    load().catch(() => {})
    const t = setInterval(() => { if (!document.hidden) load().catch(() => {}) }, 4000)
    return () => clearInterval(t)
  }, [load])

  const act = async (id: string, label: string, fn: () => Promise<{ text: string; url?: string | null }>) => {
    setBusy(id); setMsg(null)
    try { setMsg({ ok: true, ...(await fn()) }); await load(); onChange() }
    catch (e) { setMsg({ ok: false, text: `${label}: ${e instanceof Error ? e.message : String(e)}` }) }
    finally { setBusy(null) }
  }

  const open = bills.filter((b) => ["needs_review", "flagged", "failed"].includes(b.status))

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-lg bg-muted p-4">
        <p className="font-medium">Your bill inbox link</p>
        <p className="text-sm text-muted-foreground">Send this to contractors. They submit bills with their invoice number and amount; nothing is paid until you click Pay here, and money only ever goes to the NEAR account you registered for that supplier.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input readOnly value={link} aria-label="Bill inbox link" className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 font-mono text-xs" />
          <button type="button" className={`${btn} border border-border bg-card`} disabled={!link} onClick={() => { navigator.clipboard?.writeText(link); setMsg({ ok: true, text: "Inbox link copied" }) }}><Copy className="h-4 w-4" /> Copy</button>
          <button type="button" className={`${btn} border border-border bg-card`} disabled={!!busy} title="The old link stops accepting bills. Status links already sent keep working." onClick={() => {
            if (!confirmRotate) { setConfirmRotate(true); return }
            setConfirmRotate(false)
            act("rotate", "New link", async () => {
              const r = await authService.api<{ path: string }>("/api/bills/inbox-link/rotate", { method: "POST" })
              setLink(`${window.location.origin}${r.path}`)
              return { text: "New inbox link created; the old one no longer works." }
            })
          }}><RefreshCw className="h-4 w-4" /> {confirmRotate ? "Click again: old link stops working" : "New link"}</button>
        </div>
      </div>

      <div aria-live="polite">
        {msg && (
          <div role={msg.ok ? "status" : "alert"} className={`flex items-start gap-3 rounded-lg border px-4 py-2.5 text-sm ${msg.ok ? "border-success/30 bg-success/5 text-success" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
            {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <p className="min-w-0 flex-1 break-words">{msg.text} {msg.url && <a className="ml-1 font-medium underline" href={msg.url} target="_blank" rel="noreferrer">View transaction</a>}</p>
            <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss message" className="rounded-md p-0.5 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{open.length} waiting for review · {bills.length} total</p>

      {bills.length === 0 ? (
        <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No bills yet. Open the inbox link in a private window to submit a test bill as a contractor.</p>
      ) : (
        <ul className="grid gap-3">
          {bills.map((b) => {
            const flags = Array.isArray(b.flags) ? b.flags : []
            const payable = ["needs_review", "flagged", "failed"].includes(b.status)
            return (
              <li key={b.id} className="grid gap-2 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{b.invoiceNumber} · <span className="tabular">{Number(b.amountFormatted).toFixed(2)} {tokenShort}</span></p>
                    <p className="text-sm text-muted-foreground">{b.submitterName} · {b.submitterEmail}{b.dueDate && ` · due ${new Date(b.dueDate).toLocaleDateString()}`}</p>
                    {b.description && <p className="text-sm">{b.description}</p>}
                    <p className="text-sm text-muted-foreground">
                      Pays: {b.payee ? <><span className="font-medium text-foreground">{b.payee.name}</span> <span className="font-mono text-xs">{b.payee.nearAccount}</span> (registered)</> : <span className="text-destructive">no registered supplier</span>}
                      {b.claimedAccount && b.payee && b.claimedAccount !== b.payee.nearAccount && <> · bill says <span className="font-mono text-xs line-through">{b.claimedAccount}</span></>}
                    </p>
                  </div>
                  <span className="flex items-center gap-2"><StatusPill status={b.status} />{b.txUrl && <a href={b.txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-sm font-semibold text-primary hover:underline">Transaction <ExternalLink className="h-3 w-3" /></a>}</span>
                </div>
                {flags.length > 0 && payable && (
                  <ul className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {flags.map((f) => <li key={f} className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{FLAG_TEXT[f] || f}</li>)}
                  </ul>
                )}
                {b.status === "failed" && b.payment?.error && <p className="text-sm text-destructive">Refused by vault: {b.payment.error.replace(/^.*Contract panicked: /, "")}. Fix the cause (limits, balance, approval) and pay again.</p>}
                {b.status === "unknown" && <p className="text-sm text-muted-foreground">Outcome not confirmed yet. SKYPay re-reads the vault every 30 seconds and never sends it twice.</p>}
                {b.status === "rejected" && b.reviewNote && <p className="text-sm text-muted-foreground">Rejected: {b.reviewNote}</p>}
                {payable && (
                  <div className="flex flex-wrap items-center gap-3">
                    {flags.filter((f) => f !== "unknown_supplier").length > 0 && (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!ack[b.id]} onChange={(e) => setAck({ ...ack, [b.id]: e.target.checked })} />
                        I reviewed the warnings above
                      </label>
                    )}
                    <button type="button" className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={!!busy} onClick={() => act(b.id, "Pay bill", async () => {
                      const r = await authService.api<{ bill: Bill; txUrl: string | null; alreadyDispatched: boolean }>(`/api/bills/${b.id}/pay`, { method: "POST", body: JSON.stringify({ acknowledgeFlags: !!ack[b.id] }) })
                      return { text: r.alreadyDispatched ? `${b.invoiceNumber} was already sent (${r.bill.status}); not sent again.` : `${b.invoiceNumber}: ${r.bill.status}`, url: r.txUrl }
                    })}>{busy === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Pay from vault</button>
                    {rejecting === b.id ? (
                      <>
                        <input aria-label={`Reason for rejecting ${b.invoiceNumber}`} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (shown to the contractor)" className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm" />
                        <button type="button" className={`${btn} border border-destructive/40 text-destructive`} disabled={!!busy} onClick={() => {
                          act(b.id, "Reject", async () => { await authService.api(`/api/bills/${b.id}/reject`, { method: "POST", body: JSON.stringify({ note }) }); setRejecting(null); setNote(""); return { text: `${b.invoiceNumber} rejected` } })
                        }}>Confirm reject</button>
                        <button type="button" className={`${btn} border border-border`} onClick={() => { setRejecting(null); setNote("") }}>Cancel</button>
                      </>
                    ) : (
                      <button type="button" className={`${btn} border border-border`} disabled={!!busy} onClick={() => setRejecting(b.id)}>Reject</button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
