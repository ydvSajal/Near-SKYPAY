"use client"

// Payroll from a spreadsheet: read in the browser -> owner checks the preview -> owner approves new payees
// with their own key -> agent pays the batch from the vault. The file is never uploaded or stored.
import { useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, Download, ExternalLink, FileSpreadsheet, Loader2, ShieldCheck, Upload } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { fromBaseUnits, getStoredOwnerKey, ownerAction, toBaseUnits } from "@/lib/near"
import { parseCsv, sumAmounts, toPayrollRows, TEMPLATE_CSV, type PayrollRow } from "@/lib/payroll-core"
import { StatusPill } from "@/components/app/status"

interface Payee { id: string; name: string; nearAccount: string; allowListedOnChain: boolean }
interface Status {
  company: string | null; vault: string | null; vaultAvailable?: string
  agentPolicy?: { per_tx_limit: string; daily_limit: string; spent_today: string; revoked: boolean; expires_at_ms: number } | null
}
interface Paid { id: string; recipient: string; amountFormatted: string; status: string; error: string | null; url: string | null }
export interface PayrollResult { label: string; status: string; settled: number; total: number; amount: string }

/** Read .xlsx / .csv into validated rows. */
export async function readPayrollFile(file: File): Promise<PayrollRow[]> {
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser")
    return toPayrollRows(await readSheet(file))
  }
  if (/\.(csv|tsv|txt)$/i.test(file.name)) return toPayrollRows(parseCsv(await file.text()))
  throw new Error("Use an .xlsx or .csv file. Older .xls files: save as .xlsx first.")
}

export function downloadTemplate() {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }))
  a.download = "skypay-payroll-template.csv"
  a.click()
  URL.revokeObjectURL(a.href)
}

