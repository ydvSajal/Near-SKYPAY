"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { ensureOwnerKey, getStoredOwnerKey, importOwnerKey, ownerAction, toBaseUnits, fromBaseUnits, downloadOwnerKeyBackup } from "@/lib/near"
import { AppHeader } from "@/components/app/app-header"
import { StatusPill } from "@/components/app/status"
import { BusinessForm } from "@/components/app/business-form"
import { PayrollPicker, PayrollPreview } from "@/components/app/payroll-import"
import {
  AlertCircle, ArrowRight, Building2, CheckCircle2, Download, ExternalLink, FileText, KeyRound, Loader2, Plus, Send, ShieldCheck, Trash2, Users, Vault, X,
} from "lucide-react"

// ---------------------------------------------------------------- types
interface AgentPolicy { per_tx_limit: string; daily_limit: string; expires_at_ms: number; revoked: boolean; day: number; spent_today: string }
interface NearStatus {
  configured: boolean; network: string; token: string; isTestToken: boolean; tokenLabel: string; relayer: string
  company: string | null; vault: string | null; agent: string | null; ownerPublicKey: string | null
  companyBalance?: string; vaultAvailable?: string; vaultReserved?: string; agentPolicy?: AgentPolicy | null
  links?: { company: string; vault: string; agent: string }
}
interface Payee { id: string; name: string; email: string | null; notes: string | null; nearAccount: string; allowListedOnChain: boolean }
interface VaultPayment { id: string; paymentId: string; recipient: string; amountFormatted: string; status: string; error: string | null; url: string | null; createdAt: string; batchId: string | null; memo: string | null }
interface Batch { id: string; label: string; status: string; totalFormatted: string; createdAt: string; payments: VaultPayment[] }
interface Invoice {
  id: string; number: string; customerEmail: string; customerName: string | null; amountFormatted: string; status: string
  dueDate: string; createdAt: string; txUrl: string | null; settledTxHash: string | null
}

// ---------------------------------------------------------------- ui bits
const isAmount = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.trim()) && Number(v) > 0
const input = "h-11 w-full rounded-lg border border-input bg-card px-3 text-base font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
const btnPrimary = "press inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
const btnSecondary = "press inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-[15px] font-semibold hover:bg-muted disabled:opacity-50"

