"use client"

// Public contractor form: submit a bill to one company. No login. The company decides whether and where to pay;
// the payout account typed here is only compared with the company's records, never used directly.
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { authService } from "@/lib/auth"
import { AlertCircle, Loader2, Send } from "lucide-react"

const input = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus-visible:border-slate-500 focus-visible:ring-2 focus-visible:ring-slate-200"

export default function SubmitBillPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const [company, setCompany] = useState<{ company: string; network: string } | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [f, setF] = useState({ name: "", email: "", invoiceNumber: "", description: "", amount: "", dueDate: "", payoutAccount: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    authService.api<{ company: string; network: string }>(`/api/public/bill-inbox/${token}`).then(setCompany).catch(() => setNotFound(true))
  }, [token])

  const valid = f.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) && f.invoiceNumber.trim() && /^\d+(\.\d{1,6})?$/.test(f.amount) && Number(f.amount) > 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError("")
    try {
      const r = await authService.api<{ statusPath: string }>(`/api/public/bill-inbox/${token}`, { method: "POST", body: JSON.stringify(f) })
      router.push(r.statusPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the bill")
      setBusy(false)
    }
  }

  const field = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className="grid gap-1">
      <label htmlFor={k} className="text-sm font-semibold">{label}</label>
      <input id={k} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={input} {...props} />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  )

  if (notFound) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><p className="text-slate-600">This bill inbox link is not valid. Ask the company for a current link.</p></main>
  }
  if (!company) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></main>
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <form onSubmit={submit} className="mx-auto grid max-w-lg gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm text-slate-500">Bill inbox</p>
          <h1 className="text-2xl font-bold">Send a bill to {company.company}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {company.company} reviews every bill before paying. Payment is sent on NEAR {company.network} to the account they have on file for you
            {company.network === "testnet" && " (testnet tUSDC, a test token with no monetary value)"}.
          </p>
        </div>
        {field("name", "Your name or business")}
        {field("email", "Email", { type: "email", autoComplete: "email" }, "Use the email the company knows you by; that is how your bill is matched.")}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("invoiceNumber", "Invoice number", { placeholder: "e.g. 2026-041" })}
          {field("amount", company.network === "testnet" ? "Amount (tUSDC)" : "Amount (USDC)",{ inputMode: "decimal", placeholder: "250.00" })}
        </div>
        {field("description", "Description", { placeholder: "Design work, November" })}
        {field("dueDate", "Due date (optional)", { type: "date" })}
        {field("payoutAccount", "Your NEAR account (optional)", { placeholder: "you.testnet", spellCheck: false, className: `${input} font-mono` },
          "Only checked against the company's records. If it differs, the company is warned and still pays the account they registered for you.")}
        {error && <p role="alert" className="flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        <button type="submit" disabled={!valid || busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit bill
        </button>
        <p className="text-xs text-slate-500">After submitting you get a private status link. Bookmark it to see when the bill is paid.</p>
      </form>
    </main>
  )
}