const btn = "press inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold disabled:opacity-50"
const primary = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`
const secondary = `${btn} border border-border bg-card font-semibold hover:bg-muted`
const big = (v: string) => BigInt(toBaseUnits(v))

/** Drop zone + file picker. Calls onFile; the parent renders <PayrollPreview>. */
export function PayrollPicker({ onFile, compact = false }: { onFile: (f: File) => void; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      className={`grid place-items-center gap-2 rounded-lg border-2 border-dashed px-4 text-center transition-colors ${compact ? "py-4" : "py-8"} ${over ? "border-primary bg-primary/5" : "border-border"}`}
    >
      <FileSpreadsheet className="h-6 w-6 text-primary" />
      <p className="text-sm font-semibold">Drop an Excel or CSV file here</p>
      <p className="max-w-md text-sm text-muted-foreground">Columns: Name, Role, NEAR account, Email, Amount, Memo. Up to 25 people. The file stays in your browser.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={primary} onClick={() => ref.current?.click()}><Upload className="h-4 w-4" /> Choose file</button>
        <button type="button" className={secondary} onClick={downloadTemplate}><Download className="h-4 w-4" /> Template</button>
      </div>
      <input ref={ref} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "" }} />
    </div>
  )
}

/** Preview, checks, and the two owner-confirmed steps. */
export function PayrollPreview({ file, onDone, onCancel, kind = "employee" }: { file: File; onDone?: (r: PayrollResult) => void; onCancel?: () => void; kind?: "employee" | "supplier" }) {
  const staff = kind === "employee"
  const { user } = useAuth()
  const [rows, setRows] = useState<PayrollRow[] | null>(null)
  const [readErr, setReadErr] = useState("")
  const [payees, setPayees] = useState<Payee[]>([])
  const [st, setSt] = useState<Status | null>(null)
  const [label, setLabel] = useState(staff ? `Payroll ${new Date().toISOString().slice(0, 7)}` : file.name.replace(/\.[^.]+$/, ""))
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState("")
  const [err, setErr] = useState("")
  const [paid, setPaid] = useState<{ status: string; payments: Paid[] } | null>(null)

  const refresh = async () => {
    const [p, s] = await Promise.all([
      authService.api<{ payees: Payee[] }>("/api/payees"),
      authService.api<Status>("/api/near/status"),
    ])
    setPayees(p.payees); setSt(s)
    return p.payees
  }

  useEffect(() => {
    readPayrollFile(file).then(setRows).catch((e) => setReadErr(e instanceof Error ? e.message : String(e)))
    refresh().catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [file])

  if (readErr) return (
    <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">Could not read {file.name}</p><p>{readErr}</p>
      {onCancel && <button type="button" onClick={onCancel} className="mt-1 underline">Try another file</button>}</div>
    </div>
  )
  if (!rows || !st) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading {file.name}</p>

  const byAcct = new Map(payees.map((p) => [p.nearAccount, p]))
  const valid = rows.filter((r) => !r.errors.length)
  const invalid = rows.length - valid.length
  const needsApproval = valid.filter((r) => !byAcct.get(r.nearAccount)?.allowListedOnChain)
  const total = sumAmounts(valid.map((r) => r.amount))
  const pol = st.agentPolicy
  const avail = BigInt(st.vaultAvailable || "0")
  const overTx = pol ? valid.filter((r) => big(r.amount) > BigInt(pol.per_tx_limit)) : []
  const dailyLeft = pol ? BigInt(pol.daily_limit) - BigInt(pol.spent_today || "0") : BigInt(0)
  const blockers = [
    !st.vault && "Set up the company NEAR account first.",
    invalid > 0 && `${invalid} row${invalid > 1 ? "s have" : " has"} errors. Fix the file and load it again.`,
    big(total) > avail && `Total ${total} is more than the vault holds (${fromBaseUnits(st.vaultAvailable)}). Fund the vault in Finance > Vault.`,
    !pol && "The agent has no spending limits yet. Set them in Finance > Vault.",
    pol?.revoked && "The agent is revoked. Renew it in Finance > Vault.",
    overTx.length > 0 && `${overTx.length} payment${overTx.length > 1 ? "s are" : " is"} above the per-payment limit (${fromBaseUnits(pol!.per_tx_limit)}). Raise it in Finance > Vault.`,
  ].filter(Boolean) as string[]
  const dailyWarn = pol && big(total) > dailyLeft ? `Total is above what the agent may still spend today (${fromBaseUnits(dailyLeft.toString())}); the vault will refuse payments past that. Raise the daily limit first.` : ""
  const hasKey = !!(user && getStoredOwnerKey(user.id))

  const approve = async () => {
    setBusy("approve"); setErr("")
    try {
      for (const [i, r] of needsApproval.entries()) {
        setBusy(`Approving ${i + 1} of ${needsApproval.length}: ${r.nearAccount}`)
        if (!byAcct.has(r.nearAccount)) {
          await authService.api("/api/payees", {
            method: "POST",
            body: JSON.stringify({
              name: r.name, nearAccount: r.nearAccount, email: r.email || undefined, kind,
              ...(staff ? { role: r.role || undefined, salary: r.amount } : {}), // sheet amount becomes their monthly pay
            }),
          })
        }
        await ownerAction({ userId: user!.id, company: st.company!, receiverId: st.vault!, method: "add_payee", args: { payee: r.nearAccount }, label: "Allow-list payee (payroll import)" })
      }
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      await refresh().catch(() => {})
    } finally { setBusy("") }
  }

  const pay = async () => {
    setBusy("Paying"); setErr("")
    try {
      const list = await refresh()
      const ids = new Map(list.map((p) => [p.nearAccount, p.id]))
      const r = await authService.api<{ batch: { status: string; label: string }; payments: Paid[] }>("/api/vault/payout-batches", {
        method: "POST",
        body: JSON.stringify({ label, source: file.name, kind: staff ? "payroll" : undefined, items: valid.map((x) => ({ payeeId: ids.get(x.nearAccount), amount: x.amount, memo: x.memo || undefined })) }),
      })
      setPaid({ status: r.batch.status, payments: r.payments })
      const settled = r.payments.filter((p) => p.status === "settled")
      onDone?.({ label: r.batch.label, status: r.batch.status, settled: settled.length, total: r.payments.length, amount: sumAmounts(settled.map((p) => p.amountFormatted)) })
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy("") }
  }

  const result = paid ? new Map(paid.payments.map((p) => [p.recipient, p])) : null

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm"><span className="font-semibold">{file.name}</span>: {rows.length} rows, {valid.length} ready, total <span className="tabular font-semibold">{total}</span> USDC</p>
        {!paid && onCancel && <button type="button" onClick={onCancel} className="text-sm text-muted-foreground underline-offset-2 hover:underline">Use another file</button>}
      </div>

      <div className="max-h-80 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Name / account</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Memo</th><th className="px-3 py-2">Check</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const p = byAcct.get(r.nearAccount)
              const res = result?.get(r.nearAccount)
              return (
                <tr key={r.line} className={r.errors.length ? "bg-destructive/5" : ""}>
                  <td className="px-3 py-2 tabular text-muted-foreground">{r.line}</td>
                  <td className="px-3 py-2"><p className="font-medium">{r.name}{r.role && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{r.role}</span>}</p><p className="break-all font-mono text-xs text-muted-foreground">{r.nearAccount || "—"}</p>{r.email && <p className="text-xs text-muted-foreground">{r.email}</p>}</td>
                  <td className="px-3 py-2 text-right tabular font-medium">{r.amount}</td>
                  <td className="max-w-[160px] px-3 py-2 text-muted-foreground">{r.memo}</td>
                  <td className="px-3 py-2">
                    {res ? (
                      <span className="flex flex-wrap items-center gap-2"><StatusPill status={res.status} />
                        {res.error ? <span className="text-xs text-destructive">{res.error.replace(/^.*Contract panicked: /, "")}</span>
                          : res.url && <a href={res.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary">tx <ExternalLink className="h-3 w-3" /></a>}
                      </span>
                    ) : r.errors.length ? <span className="text-xs text-destructive">{r.errors.join("; ")}</span>
                      : p?.allowListedOnChain ? <span className="text-xs font-medium text-success">{staff ? "Approved employee" : "Approved payee"}</span>
                      : <span className="text-xs font-medium text-warning">{p ? "Not approved on vault" : "New: needs your approval"}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {paid ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-success" /> Run {paid.status}: {paid.payments.filter((p) => p.status === "settled").length} of {paid.payments.length} paid. Logged in Notion under Payouts{staff ? " (Employees, Payout runs)" : ""}.
        </p>
      ) : (
        <>
          {blockers.map((b) => <p key={b} role="alert" className="flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{b}</p>)}
          {dailyWarn && <p className="flex gap-2 text-sm text-warning"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{dailyWarn}</p>}
          {!blockers.length && (
            <>
              <label className="grid gap-1 text-sm font-semibold">Run name
                <input value={label} onChange={(e) => setLabel(e.target.value)} className="h-10 rounded-lg border border-input bg-card px-3 font-medium" />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1" />
                <span>I checked every account and amount above against my records. Payments on NEAR cannot be reversed.</span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {needsApproval.length > 0 && (
                  <button type="button" className={primary} disabled={!checked || !!busy || !hasKey} onClick={approve}>
                    {busy.startsWith("Approv") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} 1. Approve {needsApproval.length} new payee{needsApproval.length > 1 ? "s" : ""}
                  </button>
                )}
                <button type="button" className={primary} disabled={!checked || !!busy || needsApproval.length > 0} onClick={pay}>
                  {busy === "Paying" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {needsApproval.length > 0 ? "2. " : ""}Pay {valid.length} people · {total} USDC
                </button>
              </div>
              {needsApproval.length > 0 && !hasKey && <p className="text-sm text-destructive">Approving needs your owner key in this browser. Import your backup in Finance first.</p>}
              {busy && busy !== "Paying" && <p className="text-sm text-muted-foreground">{busy}</p>}
              {busy === "Paying" && <p className="text-sm text-muted-foreground">Paying one by one. This takes a few seconds per person; keep this page open.</p>}
            </>
          )}
        </>
      )}
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    </div>
  )
}