function F({ id, label, hint, children, className = "" }: { id: string; label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1 ${className}`}>
      <label htmlFor={id} className="text-[15px] font-semibold">{label}</label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Tx({ url }: { url: string | null }) {
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-sm font-semibold text-primary hover:underline">
      Transaction <ExternalLink className="h-3 w-3" />
    </a>
  ) : null
}

function Section({ id, icon: I, title, sub, children }: { id?: string; icon: typeof Vault; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-border bg-card">
      <div className="flex gap-3 border-b border-border px-5 py-3">
        <I className="mt-1 h-5 w-5 shrink-0 text-primary" strokeWidth={2} />
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {sub && <p className="text-[15px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
      <div className="grid gap-4 p-5">{children}</div>
    </section>
  )
}

// Ordered the way money moves: get paid, set the agent's budget, choose who can be paid, pay them.
const TABS = [
  { id: "invoices", label: "Invoices", does: "Bill clients, see who paid", icon: FileText },
  { id: "vault", label: "Vault", does: "Agent budget and limits", icon: Vault },
  { id: "payees", label: "Payees", does: "Manage your suppliers", icon: Users },
  { id: "pay", label: "Payouts", does: "Pay one or many suppliers", icon: Send },
  { id: "company", label: "Company", does: "Details on your invoices", icon: Building2 },
]

const FLOW = [
  ["1. Get paid", "Clients pay your invoices. The money lands in your receiving account, which only you control."],
  ["2. Set a budget", "You move part of it into the vault and set the agent's limits. Nothing else is at risk."],
  ["3. Pay suppliers", "Pay one payee or a whole batch from the vault. The contract refuses anything outside your limits, and every payout is logged in Notion."],
]

// ------------------------------------------------------------------ page
export default function FinancePage() {
  const { user } = useAuth()
  const [st, setSt] = useState<NearStatus | null>(null)
  const [loadError, setLoadError] = useState("")
  const [payees, setPayees] = useState<Payee[]>([])
  const [payments, setPayments] = useState<VaultPayment[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState("")

  const load = useCallback(async () => {
    const s = await authService.api<NearStatus>("/api/near/status")
    setSt(s)
    setLoadError("")
    if (s.company) {
      const [p, v, i, b] = await Promise.all([
        authService.api<{ payees: Payee[] }>("/api/payees"),
        authService.api<{ payments: VaultPayment[] }>("/api/vault/payments"),
        authService.api<{ invoices: Invoice[] }>("/api/invoices"),
        authService.api<{ batches: Batch[] }>("/api/vault/payout-batches"),
      ])
      setBatches(b.batches)
      setPayees(p.payees)
      setPayments(v.payments)
      setInvoices(i.invoices)
    }
  }, [])

  const reload = useCallback(() => {
    if (!user) return
    setHasKey(!!getStoredOwnerKey(user.id))
    load().catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load your finance data."))
  }, [user, load])

  useEffect(() => { reload() }, [reload])

  // Live updates every 2 s; a failed poll keeps the last good data.
  useEffect(() => {
    let inFlight = false
    const t = setInterval(async () => {
      if (inFlight || document.hidden) return
      inFlight = true
      try { await load() } catch {} finally { inFlight = false }
    }, 2000)
    return () => clearInterval(t)
  }, [load])

  // One section at a time, picked from the sidebar. The URL hash keeps dashboard shortcuts (/finance#pay) and reloads working.
  const [tab, setTab] = useState("invoices")
  useEffect(() => {
    const sync = () => { const h = window.location.hash.slice(1); if (TABS.some((t) => t.id === h)) setTab(h) }
    sync()
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])

  const run = async (label: string, fn: () => Promise<{ url?: string; text?: string } | void>) => {
    setBusy(label)
    setMsg(null)
    try {
      const r = await fn()
      setMsg({ ok: true, text: r?.text || `${label}: done`, url: r?.url })
      await load()
    } catch (e) {
      setMsg({ ok: false, text: `${label}: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const owner = async (label: string, receiverId: string, method: string, args: Record<string, unknown>, depositYocto?: bigint, tgas?: number) => {
    if (!user || !st?.company) throw new Error("not set up")
    const r = await ownerAction({ userId: user.id, company: st.company, receiverId, method, args, depositYocto, tgas, label })
    return { url: r.url, text: `${label}: confirmed on NEAR (gas paid by SKYPay sponsor)` }
  }

  // ------------------------------------------------------------ forms state
  const [fund, setFund] = useState("50")
  const [withdraw, setWithdraw] = useState("")
  const [perTx, setPerTx] = useState("25")
  const [daily, setDaily] = useState("40")
  const [days, setDays] = useState("30")
  const [payeeName, setPayeeName] = useState("")
  const [payeeAcct, setPayeeAcct] = useState("")
  const [payTo, setPayTo] = useState("")
  const [payAmt, setPayAmt] = useState("")
  const [payMemo, setPayMemo] = useState("")
  const [payMode, setPayMode] = useState<"single" | "batch" | "import">("single")
  const [importFile, setImportFile] = useState<File | null>(null)
  const [batchLabel, setBatchLabel] = useState("")
  const [rows, setRows] = useState([{ payeeId: "", amount: "", memo: "" }])
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: "", email: "", notes: "" })
  const [inv, setInv] = useState({ email: "", name: "", description: "", due: "" })
  const [lines, setLines] = useState([{ description: "", quantity: "1", unitPrice: "" }])

  const download = async (path: string, filename: string) => {
    const r = await fetch(`${authService.apiBaseUrl}${path}`, { headers: { Authorization: `Bearer ${authService.getToken()}` } })
    if (!r.ok) throw new Error(`export failed (${r.status})`)
    const a = document.createElement("a")
    a.href = URL.createObjectURL(await r.blob())
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ------------------------------------------------------------ states
  if (loadError && !st) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <AppHeader />
        <main className="mx-auto max-w-xl px-4 py-16">
          <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-6">
            <div className="flex gap-3 text-destructive"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><p className="font-medium">Finance could not load</p></div>
            <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
            <button type="button" className={`${btnPrimary} mt-5`} onClick={reload}>Try again</button>
          </div>
        </main>
      </div>
    )
  }

  if (!user || !st) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <AppHeader />
        <main className="mx-auto grid max-w-[1200px] gap-6 px-4 py-8 md:px-6" aria-busy="true" aria-label="Loading finance">
          <span className="skeleton h-8 w-48" />
          <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton h-24" />)}</div>
          <div className="grid gap-6 lg:grid-cols-2"><span className="skeleton h-72" /><span className="skeleton h-72" /></div>
        </main>
      </div>
    )
  }

  const u = (v?: string | null) => Number(fromBaseUnits(v || "0")).toFixed(2) // display only; exact values in CSV
  const p = st.agentPolicy
  const tokenShort = st.isTestToken ? "tUSDC" : "USDC"
  const lineTotal = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0)

  return (
    <div className="min-h-[100dvh] bg-background">
      <AppHeader>
        <span className="hidden whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground xl:inline">
          NEAR {st.network} · {st.tokenLabel}
        </span>
      </AppHeader>

      <main className="mx-auto grid max-w-[1400px] gap-4 px-4 py-4 md:px-6">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.02em]">Finance</h1>
          <p className="text-base text-muted-foreground">Bill clients, hold a spending budget for the agent, and pay approved suppliers. All amounts are {st.tokenLabel} on NEAR {st.network}.</p>
        </div>

        <div aria-live="polite">
          {msg && (
            <div role={msg.ok ? "status" : "alert"} className={`flex items-start gap-3 rounded-lg border px-4 py-2.5 text-sm ${msg.ok ? "border-success/30 bg-success/5 text-success" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
              {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <p className="min-w-0 flex-1 break-words">
                {msg.text} {msg.url && <a className="ml-1 font-medium underline" href={msg.url} target="_blank" rel="noreferrer">View transaction</a>}
              </p>
              <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss message" className="rounded-md p-0.5 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
            </div>
          )}
        </div>

        {!st.configured && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
            NEAR is not configured on this server. Run <code className="font-mono">npm run near:bootstrap</code> in agenpay-backend.
          </div>
        )}

        {!st.company ? (
          <Section icon={ShieldCheck} title="Set up your company on NEAR" sub="Free and gasless: SKYPay sponsors account creation and fees. You never buy NEAR.">
            <ol className="grid gap-4 md:grid-cols-3">
              {[
                ["Company account", "Created with a key generated in this browser. SKYPay never sees it."],
                ["Operating vault", "Only your account can fund it, change rules or withdraw."],
                ["Agent account", "Can only call pay on your vault, within the limits you set."],
              ].map(([t, d], i) => (
                <li key={t} className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground">Creates {i + 1} of 3</p>
                  <p className="mt-1 font-medium">{t}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!!busy || !st.configured}
                className={btnPrimary}
                onClick={() => run("Company setup", async () => {
                  const { publicKey } = await ensureOwnerKey(user.id)
                  setHasKey(true)
                  const r = await authService.api<{ company: string }>("/api/near/provision", { method: "POST", body: JSON.stringify({ publicKey }) })
                  return { text: `Company account ${r.company} created. Download your key backup next.` }
                })}
              >
                {busy === "Company setup" ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating accounts (about 30s)</> : "Create company NEAR account"}
              </button>
              {busy === "Company setup" && <p className="text-sm text-muted-foreground">Keep this tab open.</p>}
            </div>
          </Section>
        ) : (
          <>
            {/* How money moves through the three accounts */}
            <ol className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
              {FLOW.map(([t, d], i) => (
                <li key={t} className="flex gap-3 bg-card px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t}</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">{d}</p>
                  </div>
                  {i < 2 && <ArrowRight aria-hidden className="mt-1 hidden h-4 w-4 shrink-0 text-muted-foreground md:block" />}
                </li>
              ))}
            </ol>

            {/* Accounts + balances */}
            <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4">
              {[
                { l: "Receiving account (client payments)", v: `${u(st.companyBalance)} ${tokenShort}`, s: st.company, link: st.links?.company },
                { l: "Vault (agent can spend)", v: `${u(st.vaultAvailable)} ${tokenShort}`, s: `${u(st.vaultReserved)} reserved`, link: st.links?.vault },
                { l: "Agent spent today", v: p ? `${u(p.spent_today)} / ${u(p.daily_limit)}` : "No policy", s: p ? (p.revoked ? "Revoked" : `Max ${u(p.per_tx_limit)} per payment`) : "Set limits below", link: st.links?.agent },
                { l: "Invoices paid", v: `${invoices.filter((i) => i.status === "paid").length} of ${invoices.length}`, s: "Verified on chain" },
              ].map((k, i) => (
                <div key={k.l} className={`min-w-0 px-5 py-3 ${i % 2 === 1 ? "border-l border-border" : ""} ${i >= 2 ? "border-t border-border lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
                  <dt className="text-[15px] font-medium text-muted-foreground">{k.l}</dt>
                  <dd className="tabular text-2xl font-bold tracking-[-0.01em]">{k.v}</dd>
                  <dd className="truncate text-sm text-muted-foreground">
                    {k.link ? <a href={k.link} target="_blank" rel="noreferrer" className="hover:underline">{k.s}</a> : k.s}
                  </dd>
                </div>
              ))}
            </dl>

            {!hasKey && (
              <div className="grid gap-3 rounded-xl border border-warning/40 bg-warning/5 p-5">
                <div className="flex gap-3">
                  <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium">Owner key is not in this browser</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">Import your key backup to fund the vault, change limits or approve payees from here.</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <F id="keyimp" label="Owner key" className="flex-1">
                    <input id="keyimp" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="ed25519:..." className={`${input} font-mono`} autoComplete="off" spellCheck={false} />
                  </F>
                  <button type="button" className={btnSecondary} onClick={() => {
                    try {
                      importOwnerKey(user.id, keyInput)
                      setHasKey(true)
                      setKeyInput("")
                      setMsg({ ok: true, text: "Owner key imported into this browser." })
                    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Invalid key" }) }
                  }}>Import key</button>
                </div>
              </div>
            )}

            <div className="grid items-start gap-4 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-6">
              {/* Section sidebar: a column on desktop, a scrollable row on small screens */}
              <nav aria-label="Finance sections" className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col">
                {TABS.map(({ id, label, does, icon: I }) => {
                  const count = { vault: 0, company: 0, payees: payees.length, pay: payments.length, invoices: invoices.length }[id]
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-current={tab === id ? "page" : undefined}
                      onClick={() => { history.replaceState(null, "", `#${id}`); setTab(id) }}
                      className={`press flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-base transition-colors ${tab === id ? "bg-card font-bold text-foreground shadow-[inset_0_0_0_1px_var(--border)]" : "font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    >
                      <I className={`h-5 w-5 shrink-0 ${tab === id ? "text-primary" : ""}`} strokeWidth={2} />
                      <span className="flex-1 whitespace-nowrap">{label}<span className="hidden text-sm font-normal text-muted-foreground lg:block">{does}</span></span>
                      {!!count && <span className="tabular text-xs text-muted-foreground">{count}</span>}
                    </button>
                  )
                })}
              </nav>

              <div className="min-w-0">
              {/* Vault controls */}
              {tab === "vault" && <Section id="vault" icon={Vault} title="Operating vault" sub="A smart contract that holds the agent's spending budget. Move money in, set limits, take it back any time. The contract enforces the limits, not SKYPay's server.">
                <div className="flex flex-wrap gap-2">
                  {st.isTestToken && (
                    <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => run("Test tokens", async () => {
                      const r = await authService.api<{ url: string }>("/api/near/test-faucet", { method: "POST" })
                      return { url: r.url, text: "Minted 100 tUSDC (testnet test token, no value) to your receiving account" }
                    })}>Get 100 test tUSDC</button>
                  )}
                  <button type="button" className={btnSecondary} disabled={!hasKey} onClick={() => downloadOwnerKeyBackup(user.id, st.company)}>
                    <Download className="h-4 w-4" /> Owner key backup
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-2 [&>button]:mt-[30px]">
                    <F id="fund" label={`Fund vault (${tokenShort})`} hint="Moves money from your receiving account into the vault." className="flex-1">
                      <input id="fund" inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} className={`${input} tabular`} />
                    </F>
                    <button type="button" disabled={!!busy || !hasKey || !isAmount(fund)} className={btnPrimary} onClick={() => run("Fund vault", () =>
                      owner("Fund vault", st.token, "ft_transfer_call", { receiver_id: st.vault, amount: toBaseUnits(fund), msg: "fund" }, BigInt(1), 100))}>
                      Fund
                    </button>
                  </div>
                  <div className="flex items-start gap-2 [&>button]:mt-[30px]">
                    <F id="withdraw" label={`Withdraw (${tokenShort})`} hint="Returns unspent vault money to your receiving account." className="flex-1">
                      <input id="withdraw" inputMode="decimal" value={withdraw} onChange={(e) => setWithdraw(e.target.value)} className={`${input} tabular`} />
                    </F>
                    <button type="button" disabled={!!busy || !hasKey || !isAmount(withdraw)} className={btnSecondary} onClick={() => run("Withdraw", () =>
                      owner("Withdraw", st.vault!, "withdraw", { amount: toBaseUnits(withdraw) }, BigInt(0), 100))}>
                      Withdraw
                    </button>
                  </div>
                </div>

                <div className="rounded-lg bg-muted p-4">
                  <p className="font-medium">Agent spending policy</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Per payment is the largest single payment. Per day is the total the agent may send in one day (UTC). After the valid days pass, the agent can no longer pay until you renew.
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <F id="pertx" label="Per payment"><input id="pertx" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} className={`${input} tabular`} /></F>
                    <F id="daily" label="Per day"><input id="daily" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} className={`${input} tabular`} /></F>
                    <F id="days" label="Valid days"><input id="days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={`${input} tabular`} /></F>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" disabled={!!busy || !hasKey || !isAmount(perTx) || !isAmount(daily) || !(Number(days) > 0)} className={btnPrimary} onClick={() => run("Set agent limits", () =>
                      owner("Set agent limits", st.vault!, "set_agent", {
                        agent: st.agent, per_tx_limit: toBaseUnits(perTx), daily_limit: toBaseUnits(daily),
                        expires_at_ms: Date.now() + Number(days) * 86_400_000,
                      }))}>
                      {p ? "Update limits" : "Authorize agent"}
                    </button>
                    {p && !p.revoked && (
                      <button type="button" disabled={!!busy || !hasKey} className={`${btnSecondary} border-destructive/40 text-destructive hover:bg-destructive/5`}
                        onClick={() => run("Revoke agent", () => owner("Revoke agent", st.vault!, "revoke_agent", { agent: st.agent }))}>
                        <Trash2 className="h-4 w-4" /> Revoke agent
                      </button>
                    )}
                  </div>
                  {p && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {p.revoked ? "Agent revoked: every payment is refused on chain." : `Policy expires ${new Date(p.expires_at_ms).toLocaleDateString()}.`}
                    </p>
                  )}
                </div>
              </Section>}

              {/* Payees */}
              {tab === "payees" && <Section id="payees" icon={Users} title="Approved payees" sub="The only accounts the vault will pay. You add them here; the agent cannot add one or take an address from chat, email or an invoice.">
                {payees.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {payees.map((x) => (
                      <li key={x.id} className="grid gap-3 px-4 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium">{x.name}{x.email && <span className="ml-2 text-sm font-normal text-muted-foreground">{x.email}</span>}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{x.nearAccount}</p>
                            {x.notes && <p className="text-sm text-muted-foreground">{x.notes}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {x.allowListedOnChain ? (
                              <span className="text-xs font-medium text-success">Approved on vault</span>
                            ) : (
                              <button type="button" className={`${btnSecondary} h-8 px-3 text-xs`} disabled={!!busy || !hasKey} onClick={() => run("Allow-list payee", () =>
                                owner("Allow-list payee", st.vault!, "add_payee", { payee: x.nearAccount }))}>Approve on vault</button>
                            )}
                            <button type="button" className={`${btnSecondary} h-8 px-3 text-xs`} onClick={() => { setEditId(editId === x.id ? null : x.id); setEdit({ name: x.name, email: x.email || "", notes: x.notes || "" }) }}>Edit</button>
                            <button type="button" aria-label={`Remove ${x.name}`} className={`${btnSecondary} h-8 px-2.5 text-xs`} disabled={!!busy} onClick={() => {
                              if (confirm(`Remove ${x.name} from SKYPay? ${x.allowListedOnChain ? "Their on-chain approval stays until you revoke it in the vault." : ""}`)) run("Remove payee", async () => { await authService.api(`/api/payees/${x.id}`, { method: "DELETE" }) })
                            }}><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>
                        {editId === x.id && (
                          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-start [&>button]:mt-[30px]">
                            <F id={`e-name-${x.id}`} label="Name"><input id={`e-name-${x.id}`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={input} /></F>
                            <F id={`e-mail-${x.id}`} label="Email"><input id={`e-mail-${x.id}`} type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className={input} /></F>
                            <F id={`e-notes-${x.id}`} label="Notes" hint="Not shared. Shown in Notion too."><input id={`e-notes-${x.id}`} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className={input} /></F>
                            <button type="button" className={btnPrimary} disabled={!!busy || !edit.name.trim()} onClick={() => run("Save payee", async () => {
                              await authService.api(`/api/payees/${x.id}`, { method: "PATCH", body: JSON.stringify(edit) })
                              setEditId(null)
                            })}>Save</button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No payees yet. Add the suppliers you pay regularly.</p>
                )}
                <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr_auto] sm:items-end">
                  <F id="payee-name" label="Name"><input id="payee-name" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} className={input} /></F>
                  <F id="payee-acct" label="NEAR account"><input id="payee-acct" value={payeeAcct} onChange={(e) => setPayeeAcct(e.target.value)} placeholder="supplier.testnet" className={`${input} font-mono`} spellCheck={false} /></F>
                  <button type="button" className={btnPrimary} disabled={!!busy || !payeeAcct.trim() || !hasKey} onClick={() => run("Add payee", async () => {
                    const r = await authService.api<{ payee: Payee }>("/api/payees", { method: "POST", body: JSON.stringify({ name: payeeName, nearAccount: payeeAcct }) })
                    const tx = await owner("Allow-list payee", st.vault!, "add_payee", { payee: r.payee.nearAccount })
                    setPayeeName(""); setPayeeAcct("")
                    return tx
                  })}><Plus className="h-4 w-4" /> Add</button>
                </div>
              </Section>}

            {/* Supplier payments */}
            {tab === "pay" && <Section id="pay" icon={Send} title="Payouts" sub="Send money from the vault to approved payees, using the agent's key. Over-limit, unapproved or revoked payments are refused on chain. Every payout is also logged in your Notion workspace under Supplier payments.">
              <div role="tablist" aria-label="Payout type" className="inline-flex w-fit rounded-lg border border-border bg-muted p-1">
                {(["single", "batch", "import"] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={payMode === m} onClick={() => setPayMode(m)}
                    className={`press rounded-md px-4 py-1.5 text-sm font-semibold ${payMode === m ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{{ single: "Single payout", batch: "Batch payout", import: "Import Excel" }[m]}</button>
                ))}
              </div>
              {payMode === "import" && (importFile
                ? <PayrollPreview key={importFile.name + importFile.lastModified} file={importFile} onCancel={() => setImportFile(null)} onDone={() => { load().catch(() => {}) }} />
                : <PayrollPicker onFile={setImportFile} />)}
              {payMode === "batch" && (() => {
                const valid = rows.every((r) => r.payeeId && isAmount(r.amount))
                const total = rows.reduce((a, r) => a + (isAmount(r.amount) ? Number(r.amount) : 0), 0)
                const avail = st.vaultAvailable ? Number(fromBaseUnits(st.vaultAvailable)) : 0
                return (
                  <div className="grid gap-3 rounded-lg border border-border p-4">
                    <F id="batch-label" label="Batch name" hint="For your records, e.g. “November suppliers”."><input id="batch-label" value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} className={input} /></F>
                    {rows.map((r, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[1.2fr_0.6fr_1fr_auto] sm:items-end">
                        <select aria-label={`Payee ${i + 1}`} className={input} value={r.payeeId} onChange={(e) => setRows(rows.map((x, k) => k === i ? { ...x, payeeId: e.target.value } : x))}>
                          <option value="">Choose payee</option>
                          {payees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <input aria-label={`Amount ${i + 1}`} placeholder={`Amount (${tokenShort})`} inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, k) => k === i ? { ...x, amount: e.target.value } : x))} className={`${input} tabular`} />
                        <input aria-label={`Memo ${i + 1}`} placeholder="Memo or bill reference" value={r.memo} onChange={(e) => setRows(rows.map((x, k) => k === i ? { ...x, memo: e.target.value } : x))} className={input} />
                        <button type="button" aria-label={`Remove row ${i + 1}`} className={`${btnSecondary} px-3`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, k) => k !== i))}><X className="h-4 w-4" /></button>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button type="button" className={btnSecondary} disabled={rows.length >= 10} onClick={() => setRows([...rows, { payeeId: "", amount: "", memo: "" }])}><Plus className="h-4 w-4" /> Add payee ({rows.length}/10)</button>
                      <p className={`tabular text-base font-semibold ${total > avail ? "text-destructive" : ""}`}>Total {total.toFixed(2)} of {avail.toFixed(2)} {tokenShort} available</p>
                      <button type="button" className={btnPrimary} disabled={!!busy || !valid || total > avail} onClick={() => run("Batch payout", async () => {
                        const r = await authService.api<{ batch: Batch; payments: VaultPayment[] }>("/api/vault/payout-batches", { method: "POST", body: JSON.stringify({ label: batchLabel, items: rows }) })
                        const ok = r.payments.filter((p) => p.status === "settled").length
                        setRows([{ payeeId: "", amount: "", memo: "" }]); setBatchLabel("")
                        return { text: `Batch ${r.batch.status}: ${ok} of ${r.payments.length} payments settled` }
                      })}>{busy === "Batch payout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Pay all</button>
                    </div>
                    <p className="text-sm text-muted-foreground">Payments run one after another. If the vault refuses one, the others still go through.</p>
                  </div>
                )
              })()}
              {payMode === "single" && <div className="grid gap-3 sm:grid-cols-[1.2fr_0.6fr_1fr_auto] sm:items-end">
                <F id="pay-to" label="Payee">
                  <select id="pay-to" className={input} value={payTo} onChange={(e) => setPayTo(e.target.value)}>
                    <option value="">Choose payee</option>
                    {payees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </F>
                <F id="pay-amt" label={`Amount (${tokenShort})`}><input id="pay-amt" inputMode="decimal" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} className={`${input} tabular`} /></F>
                <F id="pay-memo" label="Memo or bill reference"><input id="pay-memo" value={payMemo} onChange={(e) => setPayMemo(e.target.value)} className={input} /></F>
                <button type="button" disabled={!!busy || !payTo || !isAmount(payAmt)} className={btnPrimary} onClick={() => run("Supplier payment", async () => {
                  const r = await authService.api<{ payment: VaultPayment & { url: string | null } }>("/api/vault/payments", {
                    method: "POST", body: JSON.stringify({ payeeId: payTo, amount: payAmt, memo: payMemo, idempotencyKey: `${payTo}|${payAmt}|${payMemo}|${Date.now()}` }),
                  })
                  return { url: r.payment.url || undefined, text: `Payment ${r.payment.status}` }
                })}>
                  {busy === "Supplier payment" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Pay
                </button>
              </div>}
              {batches.length > 0 && (
                <div className="grid gap-2">
                  <h3 className="text-[15px] font-bold">Batches</h3>
                  {batches.map((b) => (
                    <details key={b.id} className="rounded-lg border border-border">
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2.5 font-medium">
                        <span>{b.label} <span className="ml-1 text-sm font-normal text-muted-foreground">{b.payments.length} payments · {Number(b.totalFormatted).toFixed(2)} {tokenShort} · {new Date(b.createdAt).toLocaleDateString()}</span></span>
                        <StatusPill status={b.status === "done" ? "settled" : b.status === "partial" ? "processing" : b.status === "failed" ? "failed" : "pending"} />
                      </summary>
                      <ul className="divide-y divide-border border-t border-border">
                        {b.payments.map((x) => (
                          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                            <span className="min-w-0 truncate"><span className="font-mono text-xs">{x.recipient}</span>{x.memo && <span className="ml-2 text-muted-foreground">{x.memo}</span>}</span>
                            <span className="flex items-center gap-3">
                              <span className="tabular font-medium">{Number(x.amountFormatted).toFixed(2)}</span>
                              <StatusPill status={x.status} />
                              {x.error ? <span className="text-xs text-destructive">{x.error.replace("Contract panicked: ", "Refused by vault: ")}</span> : <Tx url={x.url} />}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              )}
              {payments.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[560px] text-base font-medium">
                    <thead>
                      <tr className="bg-muted text-left text-sm text-muted-foreground">
                        <th className="px-4 py-2 font-semibold">Recipient</th>
                        <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                        <th className="px-4 py-2 font-semibold">Status</th>
                        <th className="px-4 py-2 font-semibold"><span className="sr-only">Details</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {payments.map((x) => (
                        <tr key={x.id}>
                          <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-xs">{x.recipient}</td>
                          <td className="tabular px-4 py-2.5 text-right">{Number(x.amountFormatted).toFixed(2)}</td>
                          <td className="px-4 py-2.5"><StatusPill status={x.status} /></td>
                          <td className="px-4 py-2.5 text-right">
                            {x.error ? <span className="text-xs text-destructive">{x.error.replace("Contract panicked: ", "Refused by vault: ")}</span> : <Tx url={x.url} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>}

            {/* Invoices */}
            {tab === "invoices" && <Section id="invoices" icon={FileText} title="Invoices" sub="Create an invoice and SKYPay emails the client a pay link. It turns paid only after the transfer is verified on NEAR, and the money goes to your receiving account.">
              <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                <F id="inv-email" label="Client email"><input id="inv-email" type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} className={input} /></F>
                <F id="inv-name" label="Client name"><input id="inv-name" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} className={input} /></F>
                <F id="inv-desc" label="Description"><input id="inv-desc" value={inv.description} onChange={(e) => setInv({ ...inv, description: e.target.value })} className={input} /></F>
                <F id="inv-due" label="Due date" hint="Defaults to 14 days."><input id="inv-due" type="date" value={inv.due} onChange={(e) => setInv({ ...inv, due: e.target.value })} className={input} /></F>
              </div>

              <fieldset className="grid gap-3">
                <legend className="mb-1 text-sm font-medium">Line items</legend>
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_72px_120px] gap-2">
                    <input aria-label={`Line ${i + 1} description`} placeholder="Item" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} className={input} />
                    <input aria-label={`Line ${i + 1} quantity`} inputMode="numeric" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className={`${input} tabular`} />
                    <input aria-label={`Line ${i + 1} unit price in ${tokenShort}`} inputMode="decimal" placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} className={`${input} tabular`} />
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" onClick={() => setLines([...lines, { description: "", quantity: "1", unitPrice: "" }])}>
                    <Plus className="h-4 w-4" /> Add line
                  </button>
                  <p className="tabular text-sm">Total <span className="font-semibold">{lineTotal.toFixed(2)} {tokenShort}</span></p>
                </div>
              </fieldset>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
                <button type="button" disabled={!!busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inv.email) || lineTotal <= 0} className={btnPrimary} onClick={() => run("Create invoice", async () => {
                  const r = await authService.api<{ invoice: Invoice }>("/api/invoices", {
                    method: "POST",
                    body: JSON.stringify({
                      customerEmail: inv.email, customerName: inv.name, description: inv.description, dueDate: inv.due || undefined,
                      lineItems: lines.filter((l) => l.unitPrice).map((l) => ({ description: l.description, quantity: Number(l.quantity || 1), unitPrice: l.unitPrice })),
                    }),
                  })
                  setInv({ email: "", name: "", description: "", due: "" }); setLines([{ description: "", quantity: "1", unitPrice: "" }])
                  return { text: `${r.invoice.number} created and emailed: ${window.location.origin}/invoice/${r.invoice.id}` }
                })}>
                  {busy === "Create invoice" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create and email invoice
                </button>
                <span className="ml-auto flex flex-wrap gap-2">
                  <button type="button" className={btnSecondary} onClick={() => run("Export", async () => { await download("/api/export/invoices.csv", "skypay-invoices.csv") })}><Download className="h-4 w-4" /> invoices.csv</button>
                  <button type="button" className={btnSecondary} onClick={() => run("Export", async () => { await download("/api/export/payments.csv", "skypay-payments.csv") })}><Download className="h-4 w-4" /> payments.csv</button>
                </span>
              </div>

              {invoices.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[620px] text-base font-medium">
                    <thead>
                      <tr className="bg-muted text-left text-sm text-muted-foreground">
                        <th className="px-4 py-2 font-semibold">Invoice</th>
                        <th className="px-4 py-2 font-semibold">Client</th>
                        <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                        <th className="px-4 py-2 font-semibold">Status</th>
                        <th className="px-4 py-2 font-semibold">Due</th>
                        <th className="px-4 py-2.5"><span className="sr-only">Transaction</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {invoices.map((x) => (
                        <tr key={x.id}>
                          <td className="px-4 py-2.5"><Link href={`/invoice/${x.id}`} target="_blank" className="font-medium hover:underline">{x.number}</Link></td>
                          <td className="max-w-[200px] truncate px-4 py-2.5 text-muted-foreground">{x.customerName || x.customerEmail}</td>
                          <td className="tabular px-4 py-2.5 text-right">{Number(x.amountFormatted).toFixed(2)}</td>
                          <td className="px-4 py-2.5"><StatusPill status={x.status} /></td>
                          <td className="px-4 py-2.5 text-muted-foreground">{new Date(x.dueDate).toLocaleDateString()}</td>
                          <td className="px-4 py-2.5 text-right"><Tx url={x.txUrl} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No invoices yet. Fill in the form above to send your first one.</p>
              )}
            </Section>}

            {tab === "company" && <Section id="company" icon={Building2} title="Company details" sub="Printed as the seller on new invoices and invoice emails. Invoices already sent keep the details they were issued with.">
              <BusinessForm />
              <dl className="grid gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">Sign-in email</dt><dd>{user.email}</dd>
                <dt className="text-muted-foreground">Receiving account</dt><dd className="break-all font-mono text-xs">{st.company}</dd>
                <dt className="text-muted-foreground">Vault contract</dt><dd className="break-all font-mono text-xs">{st.vault}</dd>
                <dt className="text-muted-foreground">Agent account</dt><dd className="break-all font-mono text-xs">{st.agent}</dd>
                <dt className="text-muted-foreground">Owner key</dt><dd>{hasKey ? "In this browser. Keep the backup file safe." : "Not in this browser. Import your backup above."}</dd>
              </dl>
            </Section>}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
