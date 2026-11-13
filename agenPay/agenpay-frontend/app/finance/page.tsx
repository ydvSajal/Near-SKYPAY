"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { ensureOwnerKey, getStoredOwnerKey, importOwnerKey, ownerAction, toBaseUnits, fromBaseUnits, downloadOwnerKeyBackup } from "@/lib/near"
import { AppHeader } from "@/components/app/app-header"
import { StatusPill } from "@/components/app/status"
import {
  AlertCircle, CheckCircle2, Download, ExternalLink, FileText, KeyRound, Loader2, Plus, Send, ShieldCheck, Trash2, Users, Vault, X,
} from "lucide-react"

// ---------------------------------------------------------------- types
interface AgentPolicy { per_tx_limit: string; daily_limit: string; expires_at_ms: number; revoked: boolean; day: number; spent_today: string }
interface NearStatus {
  configured: boolean; network: string; token: string; isTestToken: boolean; tokenLabel: string; relayer: string
  company: string | null; vault: string | null; agent: string | null; ownerPublicKey: string | null
  companyBalance?: string; vaultAvailable?: string; vaultReserved?: string; agentPolicy?: AgentPolicy | null
  links?: { company: string; vault: string; agent: string }
}
interface Payee { id: string; name: string; nearAccount: string; allowListedOnChain: boolean }
interface VaultPayment { id: string; paymentId: string; recipient: string; amountFormatted: string; status: string; error: string | null; url: string | null; createdAt: string }
interface Invoice {
  id: string; number: string; customerEmail: string; customerName: string | null; amountFormatted: string; status: string
  dueDate: string; createdAt: string; txUrl: string | null; settledTxHash: string | null
}

// ---------------------------------------------------------------- ui bits
const isAmount = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.trim()) && Number(v) > 0
const input = "h-10 w-full rounded-lg border border-input bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 md:text-sm"
const btnPrimary = "press inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
const btnSecondary = "press inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"

