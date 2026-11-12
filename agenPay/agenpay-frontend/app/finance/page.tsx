"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { ensureOwnerKey, getStoredOwnerKey, importOwnerKey, ownerAction, toBaseUnits, fromBaseUnits } from "@/lib/near"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ArrowLeft, CreditCard, ExternalLink, Loader2, Plus, ShieldCheck, Download, KeyRound, FileText, Send, Trash2, Vault, Users,
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

const card = "rounded-lg border border-slate-200 bg-white p-4"
const STATUS: Record<string, string> = {
  paid: "#0ca30c", settled: "#0ca30c", pending: "#fab219", processing: "#fab219", submitted: "#fab219",
  failed: "#d03b3b", unknown: "#898781", refunded: "#2a78d6",
}
const Dot = ({ s }: { s: string }) => (
  <span className="inline-flex items-center gap-1 text-xs capitalize text-slate-600">
    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATUS[s] || "#898781" }} />
    {s}
  </span>
)
const Tx = ({ url }: { url: string | null }) =>
  url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-[#2a78d6] hover:underline">
      tx <ExternalLink className="h-3 w-3" />
    </a>
  ) : null

function Section({ icon: I, title, sub, children }: { icon: typeof Vault; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className={`${card} flex flex-col gap-3`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
          <I className="h-3.5 w-3.5 text-white" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

// ------------------------------------------------------------------ page
export default function FinancePage() {
  const { user } = useAuth()
  const [st, setSt] = useState<NearStatus | null>(null)
  const [payees, setPayees] = useState<Payee[]>([])
  const [payments, setPayments] = useState<VaultPayment[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const [hasKey, setHasKey] = useState(false)

  const load = useCallback(async () => {
    const s = await authService.api<NearStatus>("/api/near/status")
    setSt(s)
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

  useEffect(() => {
    if (!user) return
    setHasKey(!!getStoredOwnerKey(user.id))
    load().catch((e) => setMsg({ ok: false, text: e.message }))
  }, [user, load])

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
    return { url: r.url, text: `${label}: confirmed on NEAR (gas paid by SkyPay sponsor)` }
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

  const backupKey = () => {
    if (!user) return
    const secret = getStoredOwnerKey(user.id)
    if (!secret) return
    const blob = new Blob([`SkyPay company owner key for ${st?.company}\nKeep this file private. Anyone with it controls the company account.\n\n${secret}\n`], { type: "text/plain" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `skypay-owner-key-${st?.company}.txt`
    a.click()
  }

  if (!user || !st) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  const u = (v?: string | null) => fromBaseUnits(v || "0")
  const p = st.agentPolicy

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-6">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
          <CreditCard className="h-4 w-4 text-white" />
        </span>
        <span className="text-lg font-semibold">SKYPay Finance</span>
        <span className="ml-auto rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600">
          NEAR {st.network} · {st.tokenLabel}
        </span>
      </header>

      <main className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-6">
        {msg && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-[#0ca30c]/40 bg-[#0ca30c]/5" : "border-[#d03b3b]/40 bg-[#d03b3b]/5"}`}>
            {msg.text} {msg.url && <a className="ml-1 text-[#2a78d6] underline" href={msg.url} target="_blank" rel="noreferrer">view transaction</a>}
          </div>
        )}

        {!st.configured && (
          <div className="rounded-lg border border-[#d03b3b]/40 bg-white p-3 text-sm">Backend NEAR is not configured. Run <code>npm run near:bootstrap</code> in agenpay-backend.</div>
        )}

        {!st.company ? (
          <Section icon={ShieldCheck} title="Set up your company on NEAR" sub="Free and gasless: SkyPay sponsors account creation and fees. You never buy NEAR.">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>A company account is created with a key generated <b>in this browser</b>. SkyPay never sees it.</li>
              <li>An operating vault contract is deployed for you. Only your account can fund it, change rules or withdraw.</li>
              <li>An agent account is created that can only call <code>pay</code> on your vault, within the limits you set.</li>
            </ol>
            <Button
              disabled={!!busy || !st.configured}
              className="w-fit bg-primary text-white"
              onClick={() => run("Company setup", async () => {
                const { publicKey } = await ensureOwnerKey(user.id)
                setHasKey(true)
                const r = await authService.api<{ company: string }>("/api/near/provision", { method: "POST", body: JSON.stringify({ publicKey }) })
                return { text: `Company account ${r.company} created. Download your key backup next.` }
              })}
            >
              {busy === "Company setup" ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating accounts (~30s)</> : "Create company NEAR account"}
            </Button>
          </Section>
        ) : (
          <>
            {/* Accounts + balances */}
            <div className="grid gap-4 md:grid-cols-4">
              {[
                { l: "Receiving account", v: `${u(st.companyBalance)}`, s: st.company, link: st.links?.company },
                { l: "Vault available", v: `${u(st.vaultAvailable)}`, s: `reserved ${u(st.vaultReserved)}`, link: st.links?.vault },
                { l: "Agent spent today", v: p ? `${u(p.spent_today)} / ${u(p.daily_limit)}` : "no policy", s: p ? (p.revoked ? "revoked" : `max ${u(p.per_tx_limit)} per payment`) : "set limits below", link: st.links?.agent },
                { l: "Invoices paid", v: `${invoices.filter((i) => i.status === "paid").length} / ${invoices.length}`, s: "verified on-chain" },
              ].map((k) => (
                <div key={k.l} className={card}>
                  <p className="text-xs font-medium text-slate-500">{k.l}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{k.v}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {k.link ? <a href={k.link} target="_blank" rel="noreferrer" className="hover:underline">{k.s}</a> : k.s}
                  </p>
                </div>
              ))}
            </div>

            {!hasKey && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#fab219] bg-white p-3 text-sm">
                <KeyRound className="h-4 w-4 text-[#fab219]" />
                Owner key is not in this browser. Import your backup to manage the vault:
                <Input id="keyimp" placeholder="ed25519:..." className="max-w-sm" />
                <Button size="sm" variant="outline" onClick={() => {
                  try {
                    importOwnerKey(user.id, (document.getElementById("keyimp") as HTMLInputElement).value)
                    setHasKey(true)
                  } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "invalid key" }) }
                }}>Import</Button>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Vault controls */}
              <Section icon={Vault} title="Operating vault" sub="Company funds the agent may spend. Rules are enforced by the contract, not by SkyPay's server.">
                <div className="flex flex-wrap gap-2">
                  {st.isTestToken && (
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("Test tokens", async () => {
                      const r = await authService.api<{ url: string }>("/api/near/test-faucet", { method: "POST" })
                      return { url: r.url, text: "Minted 100 tUSDC (testnet test token, no value) to your receiving account" }
                    })}>Get 100 test tUSDC</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={backupKey} disabled={!hasKey}><Download className="h-3.5 w-3.5" /> Owner key backup</Button>
                </div>
                <div className="flex gap-2">
                  <Input value={fund} onChange={(e) => setFund(e.target.value)} placeholder="amount" className="max-w-[140px]" />
                  <Button size="sm" disabled={!!busy || !hasKey} className="bg-primary text-white" onClick={() => run("Fund vault", () =>
                    owner("Fund vault", st.token, "ft_transfer_call", { receiver_id: st.vault, amount: toBaseUnits(fund), msg: "fund" }, BigInt(1), 100))}>
                    Fund vault
                  </Button>
                  <Input value={withdraw} onChange={(e) => setWithdraw(e.target.value)} placeholder="amount" className="max-w-[140px]" />
                  <Button size="sm" variant="outline" disabled={!!busy || !hasKey} onClick={() => run("Withdraw", () =>
                    owner("Withdraw", st.vault!, "withdraw", { amount: toBaseUnits(withdraw) }, BigInt(0), 100))}>
                    Withdraw
                  </Button>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold">Agent spending policy</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <label>Per payment<Input value={perTx} onChange={(e) => setPerTx(e.target.value)} /></label>
                    <label>Per day<Input value={daily} onChange={(e) => setDaily(e.target.value)} /></label>
                    <label>Valid days<Input value={days} onChange={(e) => setDays(e.target.value)} /></label>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={!!busy || !hasKey} className="bg-primary text-white" onClick={() => run("Set agent limits", () =>
                      owner("Set agent limits", st.vault!, "set_agent", {
                        agent: st.agent, per_tx_limit: toBaseUnits(perTx), daily_limit: toBaseUnits(daily),
                        expires_at_ms: Date.now() + Number(days) * 86_400_000,
                      }))}>
                      {p ? "Update limits" : "Authorize agent"}
                    </Button>
                    {p && !p.revoked && (
                      <Button size="sm" variant="outline" disabled={!!busy || !hasKey} className="border-[#d03b3b]/50 text-[#d03b3b]"
                        onClick={() => run("Revoke agent", () => owner("Revoke agent", st.vault!, "revoke_agent", { agent: st.agent }))}>
                        <Trash2 className="h-3.5 w-3.5" /> Revoke agent
                      </Button>
                    )}
                  </div>
                  {p && (
                    <p className="mt-2 text-xs text-slate-500">
                      {p.revoked ? "Agent revoked: every payment is refused on-chain." : `Expires ${new Date(p.expires_at_ms).toLocaleDateString()}.`}
                    </p>
                  )}
                </div>
              </Section>

              {/* Payees */}
              <Section icon={Users} title="Approved payees" sub="Only you can add payout destinations. The agent cannot take addresses from chat, emails or invoices.">
                <ul className="divide-y divide-slate-100 text-sm">
                  {payees.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-2 py-1.5">
                      <div className="min-w-0">
                        <p className="font-medium">{x.name}</p>
                        <p className="truncate font-mono text-xs text-slate-500">{x.nearAccount}</p>
                      </div>
                      {x.allowListedOnChain ? (
                        <span className="text-xs text-[#0ca30c]">allow-listed on vault</span>
                      ) : (
                        <Button size="sm" variant="outline" disabled={!!busy || !hasKey} onClick={() => run("Allow-list payee", () =>
                          owner("Allow-list payee", st.vault!, "add_payee", { payee: x.nearAccount }))}>Allow on vault</Button>
                      )}
                    </li>
                  ))}
                  {!payees.length && <li className="py-2 text-xs text-slate-500">No payees yet.</li>}
                </ul>
                <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
                  <Input placeholder="Name" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
                  <Input placeholder="supplier.testnet" value={payeeAcct} onChange={(e) => setPayeeAcct(e.target.value)} />
                  <Button size="sm" disabled={!!busy || !payeeAcct || !hasKey} onClick={() => run("Add payee", async () => {
                    const r = await authService.api<{ payee: Payee }>("/api/payees", { method: "POST", body: JSON.stringify({ name: payeeName, nearAccount: payeeAcct }) })
                    const tx = await owner("Allow-list payee", st.vault!, "add_payee", { payee: r.payee.nearAccount })
                    setPayeeName(""); setPayeeAcct("")
                    return tx
                  })}><Plus className="h-3.5 w-3.5" /> Add</Button>
                </div>
              </Section>
            </div>

            {/* Supplier payments */}
            <Section icon={Send} title="Pay a supplier from the vault" sub="Executed by the agent account. The vault refuses anything over the limits, to non-approved payees, or after revocation.">
              <div className="grid gap-2 sm:grid-cols-[1.2fr_0.6fr_1fr_auto]">
                <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={payTo} onChange={(e) => setPayTo(e.target.value)}>
                  <option value="">Choose payee</option>
                  {payees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <Input placeholder="USDC" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                <Input placeholder="Memo / bill reference" value={payMemo} onChange={(e) => setPayMemo(e.target.value)} />
                <Button disabled={!!busy || !payTo || !payAmt} className="bg-primary text-white" onClick={() => run("Supplier payment", async () => {
                  const r = await authService.api<{ payment: VaultPayment & { url: string | null } }>("/api/vault/payments", {
                    method: "POST", body: JSON.stringify({ payeeId: payTo, amount: payAmt, memo: payMemo, idempotencyKey: `${payTo}|${payAmt}|${payMemo}|${Date.now()}` }),
                  }).catch((e) => { throw e })
                  return { url: r.payment.url || undefined, text: `Payment ${r.payment.status}` }
                })}>Pay</Button>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {payments.map((x) => (
                    <tr key={x.id}>
                      <td className="py-1.5 font-mono text-xs text-slate-500">{x.recipient}</td>
                      <td className="py-1.5 text-right tabular-nums">{x.amountFormatted}</td>
                      <td className="py-1.5 pl-3"><Dot s={x.status} /></td>
                      <td className="max-w-[320px] truncate py-1.5 pl-3 text-xs text-[#d03b3b]">{x.error?.replace("Contract panicked: ", "Refused by vault: ")}</td>
                      <td className="py-1.5 text-right"><Tx url={x.url} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Invoices */}
            <Section icon={FileText} title="Invoices" sub="Clients pay in USDC on NEAR. An invoice is marked paid only after SkyPay verifies the transfer on-chain.">
              <div className="grid gap-2 sm:grid-cols-4">
                <Input placeholder="Client email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
                <Input placeholder="Client name" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} />
                <Input placeholder="Description" value={inv.description} onChange={(e) => setInv({ ...inv, description: e.target.value })} />
                <Input type="date" value={inv.due} onChange={(e) => setInv({ ...inv, due: e.target.value })} />
              </div>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[2fr_0.6fr_1fr] gap-2">
                  <Input placeholder="Line item" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <Input placeholder="Qty" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                  <Input placeholder="Unit price (USDC)" value={l.unitPrice} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} />
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setLines([...lines, { description: "", quantity: "1", unitPrice: "" }])}><Plus className="h-3.5 w-3.5" /> Line</Button>
                <Button size="sm" disabled={!!busy || !inv.email} className="bg-primary text-white" onClick={() => run("Create invoice", async () => {
                  const r = await authService.api<{ invoice: Invoice }>("/api/invoices", {
                    method: "POST",
                    body: JSON.stringify({
                      customerEmail: inv.email, customerName: inv.name, description: inv.description, dueDate: inv.due || undefined,
                      lineItems: lines.filter((l) => l.unitPrice).map((l) => ({ description: l.description, quantity: Number(l.quantity || 1), unitPrice: l.unitPrice })),
                    }),
                  })
                  setInv({ email: "", name: "", description: "", due: "" }); setLines([{ description: "", quantity: "1", unitPrice: "" }])
                  return { text: `${r.invoice.number} created and emailed: ${window.location.origin}/invoice/${r.invoice.id}` }
                })}>Create &amp; email invoice</Button>
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => run("Export", async () => { await download("/api/export/invoices.csv", "skypay-invoices.csv") })}><Download className="h-3.5 w-3.5" /> invoices.csv</Button>
                  <Button size="sm" variant="outline" onClick={() => run("Export", async () => { await download("/api/export/payments.csv", "skypay-payments.csv") })}><Download className="h-3.5 w-3.5" /> payments.csv</Button>
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-1.5 font-medium">Invoice</th><th className="font-medium">Client</th><th className="text-right font-medium">Amount</th>
                    <th className="pl-3 font-medium">Status</th><th className="font-medium">Due</th><th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((x) => (
                    <tr key={x.id}>
                      <td className="py-1.5"><Link href={`/invoice/${x.id}`} target="_blank" className="font-medium hover:underline">{x.number}</Link></td>
                      <td className="truncate text-xs text-slate-600">{x.customerName || x.customerEmail}</td>
                      <td className="text-right tabular-nums">{x.amountFormatted}</td>
                      <td className="pl-3"><Dot s={x.status} /></td>
                      <td className="text-xs text-slate-500">{new Date(x.dueDate).toLocaleDateString()}</td>
                      <td className="text-right"><Tx url={x.txUrl} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </>
        )}
      </main>
    </div>
  )
}
