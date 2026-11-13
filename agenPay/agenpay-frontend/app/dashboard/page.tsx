"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { fromBaseUnits } from "@/lib/near"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Send,
  RefreshCw,
  AlertCircle,
  LogOut,
  Wallet,
  Activity,
  Play,
  Square,
  Sparkles,
  Vault,
  Bot,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CreditCard,
  ExternalLink,
} from "lucide-react"

interface NearStatus {
  network: string
  tokenLabel: string
  company: string | null
  vault: string | null
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

interface DashboardData {
  near: NearStatus
  invoices: Invoice[]
  payments: VaultPayment[]
  agent: AgentStatus
  notionConnected: boolean
}

// Status colors follow a fixed, non-categorical palette so they never collide
// with series/identity colors elsewhere in the product.
const STATUS_META: Record<string, { dot: string; label: string }> = {
  paid: { dot: "#0ca30c", label: "Paid" },
  settled: { dot: "#0ca30c", label: "Settled" },
  pending: { dot: "#fab219", label: "Pending" },
  authorized: { dot: "#fab219", label: "Authorized" },
  reserved: { dot: "#fab219", label: "Reserved" },
  submitted: { dot: "#fab219", label: "Submitted" },
  processing: { dot: "#fab219", label: "Processing" },
  refunded: { dot: "#898781", label: "Refunded" },
  failed: { dot: "#d03b3b", label: "Failed" },
}

function getStatusMeta(status: string) {
  return STATUS_META[status.toLowerCase()] ?? { dot: "#898781", label: status }
}

const sum = (xs: string[]) => xs.reduce((a, x) => a + Number(x || 0), 0).toFixed(2) // ponytail: display only, 2 dp

// Shared surface for payment operations.
const glassCard =
  "rounded-lg border border-slate-200 bg-white "

function StatTile({
  label,
  value,
  helper,
  icon: Icon,
  action,
}: {
  label: string
  value: React.ReactNode
  helper?: React.ReactNode
  icon: React.ComponentType<{ className?: string }>
  action?: React.ReactNode
}) {
  return (
    <Card className={`${glassCard} gap-0 p-4`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className={`flex h-7 w-7 items-center justify-center text-slate-500`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {helper && <p className="mt-1 truncate text-xs text-slate-500">{helper}</p>}
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

export default function Dashboard() {
  const { user, logout } = useAuth()
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [chatHistory, setChatHistory] = useState<Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
  }>>([])
  const [chatThreadId, setChatThreadId] = useState<string | undefined>(undefined)

  const loadDashboardData = async () => {
    try {
      setIsLoading(true)
      const [near, inv, pay, agent, ws] = await Promise.all([
        authService.api<NearStatus>("/api/near/status"),
        authService.api<{ invoices: Invoice[] }>("/api/invoices"),
        authService.api<{ payments: VaultPayment[] }>("/api/vault/payments"),
        authService.api<AgentStatus>("/api/agent/status"),
        user?.id
          ? authService.api<{ data?: { notionConnected: boolean } }>(`/api/workspace-status/${user.id}`)
          : Promise.resolve({ data: { notionConnected: false } }),
      ])
      setDashboardData({
        near, invoices: inv.invoices, payments: pay.payments, agent,
        notionConnected: !!ws.data?.notionConnected,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data")
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDashboardData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || isProcessing) return

    setIsProcessing(true)
    setError("")

    const userMessage = message.trim()
    setMessage("")
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date() }])

    try {
      const response = await authService.processPayment(userMessage, chatThreadId)
      if (response.success && response.data) {
        const data = response.data as { response: string; threadId?: string }
        if (data.threadId) setChatThreadId(data.threadId)
        setChatHistory(prev => [...prev, { role: 'assistant', content: data.response, timestamp: new Date() }])
        loadDashboardData() // the agent may have created an invoice or paid a supplier
      } else {
        setError(response.error || "Failed to process message")
      }
    } catch (err) {
      setError("Failed to process message")
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleAgentToggle = async () => {
    try {
      if (dashboardData?.agent.isRunning) {
        await authService.stopAgent()
      } else {
        await authService.startAgent(10) // 10 minute intervals
      }
      await loadDashboardData()
    } catch (err) {
      setError("Failed to toggle agent")
      console.error(err)
    }
  }

  // Connect Notion from the dashboard (for users who skipped it during onboarding).
  const handleConnectNotion = async () => {
    setError("")
    try {
      const response = await authService.getNotionAuthUrl()
      if (response.success && response.authUrl) {
        window.location.href = response.authUrl
      } else {
        setError(response.error || "Failed to get Notion auth URL")
      }
    } catch (err) {
      setError("Failed to initiate Notion authentication")
      console.error(err)
    }
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
  }

  const pageBg =
    "bg-slate-50"

  if (isLoading && !dashboardData) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        <div className="text-center">
          <RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-slate-500">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (!dashboardData) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        <Card className={`${glassCard} w-full max-w-md`}>
          <CardContent className="pt-6">
            <div className="text-center">
              <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
              <p className="mb-4 text-slate-600">{error || "Failed to load dashboard"}</p>
              <Button
                onClick={loadDashboardData}
                className="rounded-xl bg-primary   text-white  "
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { near, invoices, payments, agent } = dashboardData
  const token = near.tokenLabel?.startsWith("tUSDC") ? "tUSDC" : "USDC"
  const paid = invoices.filter((i) => i.status === "paid")
  const open = invoices.filter((i) => i.status === "pending")
  const activity = [
    ...invoices.map((i) => ({
      id: i.id, incoming: true, title: `${i.number} · ${i.customerName || i.customerEmail}`,
      amount: i.amountFormatted, status: i.status, createdAt: i.createdAt, url: i.txUrl,
    })),
    ...payments.map((p) => ({
      id: p.id, incoming: false, title: `Supplier payment${p.recipient ? ` · ${p.recipient}` : ""}`,
      amount: p.amountFormatted, status: p.status, createdAt: p.createdAt, url: p.url,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)
  const initials = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase()
  const setupButton = (
    <Button asChild size="sm" className="h-7 w-full rounded-lg bg-primary text-xs text-white">
      <Link href="/finance">Set up NEAR account</Link>
    </Button>
  )

  return (
    <div className={`dashboard-shell relative flex min-h-screen flex-col lg:h-screen lg:overflow-hidden ${pageBg} text-slate-900`}>
      {/* Header */}
      <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 ">
        <div className="flex items-center gap-3">
          <Link
            href="/#hero"
            aria-label="Back to SKYPay home"
            className="flex items-center gap-2 transition-opacity hover:opacity-70"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary   shadow-sm">
              <CreditCard className="h-4 w-4 text-white" />
            </span>
            <span className="font-sans text-xl font-semibold">SKYPay</span>
          </Link>
          <span className="hidden text-sm text-slate-500 sm:inline">Dashboard</span>
          <Link
            href="/finance"
            className="ml-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90"
          >
            Finance · NEAR
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 border-slate-200 bg-white py-1 text-xs font-medium text-slate-700 "
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: agent.isRunning ? "#0ca30c" : "#898781" }}
            />
            {agent.isRunning ? "Agent running" : "Agent stopped"}
          </Badge>

          <Button
            variant={agent.isRunning ? "destructive" : "default"}
            size="sm"
            onClick={handleAgentToggle}
            className={agent.isRunning ? "" : "bg-primary   text-white  "}
          >
            {agent.isRunning ? (
              <>
                <Square className="h-3.5 w-3.5" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Start
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={loadDashboardData}
            aria-label="Refresh"
            className="border-slate-200 bg-white  hover:bg-white"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>

          <div className="mx-1 h-6 w-px bg-slate-300/60" />

          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary   text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="hidden leading-tight md:block">
              <p className="max-w-[140px] truncate text-sm font-medium">{user?.name}</p>
              <p className="max-w-[140px] truncate text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            aria-label="Log out"
            className="hover:bg-white"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content — fills the viewport; only inner panels scroll */}
      <main className="relative z-10 min-h-0 flex-1 lg:overflow-hidden px-4 py-4 lg:px-6">
        <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-4">
          <div className="shrink-0">
            <h1 className="text-xl font-semibold tracking-tight">
              {getGreeting()}, {user?.name}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Your payment agent and company account on NEAR {near.network}.
            </p>
          </div>

          {/* KPI row */}
          <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Company balance"
              icon={Wallet}
              value={near.company ? `${fromBaseUnits(near.companyBalance)} ${token}` : "No account"}
              helper={near.company ?? "Create your NEAR account to receive payments"}
              action={near.company ? undefined : setupButton}
            />
            <StatTile
              label="Vault available"
              icon={Vault}
              value={near.vault ? `${fromBaseUnits(near.vaultAvailable)} ${token}` : "—"}
              helper="What the agent may spend, within your limits"
            />
            <StatTile
              label="Collected"
              icon={ArrowDownLeft}
              value={`${sum(paid.map((i) => i.amountFormatted))} ${token}`}
              helper={`${paid.length} paid invoice${paid.length === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Outstanding"
              icon={Clock}
              value={`${sum(open.map((i) => i.amountFormatted))} ${token}`}
              helper={`${open.length} open invoice${open.length === 1 ? "" : "s"}`}
            />
          </div>

          {/* Main grid — fills remaining height */}
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
            {/* Chat / mission control */}
            <div className="flex min-h-0 flex-col gap-4 lg:col-span-2">
              <Card className={`${glassCard} shrink-0 gap-3 p-4`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Mission control</p>
                    <h2 className="mt-0.5 text-base font-semibold">Natural-language payments</h2>
                  </div>
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["Invoice 25 USDC", "Invoice Acme Corp (billing@acme.test) 25 USDC for design work, due in 7 days"],
                    ["Pay a supplier", "Pay my approved supplier 5 USDC for hosting"],
                    ["Summary", "Summarize my finances"],
                  ].map(([label, text]) => (
                    <Button
                      key={label}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMessage(text)}
                      className="border-slate-200 bg-white  hover:bg-white"
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </Card>

              <Card className={`${glassCard} flex min-h-0 flex-1 flex-col gap-0 p-4`}>
                <div className="mb-3 flex shrink-0 items-center justify-between">
                  <h2 className="text-sm font-semibold">Command chat</h2>
                  <p className="max-w-[50%] truncate text-xs text-slate-500">
                    Thread: {chatThreadId || "new"}
                  </p>
                </div>

                <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3">
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {chatHistory.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-300/70 p-6 text-center">
                        <CreditCard className="mx-auto mb-2 h-6 w-6 text-primary" />
                        <h3 className="text-sm font-semibold">Welcome to SKYPay</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Ask in plain English. The agent can only invoice, check status, and pay suppliers you approved.
                        </p>
                        <div className="mt-3 space-y-1 text-xs text-slate-500">
                          <p>&quot;Invoice Acme Corp 25 USDC, due Friday&quot;</p>
                          <p>&quot;Is INV-0002 paid?&quot;</p>
                          <p>&quot;Summarize my finances&quot;</p>
                        </div>
                      </div>
                    )}

                    {chatHistory.map((msg, index) => (
                      <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[90%] rounded-xl px-3 py-2 text-sm shadow-sm sm:max-w-[78%] ${
                            msg.role === "user"
                              ? "bg-primary   text-white"
                              : "border border-slate-200 bg-white text-slate-900"
                          }`}
                        >
                          <div className="whitespace-pre-wrap leading-5">{msg.content}</div>
                          <div className={`mt-1 text-[11px] ${msg.role === "user" ? "text-white/70" : "text-slate-400"}`}>
                            {msg.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    ))}

                    {isProcessing && (
                      <div className="flex justify-start">
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            <span>Processing...</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="mt-3 shrink-0">
                      <Alert variant="destructive" className="text-xs">
                        <AlertCircle className="h-3.5 w-3.5" />
                        <AlertDescription className="ml-2 text-xs">{error}</AlertDescription>
                      </Alert>
                    </div>
                  )}

                  <form onSubmit={handleSendMessage} className="mt-3 shrink-0">
                    <div className="flex gap-2">
                      <Input
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Type a command, e.g. Invoice Acme Corp 25 USDC, due Friday"
                        className="h-10 flex-1 border-slate-200 bg-white text-sm  focus-visible:ring-ring"
                        disabled={isProcessing}
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={isProcessing || !message.trim()}
                        className="h-10 w-10 bg-primary   text-white  "
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </form>
                </div>
              </Card>
            </div>

            {/* Side column — scrolls when cards outgrow short viewports */}
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              {/* NEAR account */}
              <Card className={`${glassCard} shrink-0 gap-3 p-4`}>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary   shadow-sm">
                    <Wallet className="h-3.5 w-3.5 text-white" />
                  </span>
                  <p className="text-sm font-semibold">NEAR company account</p>
                </div>
                {near.company ? (
                  <div className="space-y-1.5 text-xs">
                    {[
                      ["Account", near.company, near.links?.company],
                      ["Vault", near.vault, near.links?.vault],
                    ].map(([label, id, href]) => (
                      <a
                        key={label}
                        href={href ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2 hover:bg-slate-50"
                      >
                        <span className="text-slate-500">{label}</span>
                        <span className="flex min-w-0 items-center gap-1 font-mono text-slate-700">
                          <span className="truncate">{id}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </span>
                      </a>
                    ))}
                    <p className="pt-1 text-slate-500">Your owner key stays in this browser. Manage the vault and agent limits on Finance.</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs leading-5 text-slate-500">
                      One click creates your company account, an immutable spending vault and a limited agent key on NEAR {near.network}.
                      Your owner key is generated in this browser and never sent to SkyPay.
                    </p>
                    {setupButton}
                  </>
                )}
              </Card>

              {/* Integrations */}
              <Card className={`${glassCard} shrink-0 gap-3 p-4`}>
                <p className="text-xs font-medium text-slate-500">Integrations</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-600">Notion</span>
                    {dashboardData.notionConnected ? (
                      <Badge className="bg-[#0ca30c] text-white">Connected</Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={handleConnectNotion}
                        className="h-7 rounded-lg bg-primary   text-xs text-white  "
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-600">NEAR account</span>
                    {near.company ? (
                      <Badge className="bg-[#0ca30c] text-white">Ready</Badge>
                    ) : (
                      <Badge variant="outline">Not set up</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-600">Agent</span>
                    <Badge
                      className={agent.isRunning ? "bg-[#2a78d6] text-white" : ""}
                      variant={agent.isRunning ? "default" : "outline"}
                    >
                      {agent.isRunning ? "Running" : "Stopped"}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 border-t border-slate-200 pt-2 text-xs text-slate-500">
                  <Bot className="h-3.5 w-3.5" />
                  {agent.lastActivity
                    ? `Last activity ${new Date(agent.lastActivity).toLocaleString()}`
                    : "No agent activity yet"}
                </div>
              </Card>

              {/* Recent activity — flexes and scrolls internally */}
              <Card className={`${glassCard} flex min-h-[220px] flex-1 flex-col gap-0 overflow-hidden p-0`}>
                <CardHeader className="shrink-0 border-b border-slate-200 px-4 py-3">
                  <CardTitle className="text-sm font-semibold">Recent activity</CardTitle>
                </CardHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {activity.length > 0 ? (
                    <ul className="divide-y divide-slate-100">
                      {activity.map((tx) => {
                        const meta = getStatusMeta(tx.status)
                        const row = (
                          <>
                            {tx.incoming ? (
                              <ArrowDownLeft className="h-4 w-4 shrink-0 text-[#0ca30c]" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{tx.title}</p>
                              <p className="text-xs text-slate-500">
                                {new Date(tx.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-medium tabular-nums">
                                {tx.amount} {token}
                              </p>
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
                                {meta.label}
                                {tx.url && <ExternalLink className="h-2.5 w-2.5" />}
                              </span>
                            </div>
                          </>
                        )
                        return (
                          <li key={tx.id}>
                            {tx.url ? (
                              <a href={tx.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">{row}</a>
                            ) : (
                              <div className="flex items-center gap-3 px-4 py-2.5">{row}</div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <Activity className="mx-auto mb-1 h-4 w-4 text-slate-400" />
                      <p className="text-xs text-slate-500">No invoices or payments yet</p>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