function F({ id, label, hint, children, className = "" }: { id: string; label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Tx({ url }: { url: string | null }) {
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
      Transaction <ExternalLink className="h-3 w-3" />
    </a>
  ) : null
}

function Section({ id, icon: I, title, sub, children }: { id?: string; icon: typeof Vault; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-border bg-card">
      <div className="flex gap-3 border-b border-border px-5 py-4">
        <I className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" strokeWidth={1.75} />
        <div>
          <h2 className="font-semibold">{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
        </div>
      </div>
      <div className="grid gap-5 p-5">{children}</div>
    </section>
  )
}

// ------------------------------------------------------------------ page
export default function FinancePage() {
  const { user } = useAuth()
  const [st, setSt] = useState<NearStatus | null>(null)
  const [loadError, setLoadError] = useState("")
  const [payees, setPayees] = useState<Payee[]>([])
  const [payments, setPayments] = useState<VaultPayment[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState("")

  const load = useCallback(async () => {
    const s = await authService.api<NearStatus>("/api/near/status")
    setSt(s)
    setLoadError("")
    if (s.company) {
      const [p, v, i] = await Promise.all([
        authService.api<{ payees: Payee[] }>("/api/payees"),
        authService.api<{ payments: VaultPayment[] }>("/api/vault/payments"),
        authService.api<{ invoices: Invoice[] }>("/api/invoices"),
      ])
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

  // Arriving from a dashboard shortcut: scroll once content exists.
  useEffect(() => {
    if (st?.company && window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView()
  }, [st?.company])

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

      <main className="mx-auto grid max-w-[1200px] gap-6 px-4 py-6 md:px-6 md:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Accounts, vault rules, payees, supplier payments and invoices.</p>
        </div>

        <div aria-live="polite">
          {msg && (
            <div role={msg.ok ? "status" : "alert"} className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-success/30 bg-success/5 text-success" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
              {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <p className="min-w-0 flex-1 break-words">
                {msg.text} {msg.url && <a className="ml-1 font-medium underline" href={msg.url} target="_blank" rel="noreferrer">View transaction</a>}
              </p>
              <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss message" className="rounded-md p-0.5 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
            </div>
          )}
        </div>

        {!st.configured && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
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
            {/* Accounts + balances */}
            <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4">
              {[
                { l: "Receiving account", v: `${u(st.companyBalance)} ${tokenShort}`, s: st.company, link: st.links?.company },
                { l: "Vault available", v: `${u(st.vaultAvailable)} ${tokenShort}`, s: `${u(st.vaultReserved)} reserved`, link: st.links?.vault },
                { l: "Agent spent today", v: p ? `${u(p.spent_today)} / ${u(p.daily_limit)}` : "No policy", s: p ? (p.revoked ? "Revoked" : `Max ${u(p.per_tx_limit)} per payment`) : "Set limits below", link: st.links?.agent },
                { l: "Invoices paid", v: `${invoices.filter((i) => i.status === "paid").length} of ${invoices.length}`, s: "Verified on chain" },
              ].map((k, i) => (
                <div key={k.l} className={`min-w-0 p-5 ${i % 2 === 1 ? "border-l border-border" : ""} ${i >= 2 ? "border-t border-border lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
                  <dt className="text-sm text-muted-foreground">{k.l}</dt>
                  <dd className="tabular mt-1.5 text-xl font-semibold tracking-[-0.01em]">{k.v}</dd>
                  <dd className="mt-1 truncate text-xs text-muted-foreground">
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

            <div className="grid items-start gap-6 lg:grid-cols-2">
              {/* Vault controls */}
              <Section id="vault" icon={Vault} title="Operating vault" sub="Money the agent may spend. The contract enforces these rules, not SKYPay's server.">
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
                  <div className="flex items-end gap-2">
                    <F id="fund" label={`Fund vault (${tokenShort})`} className="flex-1">
                      <input id="fund" inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} className={`${input} tabular`} />
                    </F>
                    <button type="button" disabled={!!busy || !hasKey || !isAmount(fund)} className={btnPrimary} onClick={() => run("Fund vault", () =>
                      owner("Fund vault", st.token, "ft_transfer_call", { receiver_id: st.vault, amount: toBaseUnits(fund), msg: "fund" }, BigInt(1), 100))}>
                      Fund
                    </button>
                  </div>
                  <div className="flex items-end gap-2">
                    <F id="withdraw" label={`Withdraw (${tokenShort})`} className="flex-1">
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
              </Section>

              {/* Payees */}
              <Section id="payees" icon={Users} title="Approved payees" sub="Only you can add payout destinations. The agent cannot take addresses from chat, email or invoices.">
                {payees.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {payees.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">{x.name}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">{x.nearAccount}</p>
                        </div>
                        {x.allowListedOnChain ? (
                          <span className="shrink-0 text-xs font-medium text-success">Approved on vault</span>
                        ) : (
                          <button type="button" className={`${btnSecondary} h-8 shrink-0 px-3 text-xs`} disabled={!!busy || !hasKey} onClick={() => run("Allow-list payee", () =>
                            owner("Allow-list payee", st.vault!, "add_payee", { payee: x.nearAccount }))}>Approve on vault</button>
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
              </Section>
            </div>

            {/* Supplier payments */}
            <Section id="pay" icon={Send} title="Pay a supplier from the vault" sub="Executed by the agent account. The vault refuses anything over the limits, to unapproved payees, or after revocation.">
              <div className="grid gap-3 sm:grid-cols-[1.2fr_0.6fr_1fr_auto] sm:items-end">
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
              </div>
              {payments.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="bg-muted text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">Recipient</th>
                        <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium"><span className="sr-only">Details</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {payments.map((x) => (
                        <tr key={x.id}>
                          <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs">{x.recipient}</td>
                          <td className="tabular px-4 py-3 text-right">{Number(x.amountFormatted).toFixed(2)}</td>
                          <td className="px-4 py-3"><StatusPill status={x.status} /></td>
                          <td className="px-4 py-3 text-right">
                            {x.error ? <span className="text-xs text-destructive">{x.error.replace("Contract panicked: ", "Refused by vault: ")}</span> : <Tx url={x.url} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Invoices */}
            <Section id="invoices" icon={FileText} title="Invoices" sub="Clients pay in USDC on NEAR. An invoice is marked paid only after SKYPay verifies the transfer on chain.">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="bg-muted text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">Invoice</th>
                        <th className="px-4 py-2.5 font-medium">Client</th>
                        <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Due</th>
                        <th className="px-4 py-2.5"><span className="sr-only">Transaction</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {invoices.map((x) => (
                        <tr key={x.id}>
                          <td className="px-4 py-3"><Link href={`/invoice/${x.id}`} target="_blank" className="font-medium hover:underline">{x.number}</Link></td>
                          <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">{x.customerName || x.customerEmail}</td>
                          <td className="tabular px-4 py-3 text-right">{Number(x.amountFormatted).toFixed(2)}</td>
                          <td className="px-4 py-3"><StatusPill status={x.status} /></td>
                          <td className="px-4 py-3 text-muted-foreground">{new Date(x.dueDate).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-right"><Tx url={x.txUrl} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No invoices yet. Fill in the form above to send your first one.</p>
              )}
            </Section>
          </>
        )}
      </main>
    </div>
  )
}
