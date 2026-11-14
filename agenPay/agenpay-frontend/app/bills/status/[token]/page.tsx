"use client"

// Contractor's private status page for one submitted bill: status and, once paid, the NEAR transaction.
import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { authService } from "@/lib/auth"
import { StatusPill } from "@/components/app/status"
import { ExternalLink, Loader2 } from "lucide-react"

interface BillStatus {
  company: string; invoiceNumber: string; amountFormatted: string; description: string | null; dueDate: string | null
  submittedAt: string; status: string; paidAt: string | null; txUrl: string | null; note: string | null; network?: string
}

const EXPLAIN: Record<string, string> = {
  in_review: "Received. The company has not paid it yet.",
  paying: "The company approved payment; it is being sent on NEAR.",
  unknown: "Payment was sent and is being confirmed on NEAR. It will not be sent twice.",
  paid: "Paid. The transfer is confirmed on NEAR.",
  failed: "The payment was refused by the company's vault rules. The company can retry.",
  rejected: "The company declined this bill.",
}

export default function BillStatusPage() {
  const { token } = useParams<{ token: string }>()
  const [s, setS] = useState<BillStatus | null>(null)
  const [err, setErr] = useState(false)
  const load = useCallback(() => authService.api<BillStatus>(`/api/public/bills/${token}`).then(setS).catch(() => setErr(true)), [token])

  useEffect(() => {
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, 5000)
    return () => clearInterval(t)
  }, [load])

  if (err && !s) return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><p className="text-slate-600">Bill not found.</p></main>
  if (!s) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></main>

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto grid max-w-lg gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">Bill to {s.company}</p>
            <h1 className="text-2xl font-bold">{s.invoiceNumber}</h1>
          </div>
          <StatusPill status={s.status} />
        </div>
        <p className="text-3xl font-bold tabular-nums">{Number(s.amountFormatted).toFixed(2)} <span className="text-base font-medium text-slate-500">{s.network === "testnet" ? "tUSDC (testnet test token, no value)" : "USDC"}</span></p>
        <p className="text-slate-700">{EXPLAIN[s.status] || s.status}</p>
        {s.note && <p className="rounded-lg bg-slate-100 p-3 text-sm">Note from {s.company}: {s.note}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {s.description && <><dt className="text-slate-500">Description</dt><dd>{s.description}</dd></>}
          <dt className="text-slate-500">Submitted</dt><dd>{new Date(s.submittedAt).toLocaleString()}</dd>
          {s.dueDate && <><dt className="text-slate-500">Due</dt><dd>{new Date(s.dueDate).toLocaleDateString()}</dd></>}
          {s.paidAt && <><dt className="text-slate-500">Paid</dt><dd>{new Date(s.paidAt).toLocaleString()}</dd></>}
        </dl>
        {s.txUrl && (
          <a href={s.txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline">
            View the payment on NEAR <ExternalLink className="h-4 w-4" />
          </a>
        )}
        <p className="text-xs text-slate-500">Keep this link private; anyone with it can see this bill&apos;s status.</p>
      </div>
    </main>
  )
}
