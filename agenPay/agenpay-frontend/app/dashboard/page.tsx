"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { fromBaseUnits } from "@/lib/near"
import { AppHeader } from "@/components/app/app-header"
import { StatusPill } from "@/components/app/status"
import {
  AlertCircle, ArrowDownLeft, ArrowRight, ArrowUpRight, Bot, ExternalLink, FileText, Loader2, Play, RefreshCw, Send, Square,
} from "lucide-react"

interface NearStatus {
  network: string
  tokenLabel: string
  company: string | null
  vault: string | null
  agent: string | null
  companyBalance?: string
  vaultAvailable?: string
  links?: { company: string; vault: string; agent: string }
}
interface Invoice {
  id: string; number: string; customerName?: string | null; customerEmail: string
  amountFormatted: string; status: string; createdAt: string; txUrl: string | null
}
interface VaultPayment {
  id: string; amountFormatted: string; status: string; createdAt: string; url: string | null; recipient?: string | null
}
interface AgentStatus { isRunning: boolean; lastActivity?: string }

type Slot<T> = { data?: T; error?: string }
const settle = <T,>(r: PromiseSettledResult<T>): Slot<T> =>
  r.status === "fulfilled" ? { data: r.value } : { error: r.reason instanceof Error ? r.reason.message : "Request failed" }

const money = (v?: string | null) => Number(v || 0).toFixed(2) // display only, 2 dp; exact values live in CSV exports
const sum = (xs: string[]) => xs.reduce((a, x) => a + Number(x || 0), 0).toFixed(2)
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })

const PROMPTS = [
  { label: "New invoice", text: "Invoice Harbor & Pine (billing@harborpine.test) 25 USDC for design work, due in 7 days" },
  { label: "Check an invoice", text: "Is INV-0001 paid?" },
  { label: "Pay a supplier", text: "Pay my approved supplier 5 USDC for hosting" },
  { label: "Summary", text: "Summarize my finances" },
]

/** Minimal, safe markdown for agent replies: **bold**, [text](http(s) url), bare http(s) urls, "* " bullets. React nodes only. */
function renderChat(text: string): React.ReactNode[] {
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g
  return text.replace(/^[ \t]*[*-] /gm, "• ").split("\n").flatMap((line, li, all) => {
    const out: React.ReactNode[] = []
    let last = 0
    for (const m of line.matchAll(re)) {
      if (m.index! > last) out.push(line.slice(last, m.index))
      const key = `${li}-${m.index}`
      if (m[1]) out.push(<strong key={key}>{m[1]}</strong>)
      else {
        const href = m[3] || m[4]
        out.push(<a key={key} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{m[2] || href}</a>)
      }
      last = m.index! + m[0].length
    }
    if (last < line.length) out.push(line.slice(last))
    if (li < all.length - 1) out.push("\n")
    return out
  })
}

