"use client"

// The company's staff: who they are, what they earn per payroll run, and running payroll from the vault.
// Adding someone = owner-key approval on the vault (same as suppliers); paying = one payroll run, paid once per name.
import { useState } from "react"
import { CheckCircle2, ExternalLink, Loader2, Plus, Trash2, Upload, X } from "lucide-react"
import { authService } from "@/lib/auth"
import { fromBaseUnits, ownerAction } from "@/lib/near"
import { sumAmounts } from "@/lib/payroll-core"
import { StatusPill } from "@/components/app/status"
import { PayrollPicker, PayrollPreview } from "@/components/app/payroll-import"

export interface Employee {
  id: string; name: string; email: string | null; notes: string | null; nearAccount: string; allowListedOnChain: boolean
  kind: string; role: string | null; salary: string | null
}
interface Paid { id: string; recipient: string; amountFormatted: string; status: string; error: string | null; url: string | null }

const isAmount = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.trim()) && Number(v) > 0
const input = "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
const btn = "press inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold disabled:opacity-50"
const primary = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`
const secondary = `${btn} border border-border bg-card font-semibold hover:bg-muted`
const pay = (e: Employee) => (e.salary ? fromBaseUnits(e.salary) : "")
const thisMonth = () => `Payroll ${new Date().toISOString().slice(0, 7)}`

export function EmployeesPanel({ employees, userId, company, vault, vaultAvailable, hasKey, reload }: {
  employees: Employee[]; userId: string; company: string; vault: string; vaultAvailable?: string; hasKey: boolean; reload: () => Promise<void>
}) {
  const [view, setView] = useState<"team" | "payroll" | "import">("team")
  const [busy, setBusy] = useState("")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [add, setAdd] = useState({ name: "", role: "", nearAccount: "", email: "", salary: "" })
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: "", role: "", email: "", salary: "", notes: "" })
  const [file, setFile] = useState<File | null>(null)
  // payroll run: who is included and how much (prefilled from monthly pay, editable for this run only)
  const [runName, setRunName] = useState(thisMonth())
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [skip, setSkip] = useState<Record<string, boolean>>({})
  const [checked, setChecked] = useState(false)
  const [result, setResult] = useState<{ status: string; payments: Paid[] } | null>(null)

  const act = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label); setMsg(null)
    try { const t = await fn(); setMsg({ ok: true, text: t || `${label}: done` }); await reload() }
    catch (e) { setMsg({ ok: false, text: `${label}: ${e instanceof Error ? e.message : String(e)}` }) }
    finally { setBusy("") }
  }

  const approve = (acct: string) => ownerAction({ userId, company, receiverId: vault, method: "add_payee", args: { payee: acct }, label: "Approve employee" })

  const amountOf = (e: Employee) => amounts[e.id] ?? pay(e)
  const inRun = employees.filter((e) => !skip[e.id])
  const runReady = inRun.length > 0 && inRun.every((e) => isAmount(amountOf(e)) && e.allowListedOnChain)
  const total = sumAmounts(inRun.filter((e) => isAmount(amountOf(e))).map(amountOf))
  const avail = vaultAvailable ? fromBaseUnits(vaultAvailable) : "0"
  const short = Number(total) > Number(avail)

  const tabs = (["team", "payroll", "import"] as const)
  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label="Employees view" className="inline-flex w-fit rounded-lg border border-border bg-muted p-1">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={view === t} onClick={() => { setView(t); setMsg(null) }}
            className={`press rounded-md px-4 py-1.5 text-sm font-semibold ${view === t ? "bg-card shadow-sm" : "text-muted-foreground"}`}>
            {{ team: `Team (${employees.length})`, payroll: "Run payroll", import: "Import Excel" }[t]}
          </button>
        ))}
      </div>

      {view === "team" && (
        <>
          {employees.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {employees.map((e) => (
                <li key={e.id} className="grid gap-3 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{e.name}{e.role && <span className="ml-2 text-sm font-normal text-muted-foreground">{e.role}</span>}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{e.nearAccount}{e.email && <span className="ml-2 font-sans">{e.email}</span>}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <span className="tabular text-sm font-semibold">{e.salary ? `${Number(pay(e)).toFixed(2)} / month` : <span className="font-normal text-muted-foreground">No pay set</span>}</span>
                      {e.allowListedOnChain ? <span className="text-xs font-medium text-success">Approved</span>
                        : <button type="button" className={`${secondary} h-8 px-3 text-xs`} disabled={!!busy || !hasKey} onClick={() => act("Approve on vault", async () => { await approve(e.nearAccount) })}>Approve on vault</button>}
                      <button type="button" className={`${secondary} h-8 px-3 text-xs`} onClick={() => { setEditId(editId === e.id ? null : e.id); setEdit({ name: e.name, role: e.role || "", email: e.email || "", salary: pay(e), notes: e.notes || "" }) }}>Edit</button>
                      <button type="button" aria-label={`Remove ${e.name}`} className={`${secondary} h-8 px-2.5 text-xs`} disabled={!!busy || (e.allowListedOnChain && !hasKey)} title={e.allowListedOnChain && !hasKey ? "Needs the owner key to revoke the vault approval" : undefined} onClick={() => {
                        if (confirm(`Remove ${e.name} from the team?${e.allowListedOnChain ? " This also revokes their approval on the vault." : ""}`)) act("Remove employee", async () => {
                          if (e.allowListedOnChain) await ownerAction({ userId, company, receiverId: vault, method: "remove_payee", args: { payee: e.nearAccount }, label: "Revoke employee" })
                          await authService.api(`/api/payees/${e.id}`, { method: "DELETE" })
                        })
                      }}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  {editId === e.id && (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_0.7fr_auto] lg:items-end">
                      <input aria-label="Name" placeholder="Name" value={edit.name} onChange={(x) => setEdit({ ...edit, name: x.target.value })} className={input} />
                      <input aria-label="Role" placeholder="Role" value={edit.role} onChange={(x) => setEdit({ ...edit, role: x.target.value })} className={input} />
                      <input aria-label="Email" placeholder="Email" type="email" value={edit.email} onChange={(x) => setEdit({ ...edit, email: x.target.value })} className={input} />
                      <input aria-label="Monthly pay" placeholder="Monthly pay" inputMode="decimal" value={edit.salary} onChange={(x) => setEdit({ ...edit, salary: x.target.value })} className={`${input} tabular`} />
                      <button type="button" className={primary} disabled={!!busy || !edit.name.trim() || (!!edit.salary && !isAmount(edit.salary))} onClick={() => act("Save employee", async () => {
                        await authService.api(`/api/payees/${e.id}`, { method: "PATCH", body: JSON.stringify({ ...edit, kind: "employee" }) })
                        setEditId(null)
                      })}>Save</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No employees yet. Add your team below, or import them from an Excel sheet.</p>
          )}

          <div className="grid gap-2 rounded-lg border border-border p-4">
            <p className="text-sm font-semibold">Add an employee</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_0.9fr_1.2fr_1fr_0.7fr_auto] lg:items-end">
              <input aria-label="Name" placeholder="Name" value={add.name} onChange={(x) => setAdd({ ...add, name: x.target.value })} className={input} />
              <input aria-label="Role" placeholder="Role (e.g. Designer)" value={add.role} onChange={(x) => setAdd({ ...add, role: x.target.value })} className={input} />
              <input aria-label="NEAR account" placeholder="their-account.testnet" spellCheck={false} value={add.nearAccount} onChange={(x) => setAdd({ ...add, nearAccount: x.target.value })} className={`${input} font-mono`} />
              <input aria-label="Email" placeholder="Email (optional)" type="email" value={add.email} onChange={(x) => setAdd({ ...add, email: x.target.value })} className={input} />
              <input aria-label="Monthly pay" placeholder="Monthly pay" inputMode="decimal" value={add.salary} onChange={(x) => setAdd({ ...add, salary: x.target.value })} className={`${input} tabular`} />
              <button type="button" className={primary} disabled={!!busy || !add.name.trim() || !add.nearAccount.trim() || !isAmount(add.salary) || !hasKey} onClick={() => act("Add employee", async () => {
                await authService.api("/api/payees", { method: "POST", body: JSON.stringify({ ...add, email: add.email || undefined, kind: "employee" }) })
                await approve(add.nearAccount.trim().toLowerCase())
                setAdd({ name: "", role: "", nearAccount: "", email: "", salary: "" })
                return `${add.name} added and approved on the vault`
              })}>{busy === "Add employee" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add</button>
            </div>
            <p className="text-xs text-muted-foreground">Adding signs an approval on your vault with your own key, so the agent can pay this account and no other.{!hasKey && " Your owner key is not in this browser: import your backup in Vault first."}</p>
          </div>
        </>
      )}

      {view === "payroll" && (
        employees.length === 0 ? <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Add employees first.</p> : result ? (
          <div className="grid gap-3">
            <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-success" /> {runName}: {result.payments.filter((p) => p.status === "settled").length} of {result.payments.length} paid ({result.status}). Logged in Notion under Payouts.</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {result.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>{employees.find((e) => e.nearAccount === p.recipient)?.name || p.recipient}</span>
                  <span className="flex items-center gap-3"><span className="tabular">{Number(p.amountFormatted).toFixed(2)}</span><StatusPill status={p.status} />
                    {p.error ? <span className="text-xs text-destructive">{p.error.replace(/^.*Contract panicked: /, "")}</span> : p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary">tx <ExternalLink className="h-3 w-3" /></a>}</span>
                </li>
              ))}
            </ul>
            <button type="button" className={`${secondary} w-fit`} onClick={() => { setResult(null); setChecked(false); setRunName(thisMonth()) }}>New run</button>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-semibold">Run name
              <input value={runName} onChange={(x) => setRunName(x.target.value)} className={input} />
              <span className="text-xs font-normal text-muted-foreground">A run name can be paid only once, so a double click or a repeated request never pays people twice.</span>
            </label>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Pay</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2 text-right">Amount this run</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {employees.map((e) => (
                    <tr key={e.id} className={skip[e.id] ? "opacity-50" : ""}>
                      <td className="px-3 py-2"><input type="checkbox" aria-label={`Include ${e.name}`} checked={!skip[e.id]} onChange={(x) => setSkip({ ...skip, [e.id]: !x.target.checked })} /></td>
                      <td className="px-3 py-2"><p className="font-medium">{e.name}{e.role && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{e.role}</span>}</p>
                        {!e.allowListedOnChain && <p className="text-xs text-warning">Not approved on vault yet (Team tab)</p>}</td>
                      <td className="px-3 py-2 text-right"><input aria-label={`Amount for ${e.name}`} inputMode="decimal" value={amountOf(e)} placeholder="0" onChange={(x) => setAmounts({ ...amounts, [e.id]: x.target.value })} className={`${input} ml-auto w-28 text-right tabular`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`tabular text-sm font-semibold ${short ? "text-destructive" : ""}`}>{inRun.length} people · total {total} of {avail} available in the vault{short && ". Fund the vault first."}</p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(x) => setChecked(x.target.checked)} className="mt-1" />
              <span>I checked the people and amounts. Payments on NEAR cannot be reversed.</span></label>
            <button type="button" className={`${primary} w-fit`} disabled={!checked || !runReady || short || !!busy || !runName.trim()} onClick={() => act("Run payroll", async () => {
              const r = await authService.api<{ batch: { status: string }; payments: Paid[] }>("/api/vault/payout-batches", {
                method: "POST", body: JSON.stringify({ kind: "payroll", label: runName, items: inRun.map((e) => ({ payeeId: e.id, amount: amountOf(e), memo: runName })) }),
              })
              setResult({ status: r.batch.status, payments: r.payments })
              return `${runName}: ${r.batch.status}`
            })}>{busy === "Run payroll" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Pay {inRun.length} employees · {total}</button>
            {busy === "Run payroll" && <p className="text-sm text-muted-foreground">Paying one by one. Keep this page open.</p>}
          </div>
        )
      )}

      {view === "import" && (file
        ? <PayrollPreview key={file.name + file.lastModified} kind="employee" file={file} onCancel={() => setFile(null)} onDone={() => { reload().catch(() => {}) }} />
        : <div className="grid gap-2"><PayrollPicker onFile={setFile} /><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Upload className="h-3.5 w-3.5" /> New people in the sheet are added to the team with the sheet amount as their monthly pay, after you approve them.</p></div>)}

      {msg && <p role={msg.ok ? "status" : "alert"} className={`flex items-center gap-2 text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <X className="h-4 w-4" />}{msg.text}</p>}
    </div>
  )
}