function Panel({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-xl border border-border bg-card ${className}`}>{children}</section>
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="rounded-md px-2 py-1 font-medium underline-offset-2 hover:underline">Retry</button>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [near, setNear] = useState<Slot<NearStatus>>({})
  const [invoices, setInvoices] = useState<Slot<Invoice[]>>({})
  const [payments, setPayments] = useState<Slot<VaultPayment[]>>({})
  const [agent, setAgent] = useState<Slot<AgentStatus>>({})
  const [notionConnected, setNotionConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "in" | "out">("all")

  const [message, setMessage] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [chatError, setChatError] = useState("")
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; content: string; timestamp: Date }>>([])
  const [chatThreadId, setChatThreadId] = useState<string | undefined>(undefined)
  const [agentBusy, setAgentBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // silent = background poll: no spinner, and a failed poll keeps the last good data instead of flashing an error.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const [n, inv, pay, ag, ws] = await Promise.allSettled([
      authService.api<NearStatus>("/api/near/status"),
      authService.api<{ invoices: Invoice[] }>("/api/invoices").then((r) => r.invoices),
      authService.api<{ payments: VaultPayment[] }>("/api/vault/payments").then((r) => r.payments),
      authService.api<AgentStatus>("/api/agent/status"),
      user?.id
        ? authService.api<{ data?: { notionConnected: boolean } }>(`/api/workspace-status/${user.id}`)
        : Promise.resolve({ data: { notionConnected: false } }),
    ])
    const ok = (r: PromiseSettledResult<unknown>) => !silent || r.status === "fulfilled"
    if (ok(n)) setNear(settle(n))
    if (ok(inv)) setInvoices(settle(inv))
    if (ok(pay)) setPayments(settle(pay))
    if (ok(ag)) setAgent(settle(ag))
    if (ws.status === "fulfilled") setNotionConnected(!!ws.value.data?.notionConnected)
    else if (!silent) setNotionConnected(null)
    if (!silent) setLoading(false)
  }, [user?.id])

  useEffect(() => { load() }, [load])

  // Live updates: re-read everything every 2 s (hackathon demo: a payment shows up without a manual refresh).
  useEffect(() => {
    let inFlight = false
    const tick = async () => {
      if (inFlight || document.hidden) return
      inFlight = true
      try { await load(true) } finally { inFlight = false }
    }
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  }, [load])

  // Keep the newest chat message in view (native scroll inside the panel).
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [chatHistory, isProcessing])

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!message.trim() || isProcessing) return
    setIsProcessing(true)
    setChatError("")
    const userMessage = message.trim()
    setMessage("")
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage, timestamp: new Date() }])
    try {
      const response = await authService.processPayment(userMessage, chatThreadId)
      if (response.success && response.data) {
        const data = response.data as { response: string; threadId?: string }
        if (data.threadId) setChatThreadId(data.threadId)
        setChatHistory((prev) => [...prev, { role: "assistant", content: data.response, timestamp: new Date() }])
        load() // the agent may have created an invoice or paid a supplier
      } else {
        setChatError(response.error || "The agent could not process that message.")
        setMessage(userMessage) // let the user resend without retyping
      }
    } catch {
      setChatError("The agent could not process that message.")
      setMessage(userMessage)
    } finally {
      setIsProcessing(false)
      inputRef.current?.focus()
    }
  }

  const handleAgentToggle = async () => {
    setAgentBusy(true)
    try {
      if (agent.data?.isRunning) await authService.stopAgent()
      else await authService.startAgent(10) // 10 minute intervals
      const ag = await authService.api<AgentStatus>("/api/agent/status")
      setAgent({ data: ag })
    } catch (err) {
      setAgent((a) => ({ ...a, error: err instanceof Error ? err.message : "Could not change the agent state" }))
    } finally {
      setAgentBusy(false)
    }
  }

  const handleConnectNotion = async () => {
    try {
      const response = await authService.getNotionAuthUrl()
      if (response.success && response.authUrl) window.location.href = response.authUrl
    } catch {
      setNotionConnected(false)
    }
  }

  const n = near.data
  const token = n?.tokenLabel?.startsWith("tUSDC") ? "tUSDC" : "USDC"
  const invList = invoices.data ?? []
  const payList = payments.data ?? []
  const paid = invList.filter((i) => i.status === "paid")
  const open = invList.filter((i) => i.status === "pending")
  const running = !!agent.data?.isRunning

  const activity = [
    ...(filter !== "out" ? invList.map((i) => ({
      id: i.id, incoming: true, title: i.number, who: i.customerName || i.customerEmail,
      amount: i.amountFormatted, status: i.status, createdAt: i.createdAt, url: i.txUrl, href: `/invoice/${i.id}`,
    })) : []),
    ...(filter !== "in" ? payList.map((p) => ({
      id: p.id, incoming: false, title: "Supplier payment", who: p.recipient || "",
      amount: p.amountFormatted, status: p.status, createdAt: p.createdAt, url: p.url, href: null as string | null,
    })) : []),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
  const activityError = filter === "in" ? invoices.error : filter === "out" ? payments.error : invoices.error || payments.error

  const metrics = [
    { label: "Company balance", value: n?.company ? money(fromBaseUnits(n.companyBalance)) : null, sub: n?.company ?? "No NEAR account yet", primary: true },
    { label: "Vault available", value: n?.vault ? money(fromBaseUnits(n.vaultAvailable)) : null, sub: "The agent may spend this, within limits" },
    { label: "Collected", value: sum(paid.map((i) => i.amountFormatted)), sub: `${paid.length} paid invoice${paid.length === 1 ? "" : "s"}` },
    { label: "Outstanding", value: sum(open.map((i) => i.amountFormatted)), sub: `${open.length} open invoice${open.length === 1 ? "" : "s"}` },
  ]

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background lg:h-[100dvh] lg:overflow-hidden">
      <AppHeader>
        <button
          type="button"
          onClick={() => load()}
          aria-label="Refresh data"
          className="press flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </AppHeader>

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-4 md:px-6 lg:min-h-0">
        {/* Title and primary actions */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Overview</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {n ? `NEAR ${n.network}. Amounts in ${token}${token === "tUSDC" ? " (test token, no value)" : ""}.` : "Your payments at a glance."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/finance#pay" className="press inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted">
              <ArrowUpRight className="h-4 w-4" /> Pay supplier
            </Link>
            <Link href="/finance#invoices" className="press inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <FileText className="h-4 w-4" /> New invoice
            </Link>
          </div>
        </div>

        {/* Setup prompt when the company has no NEAR account */}
        {n && !n.company && (
          <Panel className="flex flex-col gap-4 border-primary/30 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Create your NEAR company account</h2>
              <p className="mt-1 text-sm text-muted-foreground">Needed to receive invoice payments and to let the agent pay suppliers. Sponsored and free on testnet.</p>
            </div>
            <Link href="/auth/login?step=near" className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              Set up now <ArrowRight className="h-4 w-4" />
            </Link>
          </Panel>
        )}

        {/* Accounts: always visible at the top */}
        <Panel>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-3 text-sm lg:grid-cols-4">
            {[
              ["Company", n?.company, n?.links?.company],
              ["Vault", n?.vault, n?.links?.vault],
              ["Agent", n?.agent, n?.links?.agent],
            ].map(([label, id, href]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 min-w-0">
                  {id ? (
                    <a href={href ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono text-xs hover:underline">
                      <span className="truncate">{id}</span><ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not set up</span>
                  )}
                </dd>
              </div>
            ))}
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Notion</dt>
              <dd className="mt-0.5">
                {notionConnected ? (
                  <StatusPill status="connected" />
                ) : notionConnected === false ? (
                  <button type="button" onClick={handleConnectNotion} className="text-xs font-medium text-primary underline-offset-4 hover:underline">Connect</button>
                ) : (
                  <span className="text-xs text-muted-foreground">Unknown</span>
                )}
              </dd>
            </div>
          </dl>
        </Panel>

        {/* Balance ledger */}
        <Panel>
          {near.error ? (
            <div className="p-4"><InlineError message={`Balances unavailable: ${near.error}`} onRetry={() => load()} /></div>
          ) : (
            <dl className="grid grid-cols-2 lg:grid-cols-4">
              {metrics.map((m, i) => (
                <div key={m.label} className={`min-w-0 px-5 py-3 ${i % 2 === 1 ? "border-l border-border" : ""} ${i >= 2 ? "border-t border-border lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
                  <dt className="text-sm text-muted-foreground">{m.label}</dt>
                  <dd className="mt-1">
                    {loading && !n ? (
                      <span className="skeleton block h-8 w-28" />
                    ) : (
                      <span className={`tabular font-semibold tracking-[-0.02em] ${m.primary ? "text-2xl" : "text-xl"}`}>
                        {m.value ?? "0.00"} <span className="text-sm font-medium text-muted-foreground">{token}</span>
                      </span>
                    )}
                  </dd>
                  <dd className="mt-1 truncate text-xs text-muted-foreground">{m.sub}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>

        <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_420px]">
          {/* Activity */}
          <Panel className="order-2 flex min-w-0 flex-col lg:order-1 lg:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <h2 className="font-semibold">Activity</h2>
              <div role="group" aria-label="Filter activity" className="flex rounded-lg bg-muted p-1">
                {([["all", "All"], ["in", "Invoices"], ["out", "Supplier payments"]] as const).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${filter === k ? "bg-card font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {activityError && <div className="p-4"><InlineError message={`Some activity could not load: ${activityError}`} onRetry={() => load()} /></div>}

            {loading && !invoices.data && !payments.data ? (
              <ul className="divide-y divide-border" aria-label="Loading activity">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex items-center gap-4 px-5 py-4">
                    <span className="skeleton h-8 w-8 rounded-full" />
                    <span className="flex-1 space-y-2"><span className="skeleton block h-3 w-40" /><span className="skeleton block h-3 w-24" /></span>
                    <span className="skeleton h-4 w-16" />
                  </li>
                ))}
              </ul>
            ) : activity.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <FileText className="mx-auto h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
                <p className="mt-3 font-medium">No {filter === "out" ? "supplier payments" : filter === "in" ? "invoices" : "activity"} yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  {filter === "out" ? "Approve a payee and fund the vault on Finance, then pay from there or ask the agent." : "Create an invoice on Finance, or ask the agent to invoice a client."}
                </p>
                <Link href={filter === "out" ? "/finance#pay" : "/finance#invoices"} className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
                  Open Finance <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                {activity.map((a) => (
                  <li key={`${a.incoming ? "i" : "o"}-${a.id}`} className="flex items-center gap-4 px-5 py-3.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${a.incoming ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {a.incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {a.href ? <Link href={a.href} target="_blank" className="hover:underline">{a.title}</Link> : a.title}
                        {a.who && <span className="font-normal text-muted-foreground"> · {a.who}</span>}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {fmtDate(a.createdAt)}
                        {a.url && (
                          <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                            Transaction <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tabular text-sm font-medium">{a.incoming ? "+" : "-"}{money(a.amount)}</span>
                      <StatusPill status={a.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Agent and accounts */}
          <div className="order-1 min-w-0 lg:order-2 lg:min-h-0">
            <Panel className="flex h-[520px] flex-col lg:h-full">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <h2 className="font-semibold">Payment agent</h2>
                </div>
                <button
                  type="button"
                  onClick={handleAgentToggle}
                  disabled={agentBusy || !!agent.error && !agent.data}
                  aria-pressed={running}
                  className={`press inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium ${running ? "bg-success/10 text-success hover:bg-success/15" : "border border-border hover:bg-muted"}`}
                >
                  {agentBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : running ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {running ? "Watching Notion" : "Watch Notion"}
                </button>
              </div>

              <div ref={logRef} role="log" aria-live="polite" aria-label="Agent conversation" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {chatHistory.length === 0 && (
                  <div className="py-4">
                    <p className="text-sm font-medium">Ask the agent in plain English.</p>
                    <p className="mt-1 text-sm text-muted-foreground">It can invoice, check status, pay approved suppliers and summarize. It cannot pay addresses from chat.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {PROMPTS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => { setMessage(p.text); inputRef.current?.focus() }}
                          className="press rounded-full border border-border px-3 py-1.5 text-sm hover:bg-muted"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                      <p className="whitespace-pre-wrap break-words leading-relaxed">{renderChat(msg.content)}</p>
                      <p className={`mt-1 text-[11px] ${msg.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Working on it
                  </div>
                )}
              </div>

              <form onSubmit={handleSendMessage} className="border-t border-border p-3">
                {chatError && <p role="alert" className="mb-2 px-1 text-sm text-destructive">{chatError} Your message is still in the box; send it again.</p>}
                <label htmlFor="agent-input" className="sr-only">Message the payment agent</label>
                <div className="flex items-end gap-2">
                  <textarea
                    id="agent-input"
                    ref={inputRef}
                    rows={1}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }}
                    placeholder="Invoice a client, check an invoice..."
                    disabled={isProcessing}
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 md:text-sm"
                  />
                  <button
                    type="submit"
                    disabled={isProcessing || !message.trim()}
                    aria-label="Send message"
                    className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </Panel>
          </div>
        </div>
      </main>
    </div>
  )
}
